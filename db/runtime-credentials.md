# Runtime database credential boundary

Application code reads only `DATABASE_RUNTIME_URL`. It does not fall back to
`DATABASE_URL`, and it rejects a connection URL whose user is `neondb_owner`.
Use a separately provisioned login principal that is a member of
`sip_mvp_runtime` and inherits that role's function grants. Keep the migration
principal and any migration URL in the migration operator's secret store,
outside this application runtime. Do not depend on a per-connection `SET ROLE`
command for the stateless HTTP driver.

The Neon adapter is lazy: importing or constructing the shared adapter bundle
does not make a network request. A query creates Neon's HTTP query client on
first use. Production API routes remain unconfigured, and
`SHARED_RUNTIME_VERIFIED` must remain `false` until the database role, migrations,
and atomic operations have been independently verified.
