import { describe, expect, it, vi } from "vitest";
import {
  createNeonPostgresQueryable,
  type NeonHttpClientFactory,
} from "@/lib/db/neon";
import {
  createNeonAssistantRuntimeAdapters,
  createNeonSharedRuntimeAdapters,
} from "@/lib/db/runtime-adapters";

const TEST_RUNTIME_URL = "postgresql://sip_runtime:test-only@ep-unit-test.neon.tech/neondb";

describe("Neon HTTP PostgreSQL connection adapter", () => {
  it("initializes lazily, forwards parameterized queries, and returns adapter rows", async () => {
    const query = vi.fn(async () => [{ ok: true }]);
    const createClient = vi.fn(() => ({ query })) as unknown as NeonHttpClientFactory;
    const database = createNeonPostgresQueryable({
      env: { DATABASE_RUNTIME_URL: TEST_RUNTIME_URL },
      createClient,
    });

    expect(createClient).not.toHaveBeenCalled();
    const result = await database.query<{ ok: boolean }>(
      "SELECT $1::boolean AS ok",
      [true],
    );

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith("SELECT $1::boolean AS ok", [true]);
    expect(result).toEqual({ rows: [{ ok: true }] });
  });

  it("reuses the stateless HTTP client within the adapter instance", async () => {
    const query = vi.fn(async () => []);
    const createClient = vi.fn(() => ({ query })) as unknown as NeonHttpClientFactory;
    const database = createNeonPostgresQueryable({
      env: { DATABASE_RUNTIME_URL: TEST_RUNTIME_URL },
      createClient,
    });
    await database.query("SELECT 1");
    await database.query("SELECT 2");
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("requires a separate runtime URL and rejects the migration owner role", async () => {
    const createClient = vi.fn(() => ({ query: vi.fn(async () => []) })) as unknown as NeonHttpClientFactory;
    const migrationOnly = createNeonPostgresQueryable({
      env: { DATABASE_URL: TEST_RUNTIME_URL },
      createClient,
    });
    await expect(migrationOnly.query("SELECT 1")).rejects.toThrow("not configured");
    expect(createClient).not.toHaveBeenCalled();

    const owner = createNeonPostgresQueryable({
      env: { DATABASE_RUNTIME_URL: "postgresql://neondb_owner:test-only@ep-test.neon.tech/neondb" },
      createClient,
    });
    await expect(owner.query("SELECT 1")).rejects.toThrow("configuration is invalid");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("sanitizes client initialization and query failures", async () => {
    const createClientFailure = createNeonPostgresQueryable({
      env: { DATABASE_RUNTIME_URL: TEST_RUNTIME_URL },
      createClient: () => { throw new Error("password=must-not-escape"); },
    });
    await expect(createClientFailure.query("SELECT 1")).rejects.toThrow("client could not be initialized");

    const queryFailure = createNeonPostgresQueryable({
      env: { DATABASE_RUNTIME_URL: TEST_RUNTIME_URL },
      createClient: () => ({ query: async () => { throw new Error("password=must-not-escape"); } }),
    });
    await expect(queryFailure.query("SELECT 1")).rejects.toThrow("query failed");
    await expect(queryFailure.query("SELECT 1")).rejects.not.toThrow("must-not-escape");
  });

  it("rejects an invalid Neon response shape", async () => {
    const database = createNeonPostgresQueryable({
      env: { DATABASE_RUNTIME_URL: TEST_RUNTIME_URL },
      createClient: () => ({ query: async () => ({ rows: [] }) }),
    });
    await expect(database.query("SELECT 1")).rejects.toThrow("invalid result");
  });

  it("composes all shared adapters without querying or enabling routes", () => {
    const createClient = vi.fn(() => ({ query: vi.fn(async () => []) })) as unknown as NeonHttpClientFactory;
    const adapters = createNeonSharedRuntimeAdapters(
      { DATABASE_RUNTIME_URL: TEST_RUNTIME_URL, SHARED_RUNTIME_VERIFIED: "false" },
      createClient,
    );
    expect(adapters.tokenBudgetCoordinator.scope).toBe("deployment-shared");
    expect(adapters.actionSessionStore.scope).toBe("deployment-shared");
    expect(adapters.evidenceRegistry.findApproved).toBeTypeOf("function");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("composes only the shared AI budget and response quota lazily", () => {
    const createClient = vi.fn(() => ({ query: vi.fn(async () => []) })) as unknown as NeonHttpClientFactory;
    const adapters = createNeonAssistantRuntimeAdapters(
      { DATABASE_RUNTIME_URL: TEST_RUNTIME_URL, SHARED_RUNTIME_VERIFIED: "false" },
      createClient,
    );

    expect(adapters.tokenBudgetCoordinator.scope).toBe("deployment-shared");
    expect(adapters.demoQuotaCoordinator.scope).toBe("deployment-shared");
    expect(createClient).not.toHaveBeenCalled();
  });
});
