import type {
  ActionApiErrorCode,
  ActionConfirmationRequest,
  ActionOperationResponse,
  ActionPreviewRequest,
  ActionPreviewResponse,
  ActionResetRequest,
} from "@/lib/assistant/action-contracts";
import { isPublicActionPreview } from "./api-client";

const ERROR_CODES = new Set([
  "INVALID_JSON",
  "INVALID_REQUEST",
  "UNSUPPORTED_MEDIA_TYPE",
  "PAYLOAD_TOO_LARGE",
  "ORIGIN_NOT_ALLOWED",
  "RATE_LIMITED",
  "ACTION_SESSION_UNAVAILABLE",
  "INVALID_SESSION",
  "SESSION_EXPIRED",
  "PREVIEW_NOT_FOUND",
  "CONFIRMATION_IN_PROGRESS",
  "INTERNAL_ERROR",
]);
const OPERATION_STATUSES = new Set([
  "CANCELLED",
  "APPLIED_SIMULATED",
  "NOT_ELIGIBLE",
  "INVALID_PARAMS",
  "PREVIEW_EXPIRED",
  "STATE_CHANGED",
  "PREVIEW_NOT_FOUND",
  "RESET",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStateSummary(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.sip) || !isRecord(value.rewardProgress)) {
    return false;
  }
  return (
    ["BASE", "PAUSED_RESTART"].includes(String(value.scenario)) &&
    typeof value.sip.fundName === "string" &&
    typeof value.sip.monthlyAmount === "number" &&
    typeof value.sip.debitDay === "number" &&
    ["ACTIVE", "PAUSED", "STOPPED"].includes(String(value.sip.status)) &&
    typeof value.rewardProgress.eligibleInstalments === "number" &&
    typeof value.rewardProgress.targetInstalments === "number" &&
    typeof value.rewardProgress.isUnlocked === "boolean"
  );
}

function isActionOperationResponse(value: unknown): value is ActionOperationResponse {
  if (!isRecord(value) || !isRecord(value.stateSummary)) return false;
  const result = value.result;
  return (
    typeof value.requestId === "string" &&
    typeof value.status === "string" &&
    OPERATION_STATUSES.has(value.status) &&
    typeof value.message === "string" &&
    isStateSummary(value.stateSummary) &&
    (result === null ||
      (isRecord(result) &&
        ["RETRY_PAYMENT", "MODIFY_AMOUNT", "MODIFY_DEBIT_DAY", "RESTART_SIP"].includes(
          String(result.actionType),
        ) &&
        typeof result.description === "string" &&
        result.simulated === true &&
        result.realPaymentMade === false &&
        typeof result.rewardProgressBefore === "number" &&
        typeof result.rewardProgressAfter === "number"))
  );
}

export class ActionApiClientError extends Error {
  constructor(message: string, public readonly code?: ActionApiErrorCode) {
    super(message);
    this.name = "ActionApiClientError";
  }
}

async function postJson<T>(
  route: string,
  body: unknown,
  isResponse: (value: unknown) => value is T,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(route, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ActionApiClientError(
      "The simulated action service could not be reached. Please try again.",
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ActionApiClientError("The simulated action service returned an unreadable response.");
  }

  if (!response.ok) {
    if (
      isRecord(payload) &&
      isRecord(payload.error) &&
      typeof payload.error.code === "string" &&
      ERROR_CODES.has(payload.error.code) &&
      typeof payload.error.message === "string"
    ) {
      throw new ActionApiClientError(
        payload.error.message.slice(0, 300),
        payload.error.code as ActionApiErrorCode,
      );
    }
    throw new ActionApiClientError("The simulated action request could not be completed.");
  }

  if (!isResponse(payload)) {
    throw new ActionApiClientError("The simulated action service returned an invalid response.");
  }
  return payload;
}

function isPreviewResponse(value: unknown): value is ActionPreviewResponse {
  return (
    isRecord(value) &&
    typeof value.requestId === "string" &&
    ["PREVIEWED", "NOT_ELIGIBLE", "INVALID_PARAMS"].includes(String(value.status)) &&
    isPublicActionPreview(value.preview)
  );
}

export function requestActionPreview(
  request: ActionPreviewRequest,
): Promise<ActionPreviewResponse> {
  return postJson("/api/assistant/actions/preview", request, isPreviewResponse);
}

export function confirmActionPreviewRequest(
  request: ActionConfirmationRequest,
): Promise<ActionOperationResponse> {
  return postJson(
    "/api/assistant/actions/confirm",
    request,
    isActionOperationResponse,
  );
}

export function resetActionDemo(
  request: ActionResetRequest,
): Promise<ActionOperationResponse> {
  return postJson("/api/assistant/actions/reset", request, isActionOperationResponse);
}
