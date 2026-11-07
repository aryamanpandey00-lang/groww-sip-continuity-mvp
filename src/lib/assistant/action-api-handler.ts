import "server-only";

import { randomUUID } from "node:crypto";
import {
  ASSISTANT_DEMO_SCENARIOS,
  type AssistantDemoScenario,
} from "@/lib/domain/fixtures/assistant-scenarios";
import {
  assistantRateLimitKey,
  hasJsonContentType,
  hasSameOrigin,
  readBoundedAssistantJson,
} from "@/lib/ai/api-validation";
import {
  assistantRateLimiter,
  createAssistantRateLimiter,
} from "@/lib/ai/rate-limit";
import {
  isLatestActionSession,
  isActionPreviewConsumed,
  markActionPreviewConsumed,
  registerLatestActionSession,
  revokeActionSession,
} from "./action-replay-guard";
import type {
  ActionApiErrorCode,
  ActionConfirmationRequest,
  ActionOperationResponse,
  ActionPreviewRequest,
  ActionPreviewResponse,
  ActionResetRequest,
  PracticeActionInput,
} from "./action-contracts";
import {
  actionSessionSetCookie,
  createActionDemoSession,
  hashActionSessionToken,
  getSignedActionSessionToken,
  isSigningSecretReady,
  readSignedActionSession,
  signActionDemoSession,
  type ActionDemoSession,
} from "./action-session";
import type {
  ActionSessionExpectation,
  SharedActionSessionStore,
} from "./action-session-store";
import {
  confirmActionPreview,
  prepareActionPreview,
  practiceActionToDomainRequest,
  resolveActionSession as resolveSignedSession,
  resetActionSession,
  stateSummary,
  toOperationResponse,
} from "./action-service";

type RateLimiter = ReturnType<typeof createAssistantRateLimiter>;

export interface ActionApiHandlerDependencies {
  env?: Record<string, string | undefined>;
  rateLimiter?: RateLimiter;
  requestIdFactory?: () => string;
  now?: () => number;
  sessionStore?: SharedActionSessionStore;
}

interface RequestContext {
  requestId: string;
  env: Record<string, string | undefined>;
  nowMs: number;
  secret: string;
  lease: Extract<ReturnType<RateLimiter["acquire"]>, { allowed: true }>;
  sessionStore?: SharedActionSessionStore;
}

type PreparedBody =
  | { ok: true; context: RequestContext; value: unknown }
  | { ok: false; response: Response };

const confirmLocks = new Set<string>();

function headers(requestId: string): Headers {
  return new Headers({
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": requestId,
  });
}

function json(requestId: string, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: headers(requestId) });
}

function error(
  requestId: string,
  code: ActionApiErrorCode,
  message: string,
  status: number,
): Response {
  return json(requestId, { requestId, error: { code, message } }, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index]);
}

function isScenario(value: unknown): value is AssistantDemoScenario {
  return typeof value === "string" &&
    (ASSISTANT_DEMO_SCENARIOS as readonly string[]).includes(value);
}

function validatePracticeAction(value: unknown): value is PracticeActionInput {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "RETRY_PAYMENT":
    case "RESTART_SIP":
      return hasExactKeys(value, ["type"]);
    case "MODIFY_AMOUNT":
      return hasExactKeys(value, ["type", "amount"]) &&
        typeof value.amount === "number" && Number.isFinite(value.amount);
    case "MODIFY_DEBIT_DAY":
      return hasExactKeys(value, ["type", "debitDay"]) &&
        typeof value.debitDay === "number" && Number.isFinite(value.debitDay);
    default:
      return false;
  }
}

function validatePreviewRequest(value: unknown): value is ActionPreviewRequest {
  return isRecord(value) &&
    hasExactKeys(value, ["scenario", "action"]) &&
    isScenario(value.scenario) &&
    validatePracticeAction(value.action);
}

function validateConfirmationRequest(
  value: unknown,
): value is ActionConfirmationRequest {
  return isRecord(value) &&
    hasExactKeys(value, ["previewId", "confirmed"]) &&
    typeof value.previewId === "string" &&
    /^[0-9a-f-]{36}$/i.test(value.previewId) &&
    typeof value.confirmed === "boolean";
}

