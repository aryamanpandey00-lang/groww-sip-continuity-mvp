-- Standalone AI-only runtime for the limited public demo.
-- Requires PostgreSQL 16+ role-membership syntax; target Neon is PostgreSQL 18.
-- Run as the authorized database/schema migration owner in one transaction.
-- No password, connection string, evidence records, or action-session objects are included.

DO $preflight$
DECLARE
  v_current_role pg_catalog.pg_roles%ROWTYPE;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 160000 THEN
    RAISE EXCEPTION 'standalone AI migration requires PostgreSQL 16 or later';
  END IF;

  SELECT * INTO v_current_role
    FROM pg_catalog.pg_roles
   WHERE rolname = CURRENT_USER;

  IF NOT FOUND OR (NOT v_current_role.rolsuper AND NOT v_current_role.rolcreaterole) THEN
    RAISE EXCEPTION 'standalone AI migration requires a role with CREATEROLE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
     WHERE rolname IN ('sip_mvp_runtime', 'sip_mvp_app_login', 'sip_mvp_function_owner')
  ) THEN
    RAISE EXCEPTION 'AI runtime role name already exists; inspect and reconcile before migration';
  END IF;

  IF pg_catalog.to_regclass('app.assistant_budget_windows') IS NOT NULL
     OR pg_catalog.to_regclass('app.assistant_token_reservations') IS NOT NULL
     OR pg_catalog.to_regclass('app.assistant_demo_response_quotas') IS NOT NULL
     OR pg_catalog.to_regclass('app.assistant_demo_response_reservations') IS NOT NULL THEN
    RAISE EXCEPTION 'AI budget or quota table already exists; inspect and reconcile before migration';
  END IF;

  IF pg_catalog.to_regprocedure('app.reserve_assistant_token_budget(uuid,bigint)') IS NOT NULL
     OR pg_catalog.to_regprocedure('app.settle_assistant_token_budget(uuid,bigint)') IS NOT NULL
     OR pg_catalog.to_regprocedure('app.reserve_assistant_demo_response(uuid)') IS NOT NULL
     OR pg_catalog.to_regprocedure('app.settle_assistant_demo_response(uuid,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'AI budget or quota function already exists; inspect and reconcile before migration';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'app'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app'
  ) THEN
    RAISE EXCEPTION 'schema app is not empty; inspect and reconcile before standalone migration';
  END IF;
END
$preflight$;

-- Dedicated runtime, app LOGIN, and NOLOGIN SECURITY DEFINER owner roles.
-- The LOGIN has no password until an out-of-band credential is provisioned.
CREATE ROLE sip_mvp_runtime
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE sip_mvp_app_login
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE sip_mvp_function_owner
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

CREATE SCHEMA IF NOT EXISTS app;

DO $schema_owner_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_namespace
     WHERE nspname = 'app'
       AND nspowner = (CURRENT_USER::regrole)::oid
  ) THEN
    RAISE EXCEPTION 'migration role must own schema app; inspect existing schema ownership first';
  END IF;
END
$schema_owner_check$;

REVOKE CREATE ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON SCHEMA app FROM sip_mvp_runtime, sip_mvp_app_login;
GRANT USAGE ON SCHEMA app TO sip_mvp_runtime, sip_mvp_function_owner;
GRANT CREATE ON SCHEMA app TO sip_mvp_function_owner;
REVOKE CREATE ON SCHEMA public FROM sip_mvp_runtime, sip_mvp_app_login, sip_mvp_function_owner;

DO $runtime_login$
BEGIN
  EXECUTE pg_catalog.format(
    'GRANT CONNECT ON DATABASE %I TO sip_mvp_app_login',
    pg_catalog.current_database()
  );
END
$runtime_login$;

GRANT sip_mvp_runtime TO sip_mvp_app_login
  WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;

COMMENT ON ROLE sip_mvp_runtime IS
  'NOLOGIN, NOBYPASSRLS runtime grant role; execute only the approved AI budget/quota functions.';
COMMENT ON ROLE sip_mvp_app_login IS
  'LOGIN principal inheriting sip_mvp_runtime only; provision its password out of band.';
COMMENT ON ROLE sip_mvp_function_owner IS
  'NOLOGIN, NOBYPASSRLS owner of AI SECURITY DEFINER functions with access only to AI budget/quota tables.';

