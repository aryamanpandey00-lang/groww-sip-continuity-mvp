import { describe, expect, it } from "vitest";
import { createPostgresActionSessionStore } from "@/lib/assistant/action-session-store";
import { createActionDemoSession } from "@/lib/assistant/action-session";
import type { PostgresQueryable, PostgresQueryResult } from "@/lib/db/postgres";

class FakeDatabase implements PostgresQueryable {
  calls: Array<{ text: string; values?: unknown[] }> = [];
  nextRows: Array<Record<string, unknown>> = [];
  failure: Error | null = null;

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<PostgresQueryResult<Row>> {
    if (this.failure) throw this.failure;
    this.calls.push({ text, values });
    return { rows: this.nextRows as Row[] };
  }
}

describe("PostgreSQL action session adapter", () => {
  it("loads only validated canonical session state through the CAS lookup", async () => {
    const database = new FakeDatabase();
    const session = createActionDemoSession("BASE");
    database.nextRows = [{ session_data: session }];
    const store = createPostgresActionSessionStore(database);
    const loaded = await store.load({
      sessionId: session.sessionId,
      cookieHash: Buffer.alloc(32, 1),
      stateVersion: session.stateVersion,
    });
    expect(loaded).toEqual(session);
    expect(database.calls[0]?.text).toContain("app.get_action_session");
  });

  it("rejects malformed database state and fails closed on database errors", async () => {
    const database = new FakeDatabase();
    const session = createActionDemoSession("BASE");
    const store = createPostgresActionSessionStore(database);
    database.nextRows = [{ session_data: { ...session, stateVersion: "old" } }];
    await expect(store.load({
      sessionId: session.sessionId,
      cookieHash: Buffer.alloc(32, 1),
      stateVersion: 0,
    })).rejects.toThrow("invalid canonical state");

    database.nextRows = [];
    database.failure = new Error("database unavailable");
    await expect(store.load({
      sessionId: session.sessionId,
      cookieHash: Buffer.alloc(32, 1),
      stateVersion: 0,
    })).rejects.toThrow("database unavailable");
  });

  it("calls one atomic function for each state mutation", async () => {
    const database = new FakeDatabase();
    const session = createActionDemoSession("BASE");
    database.nextRows = [{ ok: true }];
    const store = createPostgresActionSessionStore(database);
    await store.create(session, Buffer.alloc(32, 2));
    await store.replace(
      { sessionId: session.sessionId, cookieHash: Buffer.alloc(32, 2), stateVersion: 0 },
      session,
      Buffer.alloc(32, 3),
    );
    await store.reset(null, session, Buffer.alloc(32, 4));
    expect(database.calls.map((call) => call.text)).toEqual(expect.arrayContaining([
      expect.stringContaining("app.create_action_session"),
      expect.stringContaining("app.replace_action_session"),
      expect.stringContaining("app.reset_action_session"),
    ]));
  });
});
