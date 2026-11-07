import { randomUUID } from "node:crypto";
import type { AssistantDemoQuotaCoordinator } from "./types";

export const ASSISTANT_DEMO_SUCCESS_LIMIT = 10;
export const ASSISTANT_DEMO_RESERVATION_TTL_MS = 10 * 60 * 1_000;

export function createAssistantDemoQuotaReservationId(): string {
  return randomUUID();
}

/** Test/local implementation only. Production requires a shared coordinator. */
export function createInMemoryAssistantDemoQuotaCoordinator(options: {
  maxSuccessfulResponses: number;
}): AssistantDemoQuotaCoordinator & {
  snapshot(): { successfulResponses: number; reservedResponses: number };
} {
  const reservations = new Map<string, "reserved" | "succeeded" | "released">();
  let successfulResponses = 0;
  let reservedResponses = 0;

  return {
    scope: "process-local",
    reserve({ reservationId }) {
      if (
        !reservationId ||
        !Number.isSafeInteger(options.maxSuccessfulResponses) ||
        options.maxSuccessfulResponses < 1 ||
        reservations.has(reservationId) ||
        successfulResponses + reservedResponses >= options.maxSuccessfulResponses
      ) {
        return null;
      }

      reservations.set(reservationId, "reserved");
      reservedResponses += 1;
      return {
        settle(success) {
          const status = reservations.get(reservationId);
          if (status !== "reserved") return;

          reservations.set(reservationId, success ? "succeeded" : "released");
          reservedResponses -= 1;
          if (success) successfulResponses += 1;
        },
      };
    },
    snapshot() {
      return { successfulResponses, reservedResponses };
    },
  };
}

/** Production responses require an explicitly verified deployment-wide quota. */
export function resolveAssistantDemoQuotaCoordinator(
  env: Record<string, string | undefined>,
  injected?: AssistantDemoQuotaCoordinator,
): AssistantDemoQuotaCoordinator | null {
  const isProduction =
    env.NODE_ENV === "production" || process.env.NODE_ENV === "production";

  if (isProduction) {
    return env.SHARED_RUNTIME_VERIFIED === "true" &&
      injected?.scope === "deployment-shared"
      ? injected
      : null;
  }

  return injected ?? null;
}
