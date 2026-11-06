import "server-only";

import { randomUUID } from "node:crypto";
import type {
  AssistantModelRequest,
  AssistantTokenBudgetCoordinator,
  AssistantTokenUsage,
} from "./types";

export const LOCAL_ASSISTANT_TOKEN_BUDGET = 100_000;
export const LOCAL_ASSISTANT_TOKEN_BUDGET_WINDOW_MS = 60 * 60 * 1_000;
const INPUT_TOKEN_SAFETY_MARGIN = 256;

export interface NormalizedAssistantUsage {
  usage: AssistantTokenUsage | null;
  complete: boolean;
}

function safeTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Keep API-reported usage, derive the total only when both API-reported
 * components are present, and mark partial or inconsistent reports as
 * incomplete so the budget coordinator charges the reserved maximum.
 */
export function normalizeAssistantTokenUsage(value: unknown): NormalizedAssistantUsage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { usage: null, complete: false };
  }

  const record = value as Record<string, unknown>;
  const inputTokens = safeTokenCount(record.input_tokens ?? record.inputTokens);
  const outputTokens = safeTokenCount(record.output_tokens ?? record.outputTokens);
  const reportedTotal = safeTokenCount(record.total_tokens ?? record.totalTokens);
  const derivedTotal =
    inputTokens !== undefined &&
    outputTokens !== undefined &&
    Number.isSafeInteger(inputTokens + outputTokens)
      ? inputTokens + outputTokens
      : undefined;
  const totalTokens = reportedTotal ?? derivedTotal;

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined
  ) {
    return { usage: null, complete: false };
  }

  return {
    usage: { inputTokens, outputTokens, totalTokens },
    complete:
      inputTokens !== undefined &&
      outputTokens !== undefined &&
      totalTokens !== undefined &&
      inputTokens + outputTokens === totalTokens,
  };
}

/** A conservative UTF-8 upper bound plus provider/format overhead. */
export function estimateMaxAssistantCallTokens(
  request: AssistantModelRequest,
  maxOutputTokens: number,
): number {
  const inputBytes =
    new TextEncoder().encode(request.instructions).byteLength +
    new TextEncoder().encode(request.input).byteLength;
  const estimate = inputBytes + maxOutputTokens + INPUT_TOKEN_SAFETY_MARGIN;

  if (!Number.isSafeInteger(estimate) || estimate <= 0) {
    throw new Error("Assistant token reservation is outside the supported range.");
  }

  return estimate;
}

interface BudgetWindow {
  startedAt: number;
  spentTokens: number;
  reservedTokens: number;
  reservations: Set<string>;
}

/**
 * Test and local-development coordinator only. It is intentionally
 * process-local and must not be used as a deployment-wide budget store.
 */
export function createInMemoryAssistantTokenBudgetCoordinator(options: {
  maxTokens: number;
  windowMs: number;
  maxReservations?: number;
}): AssistantTokenBudgetCoordinator & {
  snapshot(nowMs?: number): { spentTokens: number; reservedTokens: number };
} {
  const maxReservations = options.maxReservations ?? 10_000;
  let window: BudgetWindow | null = null;

  return {
    scope: "process-local",
    reserve({ reservationId, maxTokens, nowMs }) {
      if (
        !reservationId ||
        !Number.isSafeInteger(maxTokens) ||
        maxTokens <= 0 ||
        !Number.isFinite(nowMs) ||
        !Number.isSafeInteger(options.maxTokens) ||
        options.maxTokens <= 0 ||
        !Number.isSafeInteger(options.windowMs) ||
        options.windowMs <= 0
      ) {
        return null;
      }

      if (
        !window ||
        nowMs < window.startedAt ||
        nowMs - window.startedAt >= options.windowMs
      ) {
        window = {
          startedAt: nowMs,
          spentTokens: 0,
          reservedTokens: 0,
          reservations: new Set(),
        };
      }

      const activeWindow = window;
      const committedOrReserved = activeWindow.spentTokens + activeWindow.reservedTokens;

      if (
        activeWindow.reservations.size >= maxReservations ||
        activeWindow.reservations.has(reservationId) ||
        maxTokens > options.maxTokens - committedOrReserved
      ) {
        return null;
      }

      activeWindow.reservations.add(reservationId);
      activeWindow.reservedTokens += maxTokens;
      let settled = false;

      return {
        settle(actualTokens) {
          if (settled) return;
          settled = true;
          activeWindow.reservedTokens = Math.max(
            0,
            activeWindow.reservedTokens - maxTokens,
          );
          const charge =
            actualTokens !== null &&
            Number.isSafeInteger(actualTokens) &&
            actualTokens >= 0
              ? actualTokens
              : maxTokens;
          activeWindow.spentTokens += charge;
        },
      };
    },
    snapshot(nowMs = Date.now()) {
      if (
        window &&
        (nowMs < window.startedAt || nowMs - window.startedAt >= options.windowMs)
      ) {
        window = null;
      }
      return {
        spentTokens: window?.spentTokens ?? 0,
        reservedTokens: window?.reservedTokens ?? 0,
      };
    },
  };
}

const localDevelopmentBudget = createInMemoryAssistantTokenBudgetCoordinator({
  maxTokens: LOCAL_ASSISTANT_TOKEN_BUDGET,
  windowMs: LOCAL_ASSISTANT_TOKEN_BUDGET_WINDOW_MS,
});

/** Production calls require a caller-injected shared atomic coordinator. */
export function resolveAssistantTokenBudgetCoordinator(
  env: Record<string, string | undefined>,
  injected?: AssistantTokenBudgetCoordinator,
): AssistantTokenBudgetCoordinator | null {
  const isProduction =
    env.NODE_ENV === "production" || process.env.NODE_ENV === "production";
  if (isProduction) {
    return injected?.scope === "deployment-shared" ? injected : null;
  }
  if (injected) return injected;
  return localDevelopmentBudget;
}

export function createAssistantBudgetReservationId(): string {
  return randomUUID();
}
