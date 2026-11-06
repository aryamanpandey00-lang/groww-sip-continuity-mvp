import {
  ASSISTANT_API_ERROR_CODES,
  type AssistantApiCitation,
  type AssistantApiErrorCode,
  type AssistantApiRequest,
  type AssistantApiResponse,
} from "@/lib/assistant/contracts";
import type { PublicActionPreview } from "@/lib/assistant/action-contracts";

const RESPONSE_STATUSES = new Set([
  "APPROVED",
  "NEEDS_MORE_INFORMATION",
  "SAFE_FALLBACK",
  "UNAVAILABLE",
]);
const QUALITY_LABELS = new Set([
  "Evidence-backed",
  "Limited evidence",
  "Safety guidance",
  "Need more information",
  "Safe fallback",
  "Assistant unavailable",
]);
const SOURCE_TIERS = new Set([
  "demo_policy",
  "general_education",
  "official_groww",
]);
const VERIFICATION_STATUSES = new Set([
  "verified",
  "unverified",
  "fictional_demo",
]);
const ACTION_SOURCES = new Set([
  "DETERMINISTIC_DEMO_PRACTICE",
  "AI_APPROVED",
]);
const ACTION_TYPES = new Set([
  "RETRY_PAYMENT",
  "MODIFY_AMOUNT",
  "MODIFY_DEBIT_DAY",
  "RESTART_SIP",
]);
const ACTION_ELIGIBILITY = new Set([
  "ELIGIBLE",
  "NOT_ELIGIBLE",
  "INVALID_PARAMS",
]);
const DEMO_SCENARIOS = new Set(["BASE", "PAUSED_RESTART"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index])
  );
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isCitation(value: unknown): value is AssistantApiCitation {
  if (!isRecord(value)) return false;

  return (
    hasExactKeys(value, [
      "evidenceId",
      "title",
      "sourceTier",
      "sourceLabel",
      "sourceName",
      "excerpt",
      "verificationStatus",
      "verificationLabel",
      "sourceUrl",
      "sourceDate",
      "applicableDemoPolicyVersion",
    ]) &&
    typeof value.evidenceId === "string" &&
    typeof value.title === "string" &&
    typeof value.sourceTier === "string" &&
    SOURCE_TIERS.has(value.sourceTier) &&
    typeof value.sourceLabel === "string" &&
    typeof value.sourceName === "string" &&
    typeof value.excerpt === "string" &&
    typeof value.verificationStatus === "string" &&
    VERIFICATION_STATUSES.has(value.verificationStatus) &&
    typeof value.verificationLabel === "string" &&
    nullableString(value.sourceUrl) &&
    nullableString(value.sourceDate) &&
    nullableString(value.applicableDemoPolicyVersion)
  );
}

export function isPublicActionPreview(value: unknown): value is PublicActionPreview {
  if (!isRecord(value)) return false;
  if (
    !hasExactKeys(value, [
      "previewId",
      "source",
      "sourceLabel",
      "scenario",
      "actionType",
      "actionTitle",
      "sipContext",
      "proposedChange",
      "eligibility",
      "effects",
      "errors",
      "expiresAt",
      "requiresConfirmation",
    ]) ||
    (value.previewId !== null && typeof value.previewId !== "string") ||
    typeof value.source !== "string" ||
    !ACTION_SOURCES.has(value.source) ||
    typeof value.sourceLabel !== "string" ||
    typeof value.scenario !== "string" ||
    !DEMO_SCENARIOS.has(value.scenario) ||
    typeof value.actionType !== "string" ||
    !ACTION_TYPES.has(value.actionType) ||
    typeof value.actionTitle !== "string" ||
    !isRecord(value.sipContext) ||
    !hasExactKeys(value.sipContext, [
      "label",
      "fundName",
      "monthlyAmount",
      "debitDay",
      "status",
    ]) ||
    value.sipContext.label !== "Fictional SIP — Demo only" ||
    typeof value.sipContext.fundName !== "string" ||
    typeof value.sipContext.monthlyAmount !== "number" ||
    typeof value.sipContext.debitDay !== "number" ||
    !["ACTIVE", "PAUSED", "STOPPED"].includes(String(value.sipContext.status)) ||
    (value.proposedChange !== null && typeof value.proposedChange !== "string") ||
    typeof value.eligibility !== "string" ||
    !ACTION_ELIGIBILITY.has(value.eligibility) ||
    !Array.isArray(value.effects) ||
    !value.effects.every((effect) => typeof effect === "string") ||
    !Array.isArray(value.errors) ||
    !value.errors.every((message) => typeof message === "string") ||
    (value.expiresAt !== null && typeof value.expiresAt !== "string") ||
    typeof value.requiresConfirmation !== "boolean"
  ) {
    return false;
  }

  return value.requiresConfirmation === (value.previewId !== null) &&
    (!value.requiresConfirmation || value.expiresAt !== null);
}

export function isAssistantApiResponse(
  value: unknown,
): value is AssistantApiResponse {
  if (!isRecord(value)) return false;

  return (
    hasExactKeys(value, [
      "requestId",
      "status",
      "intent",
      "directAnswer",
      "keyPoints",
      "followUpQuestion",
      "qualityLabel",
      "fallbackUsed",
      "citations",
      "actionPreview",
      "executionPerformed",
    ]) &&
    typeof value.requestId === "string" &&
    typeof value.status === "string" &&
    RESPONSE_STATUSES.has(value.status) &&
    typeof value.intent === "string" &&
    /^[A-Z_]{2,64}$/.test(value.intent) &&
    typeof value.directAnswer === "string" &&
    Array.isArray(value.keyPoints) &&
    value.keyPoints.every((point) => typeof point === "string") &&
    typeof value.followUpQuestion === "string" &&
    typeof value.qualityLabel === "string" &&
    QUALITY_LABELS.has(value.qualityLabel) &&
    typeof value.fallbackUsed === "boolean" &&
    Array.isArray(value.citations) &&
    value.citations.every(isCitation) &&
    (value.actionPreview === null || isPublicActionPreview(value.actionPreview)) &&
    value.executionPerformed === false
  );
}

function isAssistantApiErrorCode(value: unknown): value is AssistantApiErrorCode {
  return (
    typeof value === "string" &&
    (ASSISTANT_API_ERROR_CODES as readonly string[]).includes(value)
  );
}

export class AssistantApiClientError extends Error {
  constructor(message: string, public readonly code?: AssistantApiErrorCode) {
    super(message);
    this.name = "AssistantApiClientError";
  }
}

export async function requestAssistant(
  request: AssistantApiRequest,
  signal?: AbortSignal,
): Promise<AssistantApiResponse> {
  const body: AssistantApiRequest = {
    question: request.question,
    selectedCategory: request.selectedCategory,
    demoScenario: request.demoScenario,
  };
  const response = await fetch("/api/assistant", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new AssistantApiClientError(
      "The assistant returned an unreadable response. Please try again.",
    );
  }

  if (!response.ok) {
    if (
      isRecord(payload) &&
      isRecord(payload.error) &&
      isAssistantApiErrorCode(payload.error.code) &&
      typeof payload.error.message === "string"
    ) {
      throw new AssistantApiClientError(
        payload.error.message.slice(0, 300),
        payload.error.code,
      );
    }

    throw new AssistantApiClientError(
      "The assistant request could not be completed. Please try again.",
    );
  }

  if (!isAssistantApiResponse(payload)) {
    throw new AssistantApiClientError(
      "The assistant returned an invalid response. Please try again.",
    );
  }

  return payload;
}
