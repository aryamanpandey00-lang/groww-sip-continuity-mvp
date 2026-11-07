-- Restricted roles for function-mediated application access.
-- The application LOGIN is separate from both the runtime grant role and the
-- migration owner. Credentials are provisioned out-of-band, never in SQL.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'sip_mvp_runtime') THEN
    EXECUTE 'CREATE ROLE sip_mvp_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'sip_mvp_app_login') THEN
    EXECUTE 'CREATE ROLE sip_mvp_app_login LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'sip_mvp_function_owner') THEN
    EXECUTE 'CREATE ROLE sip_mvp_function_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS';
  END IF;
END
$roles$;

ALTER ROLE sip_mvp_runtime WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE sip_mvp_app_login WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE sip_mvp_function_owner WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO sip_mvp_runtime, sip_mvp_function_owner;
GRANT CREATE ON SCHEMA app TO sip_mvp_function_owner;

GRANT SELECT, INSERT, UPDATE ON
  app.assistant_budget_windows,
  app.assistant_token_reservations,
  app.action_sessions,
  app.action_previews
TO sip_mvp_function_owner;
GRANT SELECT ON app.evidence_registry TO sip_mvp_function_owner;

CREATE POLICY assistant_budget_windows_fn_owner ON app.assistant_budget_windows
  FOR ALL TO sip_mvp_function_owner USING (true) WITH CHECK (true);
CREATE POLICY assistant_token_reservations_fn_owner ON app.assistant_token_reservations
  FOR ALL TO sip_mvp_function_owner USING (true) WITH CHECK (true);
CREATE POLICY action_sessions_fn_owner ON app.action_sessions
  FOR ALL TO sip_mvp_function_owner USING (true) WITH CHECK (true);
CREATE POLICY action_previews_fn_owner ON app.action_previews
  FOR ALL TO sip_mvp_function_owner USING (true) WITH CHECK (true);
CREATE POLICY evidence_registry_fn_owner ON app.evidence_registry
  FOR SELECT TO sip_mvp_function_owner USING (true);

REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM sip_mvp_runtime;
REVOKE ALL ON SCHEMA app FROM sip_mvp_app_login;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM sip_mvp_app_login;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM sip_mvp_app_login;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM sip_mvp_app_login;

-- Give the login only the ability to connect and inherit sip_mvp_runtime's
-- function-mediated privileges. It cannot SET ROLE to the grant role or grant
-- that membership to another role.
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
  'NOLOGIN, NOBYPASSRLS application role; execute approved app functions only.';
COMMENT ON ROLE sip_mvp_app_login IS
  'LOGIN principal with no embedded credential; inherits only sip_mvp_runtime privileges. Provision credentials out-of-band.';
COMMENT ON ROLE sip_mvp_function_owner IS
  'NOLOGIN, NOBYPASSRLS owner of restricted SECURITY DEFINER functions.';