-- Minimum shared token-budget schema, independent of action-session tables.
CREATE TABLE app.assistant_budget_windows (
  budget_key text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  budget_limit_tokens bigint NOT NULL DEFAULT 100000
    CHECK (budget_limit_tokens = 100000),
  reserved_tokens bigint NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0),
  spent_tokens bigint NOT NULL DEFAULT 0 CHECK (spent_tokens >= 0),
  PRIMARY KEY (budget_key, window_start),
  CHECK (window_end > window_start)
);

CREATE TABLE app.assistant_token_reservations (
  reservation_id uuid PRIMARY KEY,
  budget_key text NOT NULL,
  window_start timestamptz NOT NULL,
  reserved_tokens bigint NOT NULL CHECK (reserved_tokens > 0),
  settled_tokens bigint CHECK (settled_tokens >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  settled_at timestamptz,
  FOREIGN KEY (budget_key, window_start)
    REFERENCES app.assistant_budget_windows (budget_key, window_start),
  CHECK ((settled_tokens IS NULL) = (settled_at IS NULL))
);

ALTER TABLE app.assistant_budget_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_token_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.assistant_budget_windows,
  app.assistant_token_reservations FROM PUBLIC, sip_mvp_runtime, sip_mvp_app_login;
GRANT SELECT, INSERT, UPDATE ON
  app.assistant_budget_windows,
  app.assistant_token_reservations
TO sip_mvp_function_owner;
CREATE POLICY assistant_budget_windows_fn_owner
  ON app.assistant_budget_windows
  FOR ALL TO sip_mvp_function_owner USING (true) WITH CHECK (true);
CREATE POLICY assistant_token_reservations_fn_owner
  ON app.assistant_token_reservations
  FOR ALL TO sip_mvp_function_owner USING (true) WITH CHECK (true);

CREATE TABLE app.assistant_demo_response_quotas (
  quota_key text PRIMARY KEY CHECK (quota_key = 'public-demo'),
  successful_responses integer NOT NULL DEFAULT 0
    CHECK (successful_responses >= 0 AND successful_responses <= 10)
);

INSERT INTO app.assistant_demo_response_quotas (quota_key)
VALUES ('public-demo');

CREATE TABLE app.assistant_demo_response_reservations (
  reservation_id uuid PRIMARY KEY,
  quota_key text NOT NULL DEFAULT 'public-demo'
    REFERENCES app.assistant_demo_response_quotas (quota_key),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'released')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  settled_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK ((status = 'pending') = (settled_at IS NULL))
);

CREATE INDEX assistant_demo_response_pending_idx
  ON app.assistant_demo_response_reservations (quota_key, expires_at)
  WHERE status = 'pending';

ALTER TABLE app.assistant_demo_response_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_demo_response_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.assistant_demo_response_quotas FROM PUBLIC, sip_mvp_runtime;
REVOKE ALL ON app.assistant_demo_response_reservations FROM PUBLIC, sip_mvp_runtime;
GRANT SELECT, INSERT, UPDATE ON
  app.assistant_demo_response_quotas,
  app.assistant_demo_response_reservations
TO sip_mvp_function_owner;

CREATE POLICY assistant_demo_response_quotas_fn_owner
  ON app.assistant_demo_response_quotas
  FOR ALL TO sip_mvp_function_owner USING (true) WITH CHECK (true);
CREATE POLICY assistant_demo_response_reservations_fn_owner
  ON app.assistant_demo_response_reservations
  FOR ALL TO sip_mvp_function_owner USING (true) WITH CHECK (true);

