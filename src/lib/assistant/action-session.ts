import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import {
  ASSISTANT_DEMO_SCENARIOS,
  getAssistantDemoState,
  type AssistantDemoScenario,
} from "@/lib/domain/fixtures/assistant-scenarios";
import { isValidDateOnly, isValidIsoTimestamp } from "@/lib/domain/date-utils";
import type {
  DemoInvestorState,
  SimulatedActionRequest,
  SipCycle,
} from "@/lib/domain/types";
import type { ActionPreviewSource } from "./action-contracts";

export const ACTION_SESSION_COOKIE_NAME = "groww_demo_action_session";
export const ACTION_SESSION_COOKIE_PATH = "/api/assistant";
export const ACTION_SESSION_TTL_MS = 24 * 60 * 60 * 1_000;
export const MAX_ACTION_SESSION_COOKIE_BYTES = 3_800;
const MAX_COOKIE_HEADER_CHARS = 8_192;
const MAX_ACTION_SESSION_PAYLOAD_BYTES = 16 * 1_024;

export interface PendingActionPreview {
  previewId: string;
  source: ActionPreviewSource;
  scenario: AssistantDemoScenario;
  stateVersion: number;
  action: SimulatedActionRequest;
  expiresAt: string;
}

export interface ActionDemoSession {
  version: 1;
  sessionId: string;
  scenario: AssistantDemoScenario;
  stateVersion: number;
  state: DemoInvestorState;
  createdAt: string;
  expiresAt: string;
  pendingPreview: PendingActionPreview | null;
}

export type ActionSessionReadResult =
  | { status: "MISSING" }
  | { status: "INVALID" }
  | { status: "EXPIRED" }
  | { status: "VALID"; session: ActionDemoSession };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength = 160): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isNullableDate(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && isValidDateOnly(value));
}

function isCycle(value: unknown): value is SipCycle {
  if (!isRecord(value)) return false;
  return (
    isBoundedString(value.id) &&
    isBoundedString(value.monthKey, 7) &&
    typeof value.scheduledDate === "string" &&
    isValidDateOnly(value.scheduledDate) &&
    typeof value.amount === "number" &&
    Number.isSafeInteger(value.amount) &&
    value.amount >= 0 &&
    ["PAID", "FAILED", "PENDING", "MISSED"].includes(String(value.status)) &&
    isNullableDate(value.paidOn) &&
    isNullableDate(value.failedOn) &&
    (value.failureReason === null || isBoundedString(value.failureReason, 300)) &&
    typeof value.retryAttempts === "number" &&
    Number.isSafeInteger(value.retryAttempts) &&
    value.retryAttempts >= 0 &&
    (value.source === null || value.source === "SCHEDULED" || value.source === "RETRY")
  );
}

function isDemoState(value: unknown): value is DemoInvestorState {
  if (!isRecord(value) || !isRecord(value.investor) || !isRecord(value.sip)) {
    return false;
  }

  const investor = value.investor;
  const sip = value.sip;

  return (
    typeof value.asOfDate === "string" &&
    isValidDateOnly(value.asOfDate) &&
    isBoundedString(investor.id, 100) &&
    isBoundedString(investor.displayName, 100) &&
    isBoundedString(investor.initials, 12) &&
    isBoundedString(sip.id, 100) &&
    sip.investorId === investor.id &&
    isBoundedString(sip.fundName, 160) &&
    isBoundedString(sip.fundCategory, 100) &&
    typeof sip.monthlyAmount === "number" &&
    Number.isSafeInteger(sip.monthlyAmount) &&
    sip.monthlyAmount >= 0 &&
    typeof sip.debitDay === "number" &&
    Number.isSafeInteger(sip.debitDay) &&
    sip.debitDay >= 1 &&
    sip.debitDay <= 31 &&
    typeof sip.startDate === "string" &&
    isValidDateOnly(sip.startDate) &&
    ["ACTIVE", "PAUSED", "STOPPED"].includes(String(sip.status)) &&
    isNullableDate(sip.pausedOn) &&
    isNullableDate(sip.stoppedOn) &&
    isNullableDate(sip.restartedOn) &&
    isNullableDate(sip.lastModifiedOn) &&
    Array.isArray(sip.cycles) &&
    sip.cycles.length <= 100 &&
    sip.cycles.every(isCycle)
  );
}

function isScenario(value: unknown): value is AssistantDemoScenario {
  return (
    typeof value === "string" &&
    (ASSISTANT_DEMO_SCENARIOS as readonly string[]).includes(value)
  );
}

function isAction(value: unknown): value is SimulatedActionRequest {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "RETRY_PAYMENT":
      return Object.keys(value).sort().join(",") === "cycleId,type" && isBoundedString(value.cycleId, 100);
    case "MODIFY_AMOUNT":
      return Object.keys(value).sort().join(",") === "amount,type" &&
        typeof value.amount === "number" && Number.isFinite(value.amount);
    case "MODIFY_DEBIT_DAY":
      return Object.keys(value).sort().join(",") === "debitDay,type" &&
        typeof value.debitDay === "number" && Number.isFinite(value.debitDay);
    case "RESTART_SIP":
      return Object.keys(value).join(",") === "type";
    default:
      return false;
  }
}

