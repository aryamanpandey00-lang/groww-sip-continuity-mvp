import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

const MAX_TRACKED_ACTION_SESSIONS = 20_000;
const consumedPreviewIds = new Map<string, number>();
const latestActionSessions = new Map<
  string,
  { tokenHash: string | null; expiresAtMs: number }
>();

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

function prune(nowMs: number): void {
  for (const [previewId, expiresAt] of consumedPreviewIds) {
    if (expiresAt <= nowMs) consumedPreviewIds.delete(previewId);
  }
  for (const [sessionId, session] of latestActionSessions) {
    if (session.expiresAtMs <= nowMs) latestActionSessions.delete(sessionId);
  }
}

export function markActionPreviewConsumed(
  previewId: string,
  expiresAtMs: number,
  nowMs = Date.now(),
): void {
  prune(nowMs);
  if (!previewId || !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) return;
  consumedPreviewIds.set(previewId, expiresAtMs);
}

export function isActionPreviewConsumed(
  previewId: string,
  nowMs = Date.now(),
): boolean {
  prune(nowMs);
  return consumedPreviewIds.has(previewId);
}

/**
 * Records the only session cookie version accepted by this process. This
 * prevents same-process cookie rollback; production routes stay disabled
 * until this guard is backed by shared durable state.
 */
export function registerLatestActionSession(
  sessionId: string,
  token: string,
  expiresAtMs: number,
  nowMs = Date.now(),
): boolean {
  prune(nowMs);
  if (!sessionId || !token || !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    return false;
  }
  if (
    !latestActionSessions.has(sessionId) &&
    latestActionSessions.size >= MAX_TRACKED_ACTION_SESSIONS
  ) {
    return false;
  }
  latestActionSessions.set(sessionId, {
    tokenHash: tokenHash(token),
    expiresAtMs,
  });
  return true;
}

export function isLatestActionSession(
  sessionId: string,
  token: string,
  nowMs = Date.now(),
): boolean {
  prune(nowMs);
  const current = latestActionSessions.get(sessionId);
  if (!current) return true;
  if (current.tokenHash === null) return false;
  const supplied = Buffer.from(tokenHash(token), "utf8");
  const expected = Buffer.from(current.tokenHash, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function revokeActionSession(
  sessionId: string,
  expiresAtMs: number,
  nowMs = Date.now(),
): boolean {
  prune(nowMs);
  if (!sessionId || !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    return false;
  }
  if (
    !latestActionSessions.has(sessionId) &&
    latestActionSessions.size >= MAX_TRACKED_ACTION_SESSIONS
  ) {
    return false;
  }
  latestActionSessions.set(sessionId, { tokenHash: null, expiresAtMs });
  return true;
}
