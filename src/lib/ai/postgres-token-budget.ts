import "server-only";

import type { AssistantTokenBudgetCoordinator } from "./types";
import { readBooleanResult, type PostgresQueryable } from "@/lib/db/postgres";

/** Deployment-shared coordinator backed by the atomic functions in migration 0003. */
export function createPostgresAssistantTokenBudgetCoordinator(
  database: PostgresQueryable,
): AssistantTokenBudgetCoordinator {
  return {
    scope: "deployment-shared",
    async reserve({ reservationId, maxTokens }) {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reservationId) ||
        !Number.isSafeInteger(maxTokens) || maxTokens <= 0
      ) {
        return null;
      }

      const result = await database.query<{ ok: unknown }>(
        "SELECT app.reserve_assistant_token_budget($1::uuid, $2::bigint) AS ok",
        [reservationId, maxTokens],
      );
      if (result.rows.length !== 1 || typeof result.rows[0]?.ok !== "boolean") {
        throw new Error("PostgreSQL token reservation returned an invalid result.");
      }
      if (!result.rows[0].ok) return null;

      let settling = false;
      let settled = false;
      return {
        async settle(actualTokens) {
          if (settled || settling) return;
          settling = true;
          try {
            const charge =
              actualTokens !== null &&
              Number.isSafeInteger(actualTokens) &&
              actualTokens >= 0
                ? actualTokens
                : null;
            const settlement = await database.query<{ ok: unknown }>(
              "SELECT app.settle_assistant_token_budget($1::uuid, $2::bigint) AS ok",
              [reservationId, charge],
            );
            if (!readBooleanResult(settlement.rows, "token settlement")) {
              throw new Error("PostgreSQL token reservation could not be settled.");
            }
            settled = true;
          } finally {
            settling = false;
          }
        },
      };
    },
  };
}