function validateResetRequest(value: unknown): value is ActionResetRequest {
  if (!isRecord(value)) return false;
  if (Object.keys(value).length === 0) return true;
  return hasExactKeys(value, ["scenario"]) && isScenario(value.scenario);
}

async function prepareRequest(
  request: Request,
  requestId: string,
  env: Record<string, string | undefined>,
  now: () => number,
  limiter: RateLimiter,
  sessionStore?: SharedActionSessionStore,
): Promise<PreparedBody> {
  if (!hasSameOrigin(request)) {
    return {
      ok: false,
      response: error(requestId, "ORIGIN_NOT_ALLOWED", "This request origin is not allowed.", 403),
    };
  }
  if (!hasJsonContentType(request)) {
    return {
      ok: false,
      response: error(requestId, "UNSUPPORTED_MEDIA_TYPE", "Send this request as application/json.", 415),
    };
  }
  if (
    env.NODE_ENV === "production" &&
    (sessionStore?.scope !== "deployment-shared" ||
      env.SHARED_RUNTIME_VERIFIED !== "true")
  ) {
    return {
      ok: false,
      response: error(
        requestId,
        "SHARED_STATE_UNAVAILABLE",
        "Simulated actions are unavailable until a shared atomic session store is configured.",
        503,
      ),
    };
  }

  const nowMs = now();
  const lease = limiter.acquire(assistantRateLimitKey(request), nowMs);
  if (!lease.allowed) {
    const response = error(
      requestId,
      "RATE_LIMITED",
      "Too many simulated action requests. Please try again shortly.",
      429,
    );
    response.headers.set("Retry-After", String(lease.retryAfterSeconds));
    return { ok: false, response };
  }

  try {
    let body;
    try {
      body = await readBoundedAssistantJson(request);
    } catch (cause) {
      lease.release();
      throw cause;
    }
    if (body.status === "PAYLOAD_TOO_LARGE") {
      lease.release();
      return {
        ok: false,
        response: error(requestId, "PAYLOAD_TOO_LARGE", "The request body exceeds the 8 KiB limit.", 413),
      };
    }
    if (body.status === "INVALID_JSON") {
      lease.release();
      return {
        ok: false,
        response: error(requestId, "INVALID_JSON", "The request body must contain valid JSON.", 400),
      };
    }
    if (!isSigningSecretReady(env.ACTION_SESSION_SIGNING_SECRET)) {
      lease.release();
      return {
        ok: false,
        response: error(
          requestId,
          "ACTION_SESSION_UNAVAILABLE",
          "Simulated actions are unavailable until the server session secret is configured.",
          503,
        ),
      };
    }
    return {
      ok: true,
      value: body.value,
      context: {
        requestId,
        env,
        nowMs,
        secret: env.ACTION_SESSION_SIGNING_SECRET,
        lease,
        sessionStore,
      },
    };
  } catch {
    lease.release();
    throw new Error("ACTION_REQUEST_PREPARATION_FAILED");
  }
}

function setSessionCookie(
  response: Response,
  session: ActionDemoSession,
  token: string,
  context: RequestContext,
): Response {
  response.headers.set(
    "Set-Cookie",
    actionSessionSetCookie(token, session, context.env, context.nowMs),
  );
  return response;
}

function sessionError(
  requestId: string,
  status: "INVALID" | "EXPIRED",
): Response {
  return status === "EXPIRED"
    ? error(requestId, "SESSION_EXPIRED", "The demo session expired. Reset the demo to continue.", 401)
    : error(requestId, "INVALID_SESSION", "The demo session could not be verified. Reset the demo to continue.", 401);
}

function previewNotFoundResponse(
  requestId: string,
  session: ActionDemoSession,
): Response {
  const body: ActionOperationResponse = {
    requestId,
    status: "PREVIEW_NOT_FOUND",
    message: "This preview is no longer active. Create a new preview.",
    stateSummary: stateSummary(session.scenario, session.state),
    result: null,
  };
  return json(requestId, body, 409);
}

