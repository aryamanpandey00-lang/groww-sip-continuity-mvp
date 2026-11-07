-- Atomic operations used by the shared TypeScript adapters.
-- Functions run as a dedicated NOLOGIN/NOBYPASSRLS role, never a project owner.
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.reserve_assistant_token_budget(
  p_reservation_id uuid,
  p_max_tokens bigint
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $function$
DECLARE
  v_window_start timestamptz;
  v_reserved bigint;
  v_spent bigint;
  v_inserted integer;
BEGIN
  IF p_reservation_id IS NULL OR p_max_tokens IS NULL OR p_max_tokens <= 0 OR p_max_tokens > 100000 THEN
    RETURN false;
  END IF;

  v_window_start := date_trunc('hour', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  INSERT INTO app.assistant_budget_windows (
    budget_key, window_start, window_end, budget_limit_tokens
  ) VALUES (
    'sip-assistant', v_window_start, v_window_start + interval '1 hour', 100000
  ) ON CONFLICT (budget_key, window_start) DO NOTHING;

  SELECT reserved_tokens, spent_tokens
    INTO v_reserved, v_spent
    FROM app.assistant_budget_windows
   WHERE budget_key = 'sip-assistant' AND window_start = v_window_start
   FOR UPDATE;

  IF p_max_tokens > 100000 - v_reserved - v_spent THEN
    RETURN false;
  END IF;

  INSERT INTO app.assistant_token_reservations (
    reservation_id, budget_key, window_start, reserved_tokens
  ) VALUES (
    p_reservation_id, 'sip-assistant', v_window_start, p_max_tokens
  ) ON CONFLICT (reservation_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN false;
  END IF;

  UPDATE app.assistant_budget_windows
     SET reserved_tokens = reserved_tokens + p_max_tokens
   WHERE budget_key = 'sip-assistant' AND window_start = v_window_start;
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION app.settle_assistant_token_budget(
  p_reservation_id uuid,
  p_actual_tokens bigint DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $function$
DECLARE
  v_budget_key text;
  v_window_start timestamptz;
  v_reserved bigint;
  v_settled bigint;
  v_charge bigint;
BEGIN
  IF p_reservation_id IS NULL OR p_actual_tokens < 0 THEN
    RETURN false;
  END IF;

  SELECT budget_key, window_start
    INTO v_budget_key, v_window_start
    FROM app.assistant_token_reservations
   WHERE reservation_id = p_reservation_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Lock in the same window-then-reservation order used by reservation calls.
  PERFORM 1
    FROM app.assistant_budget_windows
   WHERE budget_key = v_budget_key AND window_start = v_window_start
   FOR UPDATE;
  SELECT reserved_tokens, settled_tokens
    INTO v_reserved, v_settled
    FROM app.assistant_token_reservations
   WHERE reservation_id = p_reservation_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_settled IS NOT NULL THEN
    RETURN true;
  END IF;

  v_charge := COALESCE(p_actual_tokens, v_reserved);
  UPDATE app.assistant_token_reservations
     SET settled_tokens = v_charge, settled_at = clock_timestamp()
   WHERE reservation_id = p_reservation_id;
  UPDATE app.assistant_budget_windows
     SET reserved_tokens = reserved_tokens - v_reserved,
         spent_tokens = spent_tokens + v_charge
   WHERE budget_key = v_budget_key AND window_start = v_window_start;
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION app.sync_action_preview(
  p_session_id uuid,
  p_session_data jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $function$
DECLARE
  v_pending jsonb;
BEGIN
  UPDATE app.action_previews
     SET revoked_at = clock_timestamp()
   WHERE session_id = p_session_id AND consumed_at IS NULL AND revoked_at IS NULL;

  v_pending := p_session_data->'pendingPreview';
  IF v_pending IS NULL OR v_pending = 'null'::jsonb THEN
    RETURN;
  END IF;
  IF v_pending->>'previewId' IS NULL
     OR (v_pending->>'stateVersion')::bigint > (p_session_data->>'stateVersion')::bigint
     OR v_pending->>'scenario' <> p_session_data->>'scenario' THEN
    RAISE EXCEPTION 'invalid pending action preview';
  END IF;

  INSERT INTO app.action_previews (
    preview_id, session_id, state_version, preview_data, expires_at
  ) VALUES (
    (v_pending->>'previewId')::uuid,
    p_session_id,
    (v_pending->>'stateVersion')::bigint,
    v_pending,
    (v_pending->>'expiresAt')::timestamptz
  );
END
$function$;

CREATE OR REPLACE FUNCTION app.insert_action_session(
  p_session_id uuid,
  p_session_data jsonb,
  p_cookie_hash bytea
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $function$
DECLARE
  v_inserted integer;
BEGIN
  IF p_session_id IS NULL OR p_session_data IS NULL OR p_cookie_hash IS NULL
     OR octet_length(p_cookie_hash) <> 32
     OR p_session_data->>'sessionId' IS NULL
     OR (p_session_data->>'sessionId')::uuid <> p_session_id
     OR p_session_data->>'stateVersion' IS NULL
     OR p_session_data->>'createdAt' IS NULL
     OR p_session_data->>'expiresAt' IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO app.action_sessions (
    session_id, scenario, state_version, session_data, cookie_hash,
    created_at, expires_at, updated_at
  ) VALUES (
    p_session_id,
    p_session_data->>'scenario',
    (p_session_data->>'stateVersion')::bigint,
    p_session_data,
    p_cookie_hash,
    (p_session_data->>'createdAt')::timestamptz,
    (p_session_data->>'expiresAt')::timestamptz,
    clock_timestamp()
  ) ON CONFLICT (session_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN false;
  END IF;

  PERFORM app.sync_action_preview(p_session_id, p_session_data);
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION app.create_action_session(
  p_session_id uuid,
  p_session_data jsonb,
  p_cookie_hash bytea
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $function$
BEGIN
  RETURN app.insert_action_session(p_session_id, p_session_data, p_cookie_hash);
END
$function$;

CREATE OR REPLACE FUNCTION app.get_action_session(
  p_session_id uuid,
  p_cookie_hash bytea,
  p_state_version bigint
) RETURNS SETOF jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $function$
  SELECT session_data
    FROM app.action_sessions
   WHERE session_id = p_session_id
     AND cookie_hash = p_cookie_hash
     AND state_version = p_state_version
     AND revoked_at IS NULL
     AND expires_at > clock_timestamp()
$function$;

CREATE OR REPLACE FUNCTION app.replace_action_session(
  p_expected_session_id uuid,
  p_expected_cookie_hash bytea,
  p_expected_state_version bigint,
  p_next_session_id uuid,
  p_next_session_data jsonb,
  p_next_cookie_hash bytea
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $function$
DECLARE
  v_current app.action_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_current
    FROM app.action_sessions
   WHERE session_id = p_expected_session_id
     AND cookie_hash = p_expected_cookie_hash
     AND state_version = p_expected_state_version
     AND revoked_at IS NULL
     AND expires_at > clock_timestamp()
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF p_next_session_id = p_expected_session_id THEN
    IF p_next_session_data->>'scenario' <> v_current.scenario THEN
      RETURN false;
    END IF;
    UPDATE app.action_sessions
       SET state_version = (p_next_session_data->>'stateVersion')::bigint,
           session_data = p_next_session_data,
           cookie_hash = p_next_cookie_hash,
           expires_at = (p_next_session_data->>'expiresAt')::timestamptz,
           updated_at = clock_timestamp()
     WHERE session_id = p_expected_session_id;
    PERFORM app.sync_action_preview(p_expected_session_id, p_next_session_data);
    RETURN true;
  END IF;

  UPDATE app.action_sessions
     SET revoked_at = clock_timestamp(), updated_at = clock_timestamp()
   WHERE session_id = p_expected_session_id;
  UPDATE app.action_previews
     SET revoked_at = clock_timestamp()
   WHERE session_id = p_expected_session_id AND consumed_at IS NULL AND revoked_at IS NULL;
  IF NOT app.insert_action_session(p_next_session_id, p_next_session_data, p_next_cookie_hash) THEN
    RAISE EXCEPTION 'could not create replacement action session';
  END IF;
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION app.confirm_action_preview(
  p_expected_session_id uuid,
  p_expected_cookie_hash bytea,
  p_expected_state_version bigint,
  p_preview_id uuid,
  p_allow_action boolean,
  p_next_session_data jsonb,
  p_next_cookie_hash bytea
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $function$
DECLARE
  v_session app.action_sessions%ROWTYPE;
  v_preview app.action_previews%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_session
    FROM app.action_sessions
   WHERE session_id = p_expected_session_id
     AND cookie_hash = p_expected_cookie_hash
     AND state_version = p_expected_state_version
     AND revoked_at IS NULL
     AND expires_at > v_now
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF p_next_session_data->>'sessionId' IS DISTINCT FROM p_expected_session_id::text
     OR (v_session.session_data#>>'{pendingPreview,previewId}') IS DISTINCT FROM p_preview_id::text THEN
    RETURN false;
  END IF;

  SELECT * INTO v_preview
    FROM app.action_previews
   WHERE preview_id = p_preview_id
     AND session_id = p_expected_session_id
     AND state_version = p_expected_state_version
     AND consumed_at IS NULL
     AND revoked_at IS NULL
   FOR UPDATE;
  IF NOT FOUND OR (p_allow_action AND v_preview.expires_at <= v_now) THEN
    RETURN false;
  END IF;

  UPDATE app.action_previews
     SET consumed_at = v_now
   WHERE preview_id = p_preview_id;
  UPDATE app.action_sessions
     SET state_version = (p_next_session_data->>'stateVersion')::bigint,
         session_data = p_next_session_data,
         cookie_hash = p_next_cookie_hash,
         expires_at = (p_next_session_data->>'expiresAt')::timestamptz,
         updated_at = v_now
   WHERE session_id = p_expected_session_id;
  PERFORM app.sync_action_preview(p_expected_session_id, p_next_session_data);
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION app.reset_action_session(
  p_previous_session_id uuid,
  p_previous_cookie_hash bytea,
  p_previous_state_version bigint,
  p_next_session_id uuid,
  p_next_session_data jsonb,
  p_next_cookie_hash bytea
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $function$
DECLARE
  v_has_previous boolean := p_previous_session_id IS NOT NULL;
  v_revoked integer;
BEGIN
  IF v_has_previous <> (p_previous_cookie_hash IS NOT NULL)
     OR v_has_previous <> (p_previous_state_version IS NOT NULL) THEN
    RETURN false;
  END IF;

  IF v_has_previous THEN
    UPDATE app.action_sessions
       SET revoked_at = clock_timestamp(), updated_at = clock_timestamp()
     WHERE session_id = p_previous_session_id
       AND cookie_hash = p_previous_cookie_hash
       AND state_version = p_previous_state_version
       AND revoked_at IS NULL;
    GET DIAGNOSTICS v_revoked = ROW_COUNT;
    IF v_revoked = 0 THEN
      RETURN false;
    END IF;
    UPDATE app.action_previews
       SET revoked_at = clock_timestamp()
     WHERE session_id = p_previous_session_id AND consumed_at IS NULL AND revoked_at IS NULL;
  END IF;

  IF NOT app.insert_action_session(p_next_session_id, p_next_session_data, p_next_cookie_hash) THEN
    RAISE EXCEPTION 'could not create reset action session';
  END IF;
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION app.get_approved_evidence(p_evidence_ids text[])
RETURNS TABLE (
  evidence_id text,
  tier text,
  title text,
  excerpt text,
  source_url text,
  source_date date,
  verified_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $function$
  SELECT e.evidence_id, e.tier, e.title, e.excerpt,
         e.source_url, e.source_date, e.verified_at
    FROM app.evidence_registry AS e
   WHERE e.review_status = 'approved'
     AND e.verified_at IS NOT NULL
     AND e.evidence_id = ANY(COALESCE(p_evidence_ids, ARRAY[]::text[]))
$function$;

REVOKE ALL ON FUNCTION app.reserve_assistant_token_budget(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.settle_assistant_token_budget(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_action_preview(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.insert_action_session(uuid, jsonb, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.create_action_session(uuid, jsonb, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.get_action_session(uuid, bytea, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.replace_action_session(uuid, bytea, bigint, uuid, jsonb, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.confirm_action_preview(uuid, bytea, bigint, uuid, boolean, jsonb, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.reset_action_session(uuid, bytea, bigint, uuid, jsonb, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.get_approved_evidence(text[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.reserve_assistant_token_budget(uuid, bigint) TO sip_mvp_runtime;
GRANT EXECUTE ON FUNCTION app.settle_assistant_token_budget(uuid, bigint) TO sip_mvp_runtime;
GRANT EXECUTE ON FUNCTION app.create_action_session(uuid, jsonb, bytea) TO sip_mvp_runtime;
GRANT EXECUTE ON FUNCTION app.get_action_session(uuid, bytea, bigint) TO sip_mvp_runtime;
GRANT EXECUTE ON FUNCTION app.replace_action_session(uuid, bytea, bigint, uuid, jsonb, bytea) TO sip_mvp_runtime;
GRANT EXECUTE ON FUNCTION app.confirm_action_preview(uuid, bytea, bigint, uuid, boolean, jsonb, bytea) TO sip_mvp_runtime;
GRANT EXECUTE ON FUNCTION app.reset_action_session(uuid, bytea, bigint, uuid, jsonb, bytea) TO sip_mvp_runtime;
GRANT EXECUTE ON FUNCTION app.get_approved_evidence(text[]) TO sip_mvp_runtime;

COMMENT ON FUNCTION app.reserve_assistant_token_budget(uuid, bigint) IS
  'Atomically reserves from the deployment-wide 100000-token UTC-hour budget.';
COMMENT ON FUNCTION app.settle_assistant_token_budget(uuid, bigint) IS
  'Idempotently settles actual usage; NULL charges the full reservation.';
COMMENT ON FUNCTION app.get_approved_evidence(text[]) IS
  'Returns only independently approved evidence; registry remains empty until reviewed records are added.';

-- Add an explicit, non-inheriting SET grant for the ownership transfer. On
-- PostgreSQL 16+, a CREATEROLE creator may also retain an automatic
-- admin-only membership granted by the bootstrap role; this is not the
-- temporary grant below and does not provide SET ROLE or inherited privileges.
GRANT sip_mvp_function_owner TO CURRENT_USER
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY CURRENT_USER;
ALTER FUNCTION app.reserve_assistant_token_budget(uuid, bigint) OWNER TO sip_mvp_function_owner;
ALTER FUNCTION app.settle_assistant_token_budget(uuid, bigint) OWNER TO sip_mvp_function_owner;
ALTER FUNCTION app.sync_action_preview(uuid, jsonb) OWNER TO sip_mvp_function_owner;
ALTER FUNCTION app.insert_action_session(uuid, jsonb, bytea) OWNER TO sip_mvp_function_owner;
ALTER FUNCTION app.create_action_session(uuid, jsonb, bytea) OWNER TO sip_mvp_function_owner;
ALTER FUNCTION app.get_action_session(uuid, bytea, bigint) OWNER TO sip_mvp_function_owner;
ALTER FUNCTION app.replace_action_session(uuid, bytea, bigint, uuid, jsonb, bytea) OWNER TO sip_mvp_function_owner;
ALTER FUNCTION app.confirm_action_preview(uuid, bytea, bigint, uuid, boolean, jsonb, bytea) OWNER TO sip_mvp_function_owner;
ALTER FUNCTION app.reset_action_session(uuid, bytea, bigint, uuid, jsonb, bytea) OWNER TO sip_mvp_function_owner;
ALTER FUNCTION app.get_approved_evidence(text[]) OWNER TO sip_mvp_function_owner;

REVOKE sip_mvp_function_owner FROM CURRENT_USER GRANTED BY CURRENT_USER;

-- PostgreSQL may retain the CREATEROLE creator's admin-only membership, but
-- the temporary membership must not leave inherited privileges or SET ROLE.
DO $verify_owner_membership$
BEGIN
  IF pg_catalog.pg_has_role(CURRENT_USER, 'sip_mvp_function_owner', 'USAGE')
     OR pg_catalog.pg_has_role(CURRENT_USER, 'sip_mvp_function_owner', 'SET') THEN
    RAISE EXCEPTION 'temporary function-owner privileges were not revoked';
  END IF;
END
$verify_owner_membership$;
