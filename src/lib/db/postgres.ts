import "server-only";

/** Minimal adapter surface for a PostgreSQL-compatible pool or client. */
export interface PostgresQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
}

export interface PostgresQueryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<PostgresQueryResult<Row>>;
}

export function readBooleanResult(
  rows: Array<Record<string, unknown>>,
  operation: string,
): boolean {
  if (rows.length !== 1 || typeof rows[0]?.ok !== "boolean") {
    throw new Error(`PostgreSQL ${operation} returned an invalid result.`);
  }
  return rows[0].ok;
}