function isPendingPreview(value: unknown): value is PendingActionPreview {
  if (!isRecord(value)) return false;
  return (
    isBoundedString(value.previewId, 100) &&
    (value.source === "DETERMINISTIC_DEMO_PRACTICE" || value.source === "AI_APPROVED") &&
    isScenario(value.scenario) &&
    typeof value.stateVersion === "number" &&
    Number.isSafeInteger(value.stateVersion) &&
    value.stateVersion >= 0 &&
    isAction(value.action) &&
    typeof value.expiresAt === "string" &&
    isValidIsoTimestamp(value.expiresAt)
  );
}

function isActionDemoSession(value: unknown): value is ActionDemoSession {
  if (!isRecord(value)) return false;
  const pendingPreview = value.pendingPreview;

  return (
    value.version === 1 &&
    isBoundedString(value.sessionId, 100) &&
    isScenario(value.scenario) &&
    typeof value.stateVersion === "number" &&
    Number.isSafeInteger(value.stateVersion) &&
    value.stateVersion >= 0 &&
    isDemoState(value.state) &&
    typeof value.createdAt === "string" &&
    isValidIsoTimestamp(value.createdAt) &&
    typeof value.expiresAt === "string" &&
    isValidIsoTimestamp(value.expiresAt) &&
    (pendingPreview === null || isPendingPreview(pendingPreview)) &&
    (pendingPreview === null ||
      (pendingPreview.scenario === value.scenario &&
        pendingPreview.stateVersion <= value.stateVersion))
  );
}

export function isSigningSecretReady(secret: string | undefined): secret is string {
  return (
    typeof secret === "string" &&
    Buffer.byteLength(secret, "utf8") >= 32 &&
    !/^replace[-_ ]/i.test(secret)
  );
}

export function createActionDemoSession(
  scenario: AssistantDemoScenario,
  nowMs = Date.now(),
): ActionDemoSession {
  const createdAt = new Date(nowMs).toISOString();
  return {
    version: 1,
    sessionId: randomUUID(),
    scenario,
    stateVersion: 0,
    state: getAssistantDemoState(scenario),
    createdAt,
    expiresAt: new Date(nowMs + ACTION_SESSION_TTL_MS).toISOString(),
    pendingPreview: null,
  };
}

function findCookie(cookieHeader: string | null, name: string): string | null | "DUPLICATE" {
  if (!cookieHeader) return null;
  if (cookieHeader.length > MAX_COOKIE_HEADER_CHARS) return "DUPLICATE";

  const matches = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));

  if (matches.length > 1) return "DUPLICATE";
  if (matches.length === 0) return null;
  return matches[0]!.slice(name.length + 1);
}

export function getSignedActionSessionToken(
  cookieHeader: string | null,
): string | null {
  const token = findCookie(cookieHeader, ACTION_SESSION_COOKIE_NAME);
  if (
    token === null ||
    token === "DUPLICATE" ||
    token.length > MAX_ACTION_SESSION_COOKIE_BYTES
  ) {
    return null;
  }
  return token;
}

export function readSignedActionSession(
  cookieHeader: string | null,
  secret: string | undefined,
  nowMs = Date.now(),
): ActionSessionReadResult {
  const token = findCookie(cookieHeader, ACTION_SESSION_COOKIE_NAME);
  if (token === null) return { status: "MISSING" };
  if (token === "DUPLICATE" || token.length > MAX_ACTION_SESSION_COOKIE_BYTES) {
    return { status: "INVALID" };
  }
  if (!isSigningSecretReady(secret)) return { status: "INVALID" };

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || parts.some((part) => part.length === 0)) {
    return { status: "INVALID" };
  }

  try {
    const [, encodedPayload, encodedSignature] = parts as [string, string, string];
    const suppliedSignature = Buffer.from(encodedSignature, "base64url");
    const expectedSignature = createHmac("sha256", secret)
      .update(`v1.${encodedPayload}`)
      .digest();

    if (
      suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      return { status: "INVALID" };
    }

    const payload = inflateRawSync(Buffer.from(encodedPayload, "base64url"), {
      maxOutputLength: MAX_ACTION_SESSION_PAYLOAD_BYTES,
    });
    const parsed: unknown = JSON.parse(payload.toString("utf8"));
    if (!isActionDemoSession(parsed)) return { status: "INVALID" };
    if (Date.parse(parsed.expiresAt) <= nowMs) return { status: "EXPIRED" };
    return { status: "VALID", session: parsed };
  } catch {
    return { status: "INVALID" };
  }
}

export function signActionDemoSession(
  session: ActionDemoSession,
  secret: string,
): string {
  if (!isSigningSecretReady(secret) || !isActionDemoSession(session)) {
    throw new Error("Action session cannot be signed.");
  }

  const payload = deflateRawSync(Buffer.from(JSON.stringify(session), "utf8"))
    .toString("base64url");
  const signingInput = `v1.${payload}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
  const token = `${signingInput}.${signature}`;
  if (Buffer.byteLength(token, "utf8") > MAX_ACTION_SESSION_COOKIE_BYTES) {
    throw new Error("Action session exceeds the cookie size limit.");
  }
  return token;
}

export function actionSessionSetCookie(
  token: string,
  session: ActionDemoSession,
  env: Record<string, string | undefined>,
  nowMs = Date.now(),
): string {
  const maxAge = Math.max(0, Math.floor((Date.parse(session.expiresAt) - nowMs) / 1_000));
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ACTION_SESSION_COOKIE_NAME}=${token}; Path=${ACTION_SESSION_COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}`;
}
