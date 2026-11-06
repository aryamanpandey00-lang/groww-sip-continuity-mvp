import "server-only";

import { randomUUID } from "node:crypto";
import { getAssistantDemoState } from "@/lib/domain/fixtures/assistant-scenarios";
import type { AssistantApiErrorCode } from "@/lib/assistant/contracts";
import { runAssistant } from "./pipeline";
import {
  hasJsonContentType,
  hasSameOrigin,
  assistantRateLimitKey,
  readBoundedAssistantJson,
  validateAssistantApiRequest,
} from "./api-validation";
import { toAssistantApiResponse } from "./public-response";
import { actionSessionSetCookie, isSigningSecretReady } from "@/lib/assistant/action-session";
import {
  assistantStateFromSignedSession,
  createAiApprovedActionPreview,
} from "@/lib/assistant/action-service";
import {
  assistantRateLimiter,
  createAssistantRateLimiter,
} from "./rate-limit";
import type { AssistantDependencies, AssistantRequest } from "./types";

type AssistantRunner = typeof runAssistant;
type AssistantRateLimiter = ReturnType<typeof createAssistantRateLimiter>;

export interface AssistantApiHandlerDependencies {
  runAssistant?: AssistantRunner;
  rateLimiter?: AssistantRateLimiter;
  requestIdFactory?: () => string;
  now?: () => number;
  env?: Record<string, string | undefined>;
}

function responseHeaders(): Headers {
  return new Headers({
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
}

function jsonResponse(
  body: unknown,
  status: number,
  requestId: string,
  retryAfterSeconds?: number,
): Response {
  const headers = responseHeaders();
  headers.set("X-Request-Id", requestId);

  if (retryAfterSeconds !== undefined) {
    headers.set("Retry-After", String(retryAfterSeconds));
  }

  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(
  requestId: string,
  code: AssistantApiErrorCode,
  message: string,
  status: number,
  retryAfterSeconds?: number,
): Response {
  return jsonResponse(
    { requestId, error: { code, message } },
    status,
    requestId,
    retryAfterSeconds,
  );
}

export function createAssistantApiHandler(
  dependencies: AssistantApiHandlerDependencies = {},
): (request: Request) => Promise<Response> {
  const runner = dependencies.runAssistant ?? runAssistant;
  const limiter = dependencies.rateLimiter ?? assistantRateLimiter;
  const requestIdFactory = dependencies.requestIdFactory ?? randomUUID;
  const now = dependencies.now ?? Date.now;

  return async (request: Request): Promise<Response> => {
    const requestId = requestIdFactory();

    if (!hasSameOrigin(request)) {
      return errorResponse(
        requestId,
        "ORIGIN_NOT_ALLOWED",
        "This request origin is not allowed.",
        403,
      );
    }

    if (!hasJsonContentType(request)) {
      return errorResponse(
        requestId,
        "UNSUPPORTED_MEDIA_TYPE",
        "Send this request as application/json.",
        415,
      );
    }

    const lease = limiter.acquire(assistantRateLimitKey(request), now());

    if (!lease.allowed) {
      return errorResponse(
        requestId,
        "RATE_LIMITED",
        "Too many assistant requests. Please try again shortly.",
        429,
        lease.retryAfterSeconds,
      );
    }

    try {
      const body = await readBoundedAssistantJson(request);

      if (body.status === "PAYLOAD_TOO_LARGE") {
        return errorResponse(
          requestId,
          "PAYLOAD_TOO_LARGE",
          "The request body exceeds the 8 KiB limit.",
          413,
        );
      }

      if (body.status === "INVALID_JSON") {
        return errorResponse(
          requestId,
          "INVALID_JSON",
          "The request body must contain valid JSON.",
          400,
        );
      }

      const validation = validateAssistantApiRequest(body.value);

      if (!validation.valid) {
        return errorResponse(
          requestId,
          "INVALID_REQUEST",
          "The assistant request is invalid or contains unsupported fields.",
          400,
        );
      }

      const environment = dependencies.env ?? process.env;
      const scenario = validation.request.demoScenario;
      const actionSession = assistantStateFromSignedSession({
        cookieHeader: request.headers.get("cookie"),
        scenario,
        secret: environment.ACTION_SESSION_SIGNING_SECRET,
        nowMs: now(),
      });
      const assistantRequest: AssistantRequest = {
        question: validation.request.question,
        selectedCategory: validation.request.selectedCategory,
        state: actionSession?.state ?? getAssistantDemoState(scenario),
      };
      const assistantDependencies: AssistantDependencies = { requestId };

      if (dependencies.env) {
        assistantDependencies.env = dependencies.env;
      }

      const result = await runner(assistantRequest, assistantDependencies);
      let actionPreview = null;
      let actionSessionCookie: string | null = null;
      if (
        result.status === "APPROVED" &&
        result.gateResult?.passed === true &&
        result.fallbackUsed === false &&
        result.refusal === false &&
        result.proposedAction.type !== "NONE" &&
        isSigningSecretReady(environment.ACTION_SESSION_SIGNING_SECRET)
      ) {
        const proposed = createAiApprovedActionPreview({
          cookieHeader: request.headers.get("cookie"),
          scenario,
          state: assistantRequest.state!,
          proposedAction: result.proposedAction,
          secret: environment.ACTION_SESSION_SIGNING_SECRET,
          nowMs: now(),
        });
        if (proposed) {
          actionPreview = proposed.preview;
          actionSessionCookie = actionSessionSetCookie(
            proposed.token,
            proposed.session,
            environment,
            now(),
          );
        }
      }
      const response = jsonResponse(
        toAssistantApiResponse(result, actionPreview),
        200,
        requestId,
      );
      if (actionSessionCookie) {
        response.headers.set("Set-Cookie", actionSessionCookie);
      }
      return response;
    } catch {
      console.error(
        JSON.stringify({ event: "assistant_api_error", requestId }),
      );
      return errorResponse(
        requestId,
        "INTERNAL_ERROR",
        "The assistant request could not be completed.",
        500,
      );
    } finally {
      lease.release();
    }
  };
}