export function createActionApiHandlers(
  dependencies: ActionApiHandlerDependencies = {},
): {
  preview: (request: Request) => Promise<Response>;
  confirm: (request: Request) => Promise<Response>;
  reset: (request: Request) => Promise<Response>;
} {
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? Date.now;
  const requestIdFactory = dependencies.requestIdFactory ?? randomUUID;
  const limiter = dependencies.rateLimiter ?? assistantRateLimiter;

  async function prepare(request: Request, requestId: string): Promise<PreparedBody> {
    try {
      return await prepareRequest(request, requestId, env, now, limiter, dependencies.sessionStore);
    } catch {
      console.error(JSON.stringify({ event: "assistant_action_api_error", requestId }));
      return {
        ok: false,
        response: error(requestId, "INTERNAL_ERROR", "The simulated action request could not be completed.", 500),
      };
    }
  }

  return {
    async preview(request): Promise<Response> {
      const requestId = requestIdFactory();
      const prepared = await prepare(request, requestId);
      if (!prepared.ok) return prepared.response;
      try {
        if (!validatePreviewRequest(prepared.value)) {
          return error(requestId, "INVALID_REQUEST", "The simulated action request is invalid.", 400);
        }
        if (prepared.context.sessionStore) {
          const cookieHeader = request.headers.get("cookie");
          const read = readSignedActionSession(
            cookieHeader,
            prepared.context.secret,
            prepared.context.nowMs,
          );
          if (read.status === "INVALID" || read.status === "EXPIRED") {
            return sessionError(requestId, read.status);
          }

          let session: ActionDemoSession;
          let expected: ActionSessionExpectation | null = null;
          if (read.status === "MISSING") {
            session = createActionDemoSession(prepared.value.scenario, prepared.context.nowMs);
          } else {
            const signedToken = getSignedActionSessionToken(cookieHeader);
            if (!signedToken) return sessionError(requestId, "INVALID");
            expected = {
              sessionId: read.session.sessionId,
              cookieHash: hashActionSessionToken(signedToken),
              stateVersion: read.session.stateVersion,
            };
            const current = await prepared.context.sessionStore.load(expected);
            if (!current) return sessionError(requestId, "INVALID");
            session = current.scenario === prepared.value.scenario
              ? current
              : resetActionSession(prepared.value.scenario, prepared.context.nowMs);
          }

          const action = practiceActionToDomainRequest(session.state, prepared.value.action);
          const result = prepareActionPreview({
            session,
            action,
            source: "DETERMINISTIC_DEMO_PRACTICE",
            secret: prepared.context.secret,
            nowMs: prepared.context.nowMs,
          });
          const persisted = expected
            ? await prepared.context.sessionStore.replace(
                expected,
                result.session,
                hashActionSessionToken(result.token),
              )
            : await prepared.context.sessionStore.create(
                result.session,
                hashActionSessionToken(result.token),
              );
          if (!persisted) {
            return expected
              ? sessionError(requestId, "INVALID")
              : error(requestId, "SHARED_STATE_UNAVAILABLE", "The shared action session could not be created.", 503);
          }
          const body: ActionPreviewResponse = {
            requestId,
            status: result.status,
            preview: result.preview,
          };
          return setSessionCookie(
            json(requestId, body),
            result.session,
            result.token,
            prepared.context,
          );
        }
        const resolved = resolveSignedSession({
          cookieHeader: request.headers.get("cookie"),
          scenario: prepared.value.scenario,
          secret: prepared.context.secret,
          nowMs: prepared.context.nowMs,
        });
        if (resolved === "INVALID" || resolved === "EXPIRED") {
          return sessionError(requestId, resolved);
        }
        const action = practiceActionToDomainRequest(
          resolved.session.state,
          prepared.value.action,
        );
        const result = prepareActionPreview({
          session: resolved.session,
          action,
          source: "DETERMINISTIC_DEMO_PRACTICE",
          secret: prepared.context.secret,
          nowMs: prepared.context.nowMs,
        });
        if (
          !registerLatestActionSession(
            result.session.sessionId,
            result.token,
            Date.parse(result.session.expiresAt),
            prepared.context.nowMs,
          )
        ) {
          return error(
            requestId,
            "SHARED_STATE_UNAVAILABLE",
            "The local session guard is full. Reset the demo after the current session expires.",
            503,
          );
        }
        const body: ActionPreviewResponse = {
          requestId,
          status: result.status,
          preview: result.preview,
        };
        const response = setSessionCookie(
          json(requestId, body),
          result.session,
          result.token,
          prepared.context,
        );
        return response;
      } catch {
        console.error(JSON.stringify({ event: "assistant_action_api_error", requestId }));
        return error(requestId, "INTERNAL_ERROR", "The simulated action preview could not be created.", 500);
      } finally {
        prepared.context.lease.release();
      }
    },

    async confirm(request): Promise<Response> {
      const requestId = requestIdFactory();
      const prepared = await prepare(request, requestId);
      if (!prepared.ok) return prepared.response;
      try {
        if (!validateConfirmationRequest(prepared.value)) {
          return error(requestId, "INVALID_REQUEST", "The confirmation request is invalid.", 400);
        }
        const read = readSignedActionSession(
          request.headers.get("cookie"),
          prepared.context.secret,
          prepared.context.nowMs,
        );
        if (read.status === "INVALID" || read.status === "EXPIRED") {
          return sessionError(requestId, read.status);
        }
        if (read.status === "MISSING") {
          return error(requestId, "INVALID_SESSION", "No active demo session was found. Create a new preview.", 401);
        }
        if (prepared.context.sessionStore) {
          const signedToken = getSignedActionSessionToken(request.headers.get("cookie"));
          if (!signedToken) return sessionError(requestId, "INVALID");
          const expected: ActionSessionExpectation = {
            sessionId: read.session.sessionId,
            cookieHash: hashActionSessionToken(signedToken),
            stateVersion: read.session.stateVersion,
          };
          const session = await prepared.context.sessionStore.load(expected);
          if (!session) return sessionError(requestId, "INVALID");
          const result = confirmActionPreview({
            session,
            previewId: prepared.value.previewId,
            confirmed: prepared.value.confirmed,
            nowMs: prepared.context.nowMs,
          });
          if (!result.consumed) return previewNotFoundResponse(requestId, session);

          const token = signActionDemoSession(result.session, prepared.context.secret);
          const persisted = await prepared.context.sessionStore.confirm(
            expected,
            prepared.value.previewId,
            result.response.status === "APPLIED_SIMULATED",
            result.session,
            hashActionSessionToken(token),
          );
          if (!persisted) return previewNotFoundResponse(requestId, session);
          const response = json(requestId, toOperationResponse(result.response, requestId));
          return setSessionCookie(response, result.session, token, prepared.context);
        }
        const session = read.session;
        if (isActionPreviewConsumed(prepared.value.previewId, prepared.context.nowMs)) {
          return previewNotFoundResponse(requestId, session);
        }
        const sessionToken = getSignedActionSessionToken(
          request.headers.get("cookie"),
        );
        if (
          sessionToken === null ||
          !isLatestActionSession(
            session.sessionId,
            sessionToken,
            prepared.context.nowMs,
          )
        ) {
          return sessionError(requestId, "INVALID");
        }
        if (confirmLocks.has(session.sessionId)) {
          return error(requestId, "CONFIRMATION_IN_PROGRESS", "A confirmation is already being processed.", 409);
        }
        confirmLocks.add(session.sessionId);
        try {
          const result = confirmActionPreview({
            session,
            previewId: prepared.value.previewId,
            confirmed: prepared.value.confirmed,
            nowMs: prepared.context.nowMs,
          });
          if (result.consumed) {
            markActionPreviewConsumed(
              prepared.value.previewId,
              Date.parse(session.pendingPreview?.expiresAt ?? session.expiresAt),
              prepared.context.nowMs,
            );
          }
          if (result.response.status === "PREVIEW_NOT_FOUND") {
            return previewNotFoundResponse(requestId, session);
          }
          const token = signActionDemoSession(result.session, prepared.context.secret);
          if (
            !registerLatestActionSession(
              result.session.sessionId,
              token,
              Date.parse(result.session.expiresAt),
              prepared.context.nowMs,
            )
          ) {
            return error(
              requestId,
              "SHARED_STATE_UNAVAILABLE",
              "The local session guard is full. Reset the demo after the current session expires.",
              503,
            );
          }
          const response = json(
            requestId,
            toOperationResponse(result.response, requestId),
          );
          return setSessionCookie(response, result.session, token, prepared.context);
        } finally {
          confirmLocks.delete(session.sessionId);
        }
      } catch {
        console.error(JSON.stringify({ event: "assistant_action_api_error", requestId }));
        return error(requestId, "INTERNAL_ERROR", "The confirmation could not be completed.", 500);
      } finally {
        prepared.context.lease.release();
      }
    },

    async reset(request): Promise<Response> {
      const requestId = requestIdFactory();
      const prepared = await prepare(request, requestId);
      if (!prepared.ok) return prepared.response;
      try {
        if (!validateResetRequest(prepared.value)) {
          return error(requestId, "INVALID_REQUEST", "The reset request is invalid.", 400);
        }
        const previous = readSignedActionSession(
          request.headers.get("cookie"),
          prepared.context.secret,
          prepared.context.nowMs,
        );
        if (prepared.context.sessionStore) {
          let expected: ActionSessionExpectation | null = null;
          if (previous.status === "VALID" || previous.status === "EXPIRED") {
            const signedToken = getSignedActionSessionToken(request.headers.get("cookie"));
            if (!signedToken) return sessionError(requestId, "INVALID");
            expected = {
              sessionId: previous.session.sessionId,
              cookieHash: hashActionSessionToken(signedToken),
              stateVersion: previous.session.stateVersion,
            };
          }
          const scenario = prepared.value.scenario ?? "BASE";
          const session = resetActionSession(scenario, prepared.context.nowMs);
          const token = signActionDemoSession(session, prepared.context.secret);
          const persisted = await prepared.context.sessionStore.reset(
            expected,
            session,
            hashActionSessionToken(token),
          );
          if (!persisted) return sessionError(requestId, "INVALID");
          const body: ActionOperationResponse = {
            requestId,
            status: "RESET",
            message: "The fictional demo state was reset to its original scenario.",
            stateSummary: stateSummary(scenario, session.state),
            result: null,
          };
          return setSessionCookie(json(requestId, body), session, token, prepared.context);
        }
        if (previous.status === "VALID" && previous.session.pendingPreview) {
          markActionPreviewConsumed(
            previous.session.pendingPreview.previewId,
            Date.parse(previous.session.pendingPreview.expiresAt),
            prepared.context.nowMs,
          );
        }
        if (
          previous.status === "VALID" &&
          !revokeActionSession(
            previous.session.sessionId,
            Date.parse(previous.session.expiresAt),
            prepared.context.nowMs,
          )
        ) {
          return error(
            requestId,
            "SHARED_STATE_UNAVAILABLE",
            "The local session guard is full. Reset the demo after the current session expires.",
            503,
          );
        }
        const scenario = prepared.value.scenario ?? "BASE";
        const session = resetActionSession(scenario, prepared.context.nowMs);
        const token = signActionDemoSession(session, prepared.context.secret);
        if (
          !registerLatestActionSession(
            session.sessionId,
            token,
            Date.parse(session.expiresAt),
            prepared.context.nowMs,
          )
        ) {
          return error(
            requestId,
            "SHARED_STATE_UNAVAILABLE",
            "The local session guard is full. Reset the demo after the current session expires.",
            503,
          );
        }
        const body: ActionOperationResponse = {
          requestId,
          status: "RESET",
          message: "The fictional demo state was reset to its original scenario.",
          stateSummary: stateSummary(scenario, session.state),
          result: null,
        };
        const response = json(requestId, body);
        return setSessionCookie(response, session, token, prepared.context);
      } catch {
        console.error(JSON.stringify({ event: "assistant_action_api_error", requestId }));
        return error(requestId, "INTERNAL_ERROR", "The demo could not be reset.", 500);
      } finally {
        prepared.context.lease.release();
      }
    },
  };
}