-- Deployment-shared atomic UTC-hour token accounting.
CREATE FUNCTION app.reserve_assistant_token_budget(
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

CREATE FUNCTION app.settle_assistant_token_budget(
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

CREATE FUNCTION app.reserve_assistant_demo_response(
  p_reservation_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $function$
DECLARE
  v_successful integer;
  v_pending integer;
  v_inserted integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_reservation_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT successful_responses
    INTO v_successful
    FROM app.assistant_demo_response_quotas
   WHERE quota_key = 'public-demo'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE app.assistant_demo_response_reservations
     SET status = 'released', settled_at = v_now
   WHERE quota_key = 'public-demo'
     AND status = 'pending'
     AND expires_at <= v_now;

  SELECT count(*)::integer
    INTO v_pending
    FROM app.assistant_demo_response_reservations
   WHERE quota_key = 'public-demo' AND status = 'pending';
  IF v_successful + v_pending >= 10 THEN
    RETURN false;
  END IF;

  INSERT INTO app.assistant_demo_response_reservations (
    reservation_id, quota_key, status, created_at, expires_at
  ) VALUES (
    p_reservation_id, 'public-demo', 'pending', v_now,
    v_now + interval '10 minutes'
  ) ON CONFLICT (reservation_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted = 1;
END
$function$;

CREATE FUNCTION app.settle_assistant_demo_response(
  p_reservation_id uuid,
  p_success boolean
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $function$
DECLARE
  v_successful integer;
  v_status text;
  v_expires_at timestamptz;
  v_now timestamptz := clock_timestamp();
  v_updated integer;
BEGIN
  IF p_reservation_id IS NULL OR p_success IS NULL THEN
    RETURN false;
  END IF;

  SELECT successful_responses
    INTO v_successful
    FROM app.assistant_demo_response_quotas
   WHERE quota_key = 'public-demo'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT status, expires_at
    INTO v_status, v_expires_at
    FROM app.assistant_demo_response_reservations
   WHERE reservation_id = p_reservation_id AND quota_key = 'public-demo'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_status = 'succeeded' THEN
    RETURN p_success;
  END IF;
  IF v_status = 'released' THEN
    RETURN NOT p_success;
  END IF;
  IF v_expires_at <= v_now THEN
    UPDATE app.assistant_demo_response_reservations
       SET status = 'released', settled_at = v_now
     WHERE reservation_id = p_reservation_id;
    RETURN NOT p_success;
  END IF;

  IF p_success THEN
    UPDATE app.assistant_demo_response_quotas
       SET successful_responses = successful_responses + 1
     WHERE quota_key = 'public-demo' AND successful_responses < 10;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      UPDATE app.assistant_demo_response_reservations
         SET status = 'released', settled_at = v_now
       WHERE reservation_id = p_reservation_id;
      RETURN false;
    END IF;
  END IF;

  UPDATE app.assistant_demo_response_reservations
     SET status = CASE WHEN p_success THEN 'succeeded' ELSE 'released' END,
         settled_at = v_now
   WHERE reservation_id = p_reservation_id;
  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION app.reserve_assistant_token_budget(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.settle_assistant_token_budget(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.reserve_assistant_demo_response(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.settle_assistant_demo_response(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reserve_assistant_token_budget(uuid, bigint) TO sip_mvp_runtime;
GRANT EXECUTE ON FUNCTION app.settle_assistant_token_budget(uuid, bigint) TO sip_mvp_runtime;
GRANT EXECUTE ON FUNCTION app.reserve_assistant_demo_response(uuid) TO sip_mvp_runtime;
GRANT EXECUTE ON FUNCTION app.settle_assistant_demo_response(uuid, boolean) TO sip_mvp_runtime;

COMMENT ON FUNCTION app.reserve_assistant_demo_response(uuid) IS
  'Atomically reserves one of at most ten successful public AI demo responses across the deployment.';
COMMENT ON FUNCTION app.settle_assistant_demo_response(uuid, boolean) IS
  'Consumes a demo response slot only after a validated answer, or releases it after failure.';

-- PostgreSQL 18 may retain an ADMIN-only membership for the CREATEROLE
-- principal that created this role. That principal is trusted migration
-- infrastructure and must never be used as an application runtime identity.
GRANT sip_mvp_function_owner TO CURRENT_USER
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY CURRENT_USER;
ALTER FUNCTION app.reserve_assistant_token_budget(uuid, bigint) OWNER TO sip_mvp_function_owner;
ALTER FUNCTION app.settle_assistant_token_budget(uuid, bigint) OWNER TO sip_mvp_function_owner;
ALTER FUNCTION app.reserve_assistant_demo_response(uuid) OWNER TO sip_mvp_function_owner;
ALTER FUNCTION app.settle_assistant_demo_response(uuid, boolean) OWNER TO sip_mvp_function_owner;
REVOKE CREATE ON SCHEMA app FROM sip_mvp_function_owner;
REVOKE sip_mvp_function_owner FROM CURRENT_USER GRANTED BY CURRENT_USER;

DO $verify_owner_membership$
BEGIN
  IF pg_catalog.pg_has_role(CURRENT_USER, 'sip_mvp_function_owner', 'USAGE')
     OR pg_catalog.pg_has_role(CURRENT_USER, 'sip_mvp_function_owner', 'SET') THEN
    RAISE EXCEPTION 'temporary function-owner SET/INHERIT privileges were not revoked';
  END IF;
  IF pg_catalog.pg_has_role('sip_mvp_app_login', 'sip_mvp_function_owner', 'MEMBER')
     OR pg_catalog.pg_has_role('sip_mvp_runtime', 'sip_mvp_function_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'application roles must not be members of sip_mvp_function_owner';
  END IF;
END
$verify_owner_membership$;
