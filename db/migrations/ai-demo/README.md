# Standalone AI demo migration

This is the intended schema track for the deployed assistant runtime. The Phase 8D read-only production audit confirmed that the four installed AI quota and token-budget functions match this migration. Do not rerun it against production. The preflight state described below is historical; any fresh database requires its own read-only preflight before installation.

Apply only `0001_standalone_ai_demo.sql`. It creates the `app` schema when absent, four budget/quota tables, three restricted roles, and four `app.*` atomic functions used by the existing adapters. It does not depend on root migrations `0001`-`0003`, and creates no action-session or evidence-registry objects. It inserts only the fixed public-demo quota row; it does not create evidence records.

The migration intentionally stops if any target role, AI table/function, or relation/function in `app` already exists. The inspected production preflight reported no `app` tables and none of the three roles; still verify the function names and schema owner immediately before execution. Run it with an authorized migration identity that has `CREATEROLE`, owns `app` (if it already exists), can grant `CONNECT`, and can temporarily `SET ROLE` to `sip_mvp_function_owner`. Do not use `sip_mvp_app_login` for migrations. Provision the LOGIN password out of band; no credential belongs in SQL.

Use a single transaction so any error rolls back the role, schema, tables, functions, grants, and quota seed together:

```powershell
psql "service=neon_prod_migrator" -X -v ON_ERROR_STOP=1 --single-transaction -f db/migrations/ai-demo/0001_standalone_ai_demo.sql
```

The quota is cumulative and intentionally has no reset function. Successful responses consume one of ten total slots across deployments using this database; pending reservations expire after ten minutes. Keep `ASSISTANT_ENABLED=false` and `SHARED_RUNTIME_VERIFIED=false` until runtime credentials, grants, atomic behavior, and safety gates have been independently verified.

PostgreSQL 18 may retain an ADMIN-only membership for the CREATEROLE migration identity on roles it creates. The migration removes its temporary SET/INHERIT grant and verifies those access paths are gone, but the migration identity must remain trusted and separate from runtime credentials. Verify `pg_auth_members.admin_option` after execution; the app login must not be a member of `sip_mvp_function_owner`.
