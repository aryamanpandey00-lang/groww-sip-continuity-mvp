import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrations = path.join(process.cwd(), "db", "migrations");

describe("Phase 8C migration review guards", () => {
  it("contains the three ordered migrations without seeded evidence records", () => {
    expect(fs.readdirSync(migrations).sort()).toEqual([
      "0001_sip_mvp_schema.sql",
      "0002_runtime_role.sql",
      "0003_atomic_operations.sql",
      "ai-demo",
    ]);
    const schema = fs.readFileSync(path.join(migrations, "0001_sip_mvp_schema.sql"), "utf8");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS app.evidence_registry");
    expect(schema).not.toMatch(/INSERT\s+INTO\s+app\.evidence_registry/i);
  });

  it("separates the LOGIN principal, runtime grant role, and function owner", () => {
    const roles = fs.readFileSync(path.join(migrations, "0002_runtime_role.sql"), "utf8");
    expect(roles).toMatch(/CREATE ROLE sip_mvp_runtime NOLOGIN[\s\S]*?NOBYPASSRLS/i);
    expect(roles).toMatch(/CREATE ROLE sip_mvp_function_owner NOLOGIN[\s\S]*?NOBYPASSRLS/i);
    expect(roles).toMatch(/CREATE ROLE sip_mvp_app_login LOGIN[\s\S]*?NOINHERIT NOBYPASSRLS/i);
    expect(roles).toMatch(/ALTER ROLE sip_mvp_app_login WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS/i);
    expect(roles).toContain("WITH ADMIN FALSE, INHERIT TRUE, SET FALSE");
    expect(roles).toContain("GRANT CONNECT ON DATABASE %I TO sip_mvp_app_login");
    expect(roles).toContain("REVOKE ALL ON SCHEMA app FROM sip_mvp_app_login");
    expect(roles).toContain("REVOKE ALL ON ALL TABLES IN SCHEMA app FROM sip_mvp_app_login");
    expect(roles).toContain("REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM sip_mvp_app_login");
    expect(roles).toContain("REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM sip_mvp_app_login");
    expect(roles).not.toMatch(/\bPASSWORD\b/i);
    expect(roles).toContain("REVOKE ALL ON ALL TABLES IN SCHEMA app FROM sip_mvp_runtime");
    expect(roles).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)[\s\S]{0,100}TO\s+sip_mvp_runtime/i);
    expect(roles.match(/GRANT\s+sip_mvp_runtime\s+TO\s+sip_mvp_app_login/gi)).toHaveLength(1);
  });

  it("pins each app-schema definer function and limits execute grants", () => {
    const sql = fs.readFileSync(path.join(migrations, "0003_atomic_operations.sql"), "utf8");
    const functionNames = [...sql.matchAll(/CREATE OR REPLACE FUNCTION app\.([a-z_]+)/gi)].map((match) => match[1]!);
    expect(functionNames.length).toBeGreaterThanOrEqual(10);
    expect(sql).not.toMatch(/\bsip_mvp\./i);
    expect((sql.match(/SECURITY DEFINER/gi) ?? []).length).toBe(functionNames.length);
    expect((sql.match(/SET search_path = pg_catalog, app, pg_temp/gi) ?? []).length).toBe(functionNames.length);
    for (const name of functionNames) {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION app\\.${name}\\(`, "i"));
    }
    const executeGrants = [...sql.matchAll(/GRANT EXECUTE ON FUNCTION [^;]+ TO ([a-z_]+);/gi)];
    expect(executeGrants.length).toBeGreaterThan(0);
    expect(executeGrants.every((grant) => grant[1] === "sip_mvp_runtime")).toBe(true);
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION app.get_approved_evidence(text[]) TO sip_mvp_runtime");
    expect(sql).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)[\s\S]{0,100}TO\s+sip_mvp_runtime/i);
  });

  it("uses explicit temporary owner membership and verifies its elevated options are revoked", () => {
    const sql = fs.readFileSync(path.join(migrations, "0003_atomic_operations.sql"), "utf8");
    const grant = sql.indexOf("GRANT sip_mvp_function_owner TO CURRENT_USER");
    const revoke = sql.indexOf("REVOKE sip_mvp_function_owner FROM CURRENT_USER");
    const verification = sql.indexOf("temporary function-owner privileges were not revoked");
    const transfers = [...sql.matchAll(/ALTER FUNCTION app\.[a-z_]+\([^\n]*\) OWNER TO sip_mvp_function_owner;/gi)];

    expect(grant).toBeGreaterThanOrEqual(0);
    expect(sql).toContain("WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY CURRENT_USER");
    expect(sql).toContain("REVOKE sip_mvp_function_owner FROM CURRENT_USER GRANTED BY CURRENT_USER");
    expect(transfers.length).toBeGreaterThanOrEqual(10);
    expect(transfers.every((transfer) => transfer.index! > grant && transfer.index! < revoke)).toBe(true);
    expect(revoke).toBeGreaterThan(grant);
    expect(verification).toBeGreaterThan(revoke);
    expect(sql).toContain("pg_catalog.pg_has_role(CURRENT_USER, 'sip_mvp_function_owner', 'USAGE')");
    expect(sql).toContain("pg_catalog.pg_has_role(CURRENT_USER, 'sip_mvp_function_owner', 'SET')");
  });

  it("keeps migration order and TypeScript adapters on the app schema contract", () => {
    const ordered = [
      "0001_sip_mvp_schema.sql",
      "0002_runtime_role.sql",
      "0003_atomic_operations.sql",
      "ai-demo",
    ];
    expect(fs.readdirSync(migrations).sort()).toEqual(ordered);
    const allMigrationSql = ordered
      .filter((file) => file.endsWith(".sql"))
      .map((file) => fs.readFileSync(path.join(migrations, file), "utf8"))
      .join("\n");
    expect(allMigrationSql).toContain("CREATE SCHEMA IF NOT EXISTS app");
    expect(allMigrationSql).not.toMatch(/\bsip_mvp\./i);

    const adapters = [
      "src/lib/ai/postgres-token-budget.ts",
      "src/lib/assistant/action-session-store.ts",
      "src/lib/evidence/postgres-registry.ts",
    ].map((file) => fs.readFileSync(path.join(process.cwd(), file), "utf8"));
    for (const adapter of adapters) {
      expect(adapter).toMatch(/app\./);
      expect(adapter).not.toMatch(/\bsip_mvp\./i);
    }
  });

  it("keeps revocation within the existing replace and reset contract", () => {
    const sql = fs.readFileSync(path.join(migrations, "0003_atomic_operations.sql"), "utf8");
    const adapter = fs.readFileSync(
      path.join(process.cwd(), "src/lib/assistant/action-session-store.ts"),
      "utf8",
    );

    expect(adapter).toContain("replace(");
    expect(adapter).toContain("reset(");
    expect(adapter).not.toMatch(/\brevoke\s*\(/i);
    expect(sql).toMatch(/FUNCTION app\.replace_action_session[\s\S]*?SET revoked_at = clock_timestamp\(\)/i);
    expect(sql).toMatch(/FUNCTION app\.reset_action_session[\s\S]*?SET revoked_at = clock_timestamp\(\)/i);
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION app\.revoke_action_session/i);
  });

  it("keeps the limited AI demo SQL track independent of action-session operations", () => {
    const demoPath = path.join(migrations, "ai-demo");
    expect(fs.readdirSync(demoPath)).toEqual([
      "0001_standalone_ai_demo.sql",
      "README.md",
    ]);

    const sql = fs.readFileSync(path.join(demoPath, "0001_standalone_ai_demo.sql"), "utf8");
    const readme = fs.readFileSync(path.join(demoPath, "README.md"), "utf8");
    expect(sql).toMatch(/CREATE TABLE app\.assistant_demo_response_quotas/i);
    expect(sql).toMatch(/CREATE TABLE app\.assistant_budget_windows/i);
    expect(sql).toMatch(/CREATE TABLE app\.assistant_token_reservations/i);
    expect(sql).toMatch(/CREATE TABLE app\.assistant_demo_response_reservations/i);
    expect([...sql.matchAll(/CREATE TABLE app\.[a-z_]+/gi)]).toHaveLength(4);
    expect(sql).toMatch(/successful_responses <= 10/i);
    expect(sql).toMatch(/v_successful \+ v_pending >= 10/i);
    expect(sql).toMatch(/FOR UPDATE/i);
    expect(sql).toMatch(/interval '10 minutes'/i);
    expect(sql).toMatch(/CREATE ROLE sip_mvp_runtime[\s\S]*?NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS/i);
    expect(sql).toMatch(/CREATE ROLE sip_mvp_app_login[\s\S]*?LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS/i);
    expect(sql).toMatch(/CREATE ROLE sip_mvp_function_owner[\s\S]*?NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS/i);
    expect(sql).toContain("WITH ADMIN FALSE, INHERIT TRUE, SET FALSE");
    expect(sql).not.toMatch(/\bPASSWORD\s*=/i);
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE ON[\s\S]*?TO sip_mvp_function_owner/i);
    expect(sql).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)[\s\S]{0,160}TO\s+sip_mvp_runtime/i);
    expect([...sql.matchAll(/CREATE FUNCTION app\./gi)]).toHaveLength(4);
    expect((sql.match(/^SECURITY DEFINER$/gim) ?? []).length).toBe(4);
    expect((sql.match(/SET search_path = pg_catalog, app, pg_temp/gi) ?? []).length).toBe(4);
    expect((sql.match(/REVOKE ALL ON FUNCTION app\./gi) ?? []).length).toBe(4);
    expect((sql.match(/GRANT EXECUTE ON FUNCTION app\.[^;]+ TO sip_mvp_runtime;/gi) ?? []).length).toBe(4);
    expect((sql.match(/CREATE POLICY [a-z_]+_fn_owner/gi) ?? []).length).toBe(4);
    const lastOwnerTransfer = sql.lastIndexOf("OWNER TO sip_mvp_function_owner;");
    const revokeSchemaCreate = sql.indexOf("REVOKE CREATE ON SCHEMA app FROM sip_mvp_function_owner");
    const revokeOwnerMembership = sql.indexOf("REVOKE sip_mvp_function_owner FROM CURRENT_USER GRANTED BY CURRENT_USER");
    const verifyOwnerMembership = sql.indexOf("DO $verify_owner_membership$");
    expect(lastOwnerTransfer).toBeGreaterThanOrEqual(0);
    expect(revokeSchemaCreate).toBeGreaterThan(lastOwnerTransfer);
    expect(revokeOwnerMembership).toBeGreaterThan(revokeSchemaCreate);
    expect(verifyOwnerMembership).toBeGreaterThan(revokeOwnerMembership);
    expect(sql).toContain("temporary function-owner SET/INHERIT privileges were not revoked");
    expect(sql).toContain("application roles must not be members of sip_mvp_function_owner");
    expect(sql).not.toMatch(/action_sessions|action_previews|evidence_registry|get_approved_evidence/i);
    expect(sql).not.toMatch(/000[123]_[a-z_]+\.sql/i);
    expect(sql).not.toMatch(/\bsip_mvp\./i);
    expect(readme).toContain("does not depend on root migrations `0001`-`0003`");
    expect(readme).toContain("creates no action-session or evidence-registry objects");
    expect(readme).toContain("--single-transaction");
    expect(readme).toContain("The quota is cumulative");
  });

  it("keeps the AI-only token budget functions equivalent to the reviewed atomic migration", () => {
    const rootSql = fs.readFileSync(path.join(migrations, "0003_atomic_operations.sql"), "utf8");
    const demoSql = fs.readFileSync(
      path.join(migrations, "ai-demo", "0001_standalone_ai_demo.sql"),
      "utf8",
    );
    const body = (sql: string, name: string): string => {
      const match = sql.match(new RegExp(
        `CREATE (?:OR REPLACE )?FUNCTION app\\.${name}\\([\\s\\S]*?\\) RETURNS boolean\\s+LANGUAGE plpgsql\\s+SECURITY DEFINER\\s+SET search_path = pg_catalog, app, pg_temp\\s+AS \\$function\\$([\\s\\S]*?)\\$function\\$;`,
        "i",
      ));
      if (!match?.[1]) throw new Error(`Could not find function body for ${name}`);
      return match[1]
        .replace(/--.*$/gm, "")
        .trim()
        .replace(/\s+/g, " ");
    };

    for (const name of ["reserve_assistant_token_budget", "settle_assistant_token_budget"]) {
      expect(body(demoSql, name)).toBe(body(rootSql, name));
    }
  });
});
