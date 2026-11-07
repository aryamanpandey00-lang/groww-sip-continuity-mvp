import "server-only";

import { neon } from "@neondatabase/serverless";
import type { PostgresQueryable, PostgresQueryResult } from "./postgres";

const RUNTIME_DATABASE_URL_VARIABLE = "DATABASE_RUNTIME_URL";

interface NeonHttpClient {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

export type NeonHttpClientFactory = (connectionString: string) => NeonHttpClient;

export interface NeonPostgresQueryableOptions {
  /** Tests may provide an isolated env object. Application code uses process.env. */
  env?: Record<string, string | undefined>;
  /** Test seam; production defaults to Neon's HTTP query client. */
  createClient?: NeonHttpClientFactory;
}

function runtimeConnectionString(
  env: Record<string, string | undefined>,
): string {
  const connectionString = env[RUNTIME_DATABASE_URL_VARIABLE];
  if (!connectionString) {
    throw new Error("Runtime PostgreSQL is not configured.");
  }

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("Runtime PostgreSQL configuration is invalid.");
  }
  let username: string;
  try {
    username = decodeURIComponent(parsed.username).toLowerCase();
  } catch {
    throw new Error("Runtime PostgreSQL configuration is invalid.");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    username === "neondb_owner"
  ) {
    throw new Error("Runtime PostgreSQL configuration is invalid.");
  }
  return connectionString;
}

const defaultNeonClientFactory: NeonHttpClientFactory = (connectionString) =>
  neon(connectionString) as unknown as NeonHttpClient;

/**
 * Lazy, HTTP-based Neon query adapter. It never reads DATABASE_URL or a
 * migration URL, and creates no connection until the first query is issued.
 */
export function createNeonPostgresQueryable(
  options: NeonPostgresQueryableOptions = {},
): PostgresQueryable {
  const env = options.env ?? process.env;
  const createClient = options.createClient ?? defaultNeonClientFactory;
  let client: NeonHttpClient | null = null;

  return {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<PostgresQueryResult<Row>> {
      if (!text.trim()) throw new Error("PostgreSQL query is empty.");

      if (!client) {
        const connectionString = runtimeConnectionString(env);
        try {
          client = createClient(connectionString);
        } catch {
          throw new Error("Runtime PostgreSQL client could not be initialized.");
        }
      }

      let rows: unknown;
      try {
        rows = await client.query(text, values);
      } catch {
        throw new Error("Runtime PostgreSQL query failed.");
      }
      if (!Array.isArray(rows)) {
        throw new Error("Runtime PostgreSQL returned an invalid result.");
      }
      return { rows: rows as Row[] };
    },
  };
}
