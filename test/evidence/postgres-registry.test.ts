import { describe, expect, it } from "vitest";
import { createPostgresEvidenceRegistry } from "@/lib/evidence/postgres-registry";
import type { PostgresQueryable, PostgresQueryResult } from "@/lib/db/postgres";

class EmptyDatabase implements PostgresQueryable {
  calls = 0;
  texts: string[] = [];
  fail = false;
  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
  ): Promise<PostgresQueryResult<Row>> {
    this.calls += 1;
    this.texts.push(text);
    if (this.fail) throw new Error("database unavailable");
    return { rows: [] };
  }
}

describe("approved evidence registry adapter", () => {
  it("returns no records for an empty or unseeded registry", async () => {
    const database = new EmptyDatabase();
    const registry = createPostgresEvidenceRegistry(database);
    expect(await registry.findApproved([])).toEqual([]);
    expect(database.calls).toBe(0);
    expect(await registry.findApproved(["requested-id"])).toEqual([]);
    expect(database.calls).toBe(1);
    expect(database.texts[0]).toContain("app.get_approved_evidence");
  });

  it("propagates database errors instead of presenting unverified evidence", async () => {
    const database = new EmptyDatabase();
    database.fail = true;
    const registry = createPostgresEvidenceRegistry(database);
    await expect(registry.findApproved(["requested-id"])).rejects.toThrow("database unavailable");
  });
});
