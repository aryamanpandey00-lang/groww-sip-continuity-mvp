import "server-only";

import type { AssistantDemoQuotaCoordinator } from "./types";
import { readBooleanResult, type PostgresQueryable } from "@/lib/db/postgres";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Deployment-shared, single-use reservations backed by AI-only SQL functions. */
export function createPostgresAssistantDemoQuotaCoordinator(
  database: PostgresQueryable,
): AssistantDemoQuotaCoordinator {
  return {
    scope: "deployment-shared",
    async reserve({ reservationId }) {
      if (!UUID_PATTERN.test(reservationId)) return null;

      const reservation = await database.query<{ ok: unknown }>(
        "SELECT app.reserve_assistant_demo_response($1::uuid) AS ok",
        [reservationId],
      );
      if (reservation.rows.length !== 1 || typeof reservation.rows[0]?.ok !== "boolean") {
        throw new Error("PostgreSQL demo quota returned an invalid reservation result.");
      }
      if (!reservation.rows[0].ok) return null;

      let settledOutcome: boolean | null = null;
      let inFlight: { success: boolean; promise: Promise<void> } | null = null;

      return {
        async settle(success) {
          if (settledOutcome !== null) {
            if (settledOutcome !== success) {
              throw new Error("PostgreSQL demo quota reservation was already settled differently.");
            }
            return;
          }
          if (inFlight) {
            if (inFlight.success !== success) {
              throw new Error("PostgreSQL demo quota reservation is settling differently.");
            }
            return inFlight.promise;
          }

          const promise = (async () => {
            const result = await database.query<{ ok: unknown }>(
              "SELECT app.settle_assistant_demo_response($1::uuid, $2::boolean) AS ok",
              [reservationId, success],
            );
            if (!readBooleanResult(result.rows, "demo quota settlement")) {
              throw new Error("PostgreSQL demo quota reservation could not be settled.");
            }
            settledOutcome = success;
          })();
          inFlight = { success, promise };
          try {
            await promise;
          } finally {
            inFlight = null;
          }
        },
      };
    },
  };
}
