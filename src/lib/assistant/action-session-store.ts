import "server-only";

import type { PostgresQueryable } from "@/lib/db/postgres";
import { isActionDemoSession, type ActionDemoSession } from "./action-session";

export interface ActionSessionExpectation {
  sessionId: string;
  cookieHash: Uint8Array;
  stateVersion: number;
}

export interface SharedActionSessionStore {
  readonly scope: "deployment-shared";
  load(expected: ActionSessionExpectation): Promise<ActionDemoSession | null>;
  create(session: ActionDemoSession, cookieHash: Uint8Array): Promise<boolean>;
  replace(
    expected: ActionSessionExpectation,
    nextSession: ActionDemoSession,
    nextCookieHash: Uint8Array,
  ): Promise<boolean>;
  confirm(
    expected: ActionSessionExpectation,
    previewId: string,
    allowAction: boolean,
    nextSession: ActionDemoSession,
    nextCookieHash: Uint8Array,
  ): Promise<boolean>;
  reset(
    expected: ActionSessionExpectation | null,
    nextSession: ActionDemoSession,
    nextCookieHash: Uint8Array,
  ): Promise<boolean>;
}

function pgBytea(hash: Uint8Array): Buffer {
  if (hash.byteLength !== 32) throw new Error("Session cookie hash must be SHA-256.");
  return Buffer.from(hash);
}

function pgUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("Action session identifier is invalid.");
  }
  return value;
}

function readOk(rows: Array<Record<string, unknown>>, operation: string): boolean {
  if (rows.length !== 1 || typeof rows[0]?.ok !== "boolean") {
    throw new Error(`PostgreSQL action ${operation} returned an invalid result.`);
  }
  return rows[0].ok;
}

export function createPostgresActionSessionStore(
  database: PostgresQueryable,
): SharedActionSessionStore {
  return {
    scope: "deployment-shared",
    async load(expected) {
      const result = await database.query<{ session_data: unknown }>(
        "SELECT app.get_action_session($1::uuid, $2::bytea, $3::bigint) AS session_data",
        [pgUuid(expected.sessionId), pgBytea(expected.cookieHash), expected.stateVersion],
      );
      if (result.rows.length === 0) return null;
      if (result.rows.length !== 1 || !isActionDemoSession(result.rows[0]?.session_data)) {
        throw new Error("PostgreSQL action session returned invalid canonical state.");
      }
      const session = result.rows[0].session_data;
      if (session.sessionId !== expected.sessionId || session.stateVersion !== expected.stateVersion) {
        throw new Error("PostgreSQL action session identity did not match its row.");
      }
      return session;
    },
    async create(session, cookieHash) {
      const result = await database.query<{ ok: unknown }>(
        "SELECT app.create_action_session($1::uuid, $2::jsonb, $3::bytea) AS ok",
        [pgUuid(session.sessionId), JSON.stringify(session), pgBytea(cookieHash)],
      );
      return readOk(result.rows, "create") && result.rows[0]!.ok === true;
    },
    async replace(expected, nextSession, nextCookieHash) {
      const result = await database.query<{ ok: unknown }>(
        "SELECT app.replace_action_session($1::uuid, $2::bytea, $3::bigint, $4::uuid, $5::jsonb, $6::bytea) AS ok",
        [
          pgUuid(expected.sessionId), pgBytea(expected.cookieHash), expected.stateVersion,
          pgUuid(nextSession.sessionId), JSON.stringify(nextSession), pgBytea(nextCookieHash),
        ],
      );
      return readOk(result.rows, "replace") && result.rows[0]!.ok === true;
    },
    async confirm(expected, previewId, allowAction, nextSession, nextCookieHash) {
      const result = await database.query<{ ok: unknown }>(
        "SELECT app.confirm_action_preview($1::uuid, $2::bytea, $3::bigint, $4::uuid, $5::boolean, $6::jsonb, $7::bytea) AS ok",
        [
          pgUuid(expected.sessionId), pgBytea(expected.cookieHash), expected.stateVersion,
          pgUuid(previewId), allowAction, JSON.stringify(nextSession), pgBytea(nextCookieHash),
        ],
      );
      return readOk(result.rows, "confirm") && result.rows[0]!.ok === true;
    },
    async reset(expected, nextSession, nextCookieHash) {
      const result = await database.query<{ ok: unknown }>(
        "SELECT app.reset_action_session($1::uuid, $2::bytea, $3::bigint, $4::uuid, $5::jsonb, $6::bytea) AS ok",
        [
          expected ? pgUuid(expected.sessionId) : null,
          expected ? pgBytea(expected.cookieHash) : null,
          expected?.stateVersion ?? null,
          pgUuid(nextSession.sessionId), JSON.stringify(nextSession), pgBytea(nextCookieHash),
        ],
      );
      return readOk(result.rows, "reset") && result.rows[0]!.ok === true;
    },
  };
}
