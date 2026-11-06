import { afterEach, describe, expect, it, vi } from "vitest";
import { createAssistantApiHandler } from "@/lib/ai/api-handler";
import { toAssistantApiResponse } from "@/lib/ai/public-response";
import { createAssistantRateLimiter } from "@/lib/ai/rate-limit";
import { runAssistant } from "@/lib/ai/pipeline";
import { createActionApiHandlers } from "@/lib/assistant/action-api-handler";
import type {
  AssistantEvidenceItem,
  AssistantResult,
} from "@/lib/ai/types";
import {
  PAYMENT_QUESTION,
  READY_CONFIG,
  fakeModelClient,
  okResult,
  validPaymentOutput,
} from "./fixtures";

const fixedDate = () => new Date("2026-11-12T10:00:00.000Z");
const ACTION_SESSION_SECRET = "route-test-only-action-session-secret-32-bytes";

const trustedDemoEvidence: AssistantEvidenceItem = {
  evidenceId: "demo-policy.retry-window",
  title: "Fictional retry window",
  sourceTier: "demo_policy",
  sourceLabel: "Demo policy — not Groww policy",
  sourceName: "Fictional demo policy",
  excerpt: "A retry is a simulated demo action, not a real payment.",
  score: 1,
  matchedTerms: ["retry"],
  verificationStatus: "fictional_demo",
  verificationLabel: "Fictional demo rule — not Groww policy",
  sourceUrl: null,
  sourceDate: null,
  applicableDemoPolicyVersion: "demo-policy-v1.1",
};

const otherRetrievedEvidence: AssistantEvidenceItem = {
  ...trustedDemoEvidence,
  evidenceId: "demo-policy.other-retrieved-item",
  title: "Another item in the retrieval packet",
};

function result(overrides: Partial<AssistantResult> = {}): AssistantResult {
  return {
    requestId: "req_test_api",
    status: "SAFE_FALLBACK",
    intent: "PAYMENT_FAILED",
    directAnswer: "Safe test response.",
    keyPoints: [],
    citedEvidenceIds: [],
    proposedAction: { type: "NONE" },
    followUpQuestion: "",
    refusal: false,
    qualityLabel: "Safe fallback",
    fallbackReason: "INSUFFICIENT_EVIDENCE",
    evaluationFallbackReason: "INSUFFICIENT_EVIDENCE",
    fallbackUsed: true,
    repairAttempted: false,
    repairSucceeded: false,
    gateResult: null,
    retrievedEvidenceIds: [],
    retrievedEvidenceItems: [],
    model: null,
    executionPerformed: false,
    generatedAt: "2026-11-12T10:00:00.000Z",
    ...overrides,
  };
}

function makeRequest(
  body: string,
  options: {
    origin?: string | null;
    contentType?: string;
    ip?: string;
    forwardedFor?: string;
    contentLength?: string;
    cookie?: string;
  } = {},
): Request {
  const headers = new Headers({
    "content-type": options.contentType ?? "application/json",
    "x-real-ip": options.ip ?? "192.0.2.10",
  });

  if (options.forwardedFor !== undefined) {
    headers.set("x-forwarded-for", options.forwardedFor);
  }

  if (options.origin !== null) {
    headers.set("origin", options.origin ?? "http://localhost");
  }

  if (options.contentLength !== undefined) {
    headers.set("content-length", options.contentLength);
  }
  if (options.cookie !== undefined) {
    headers.set("cookie", options.cookie);
  }

  return new Request("http://localhost/api/assistant", {
    method: "POST",
    headers,
    body,
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function makeHandler(overrides: Parameters<typeof createAssistantApiHandler>[0] = {}) {
  return createAssistantApiHandler({
    requestIdFactory: () => "req_route_test",
    now: () => 10_000,
    rateLimiter: createAssistantRateLimiter(),
    ...overrides,
  });
}

describe("POST /api/assistant", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs the existing pipeline and returns only approved response fields", async () => {
    const modelClient = fakeModelClient([okResult(validPaymentOutput())]);
    const handler = makeHandler({
      runAssistant: (request, dependencies) =>
        runAssistant(request, {
          ...dependencies,
          config: READY_CONFIG,
          modelClient,
          log: () => {},
          now: fixedDate,
        }),
    });
    const response = await handler(
      makeRequest(
        JSON.stringify({
          question: PAYMENT_QUESTION,
          selectedCategory: "PAYMENT_FAILED",
        }),
      ),
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-request-id")).toBe("req_route_test");
    expect(body).toMatchObject({
      requestId: "req_route_test",
      status: "APPROVED",
      intent: "PAYMENT_FAILED",
      qualityLabel: "Limited evidence",
      fallbackUsed: false,
      actionPreview: null,
      executionPerformed: false,
    });
    expect(body.citations).toMatchObject([
      {
        evidenceId: "demo-policy.retry-window",
        sourceTier: "demo_policy",
        sourceLabel: "Demo policy — not Groww policy",
        verificationStatus: "fictional_demo",
      },
    ]);
    expect(Object.keys(body).sort()).toEqual(
      [
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
      ].sort(),
    );
    expect(modelClient.calls).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("OPENAI_API_KEY");
    expect(JSON.stringify(body)).not.toContain("instructions");
    expect(JSON.stringify(body)).not.toContain("gateResult");
    expect(JSON.stringify(body)).not.toContain("tokenUsage");
    expect(JSON.stringify(body)).not.toContain("cycle_2026_11");
  });

  it("creates an AI-proposed preview only after the approved gate result and deterministic revalidation", async () => {
    const handler = createAssistantApiHandler({
      runAssistant: async () => result({
        status: "APPROVED",
        directAnswer: "The demo retry is eligible for a simulated preview.",
        qualityLabel: "Evidence-backed",
        fallbackUsed: false,
        fallbackReason: "NONE",
        proposedAction: { type: "RETRY_PAYMENT", cycleId: "cycle_2026_11" },
        gateResult: {
          passed: true,
          criticalFailures: [],
          checkedAt: fixedDate().toISOString(),
          qualityLabel: "Evidence-backed",
        },
      }),
      env: {
        NODE_ENV: "test",
        ACTION_SESSION_SIGNING_SECRET: ACTION_SESSION_SECRET,
      },
      now: () => fixedDate().getTime(),
      requestIdFactory: () => "req_ai_action",
      rateLimiter: createAssistantRateLimiter(),
    });

    const response = await handler(makeRequest(JSON.stringify({
      question: PAYMENT_QUESTION,
      selectedCategory: "PAYMENT_FAILED",
      demoScenario: "BASE",
    })));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.status).toBe("APPROVED");
    expect(body.actionPreview).toMatchObject({
      source: "AI_APPROVED",
      actionType: "RETRY_PAYMENT",
      eligibility: "ELIGIBLE",
      requiresConfirmation: true,
    });
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(JSON.stringify(body)).not.toContain("stateFingerprint");
    expect(JSON.stringify(body)).not.toContain("cycle_2026_11");
  });

  it("invalidates a practice preview when an approved AI preview replaces its scenario", async () => {
    const actions = createActionApiHandlers({
      env: {
        NODE_ENV: "test",
        ACTION_SESSION_SIGNING_SECRET: ACTION_SESSION_SECRET,
      },
      now: () => fixedDate().getTime(),
      rateLimiter: createAssistantRateLimiter(),
    });
    const practice = await actions.preview(new Request(
      "http://localhost/api/assistant/actions/preview",
      {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          scenario: "BASE",
          action: { type: "RETRY_PAYMENT" },
        }),
      },
    ));
    const practiceBody = await practice.json() as {
      preview: { previewId: string };
    };
    const priorCookie = practice.headers.get("set-cookie")?.split(";", 1)[0];
    expect(priorCookie).toBeTruthy();

    const assistant = createAssistantApiHandler({
      runAssistant: async () => result({
        status: "APPROVED",
        fallbackUsed: false,
        refusal: false,
        fallbackReason: "NONE",
        proposedAction: { type: "RESTART_SIP" },
        gateResult: {
          passed: true,
          criticalFailures: [],
          checkedAt: fixedDate().toISOString(),
          qualityLabel: "Evidence-backed",
        },
      }),
      env: {
        NODE_ENV: "test",
        ACTION_SESSION_SIGNING_SECRET: ACTION_SESSION_SECRET,
      },
      now: () => fixedDate().getTime(),
      rateLimiter: createAssistantRateLimiter(),
    });
    const aiResponse = await assistant(makeRequest(JSON.stringify({
      question: "Can I restart my paused SIP?",
      selectedCategory: "RESTART_SIP",
      demoScenario: "PAUSED_RESTART",
    }), { cookie: priorCookie }));
    const aiBody = await json(aiResponse);
    expect(aiBody.actionPreview).toMatchObject({
      source: "AI_APPROVED",
      actionType: "RESTART_SIP",
      scenario: "PAUSED_RESTART",
    });

    const oldConfirmation = await actions.confirm(new Request(
      "http://localhost/api/assistant/actions/confirm",
      {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "content-type": "application/json",
          cookie: priorCookie!,
        },
        body: JSON.stringify({
          previewId: practiceBody.preview.previewId,
          confirmed: true,
        }),
      },
    ));
    expect(oldConfirmation.status).toBe(409);
    expect(await oldConfirmation.json()).toMatchObject({
      status: "PREVIEW_NOT_FOUND",
    });
  });

  it("does not turn a fallback or deterministically ineligible AI proposal into a preview", async () => {
    const makeActionHandler = (overrides: Partial<AssistantResult>) =>
      createAssistantApiHandler({
        runAssistant: async () => result({
          proposedAction: { type: "RETRY_PAYMENT", cycleId: "missing_cycle" },
          ...overrides,
        }),
        env: {
          NODE_ENV: "test",
          ACTION_SESSION_SIGNING_SECRET: ACTION_SESSION_SECRET,
        },
        now: () => fixedDate().getTime(),
        requestIdFactory: () => "req_ai_action_fallback",
        rateLimiter: createAssistantRateLimiter(),
      });

    const fallback = await makeActionHandler({
      status: "SAFE_FALLBACK",
      fallbackUsed: true,
      gateResult: {
        passed: true,
        criticalFailures: [],
        checkedAt: fixedDate().toISOString(),
        qualityLabel: "Limited evidence",
      },
    })(makeRequest(JSON.stringify({ question: PAYMENT_QUESTION })));
    const fallbackBody = await json(fallback);
    expect(fallbackBody.actionPreview).toBeNull();
    expect(fallback.headers.get("set-cookie")).toBeNull();

    const ineligible = await makeActionHandler({
      status: "APPROVED",
      fallbackUsed: false,
      fallbackReason: "NONE",
      refusal: false,
      gateResult: {
        passed: true,
        criticalFailures: [],
        checkedAt: fixedDate().toISOString(),
        qualityLabel: "Evidence-backed",
      },
    })(makeRequest(JSON.stringify({ question: PAYMENT_QUESTION })));
    const ineligibleBody = await json(ineligible);
    expect(ineligibleBody.actionPreview).toBeNull();
    expect(ineligible.headers.get("set-cookie")).toBeNull();
  });

  it("returns 415 for an unsupported media type", async () => {
    const runner = vi.fn(async () => result());
    const response = await makeHandler({ runAssistant: runner })(
      makeRequest("{}", { contentType: "text/plain" }),
    );

    expect(response.status).toBe(415);
    expect(await json(response)).toMatchObject({
      error: { code: "UNSUPPORTED_MEDIA_TYPE" },
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it.each([
    ["missing Origin", { origin: null }, 403, "ORIGIN_NOT_ALLOWED"],
    ["malformed Origin", { origin: "not an origin" }, 403, "ORIGIN_NOT_ALLOWED"],
    ["cross-origin Origin", { origin: "https://attacker.example" }, 403, "ORIGIN_NOT_ALLOWED"],
  ] as const)("rejects %s", async (_label, options, status, code) => {
    const runner = vi.fn(async () => result());
    const response = await makeHandler({ runAssistant: runner })(
      makeRequest("{}", options),
    );

    expect(response.status).toBe(status);
    expect(await json(response)).toMatchObject({ error: { code } });
    expect(runner).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    const response = await makeHandler()(makeRequest("{"));

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({
      error: { code: "INVALID_JSON" },
    });
  });

  it("enforces actual read bytes even when Content-Length is smaller", async () => {
    const response = await makeHandler()(
      makeRequest(JSON.stringify({ question: "x".repeat(9_000) }), {
        contentLength: "1",
      }),
    );

    expect(response.status).toBe(413);
    expect(await json(response)).toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
  });

  it.each([
    JSON.stringify({ question: "   " }),
    JSON.stringify({ question: "valid", selectedCategory: "OTHER" }),
    JSON.stringify({ question: "valid", demoScenario: "CUSTOM" }),
    JSON.stringify({ question: "valid", state: { sip: { monthlyAmount: 1 } } }),
    JSON.stringify({ question: "valid", evidence: ["fake.id"] }),
    JSON.stringify({ question: "valid", policy: { retryWindowDays: 900 } }),
    JSON.stringify({ question: "valid", permissions: ["RETRY_PAYMENT"] }),
  ])("rejects invalid requests and client-controlled data", async (bodyText) => {
    const runner = vi.fn(async () => result());
    const response = await makeHandler({ runAssistant: runner })(
      makeRequest(bodyText),
    );

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("returns 429 when the per-instance request quota is exceeded", async () => {
    const runner = vi.fn(async (_request, dependencies) =>
      result({ requestId: dependencies?.requestId ?? "req_mock" }),
    );
    const handler = makeHandler({
      runAssistant: runner,
      rateLimiter: createAssistantRateLimiter({
        maxRequests: 1,
        windowMs: 60_000,
        maxConcurrentPerKey: 2,
        maxConcurrentTotal: 4,
        maxTrackedKeys: 10,
      }),
    });
    const body = JSON.stringify({ question: "What is a SIP?" });

    expect((await handler(makeRequest(body))).status).toBe(200);
    const limited = await handler(makeRequest(body));

    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(await json(limited)).toMatchObject({
      error: { code: "RATE_LIMITED" },
    });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("does not allow client-controlled forwarding headers to bypass the route quota", async () => {
    const runner = vi.fn(async (_request, dependencies) =>
      result({ requestId: dependencies?.requestId ?? "req_mock" }),
    );
    const handler = makeHandler({
      runAssistant: runner,
      rateLimiter: createAssistantRateLimiter({ maxRequests: 1 }),
    });
    const body = JSON.stringify({ question: "What is a SIP?" });
    const first = await handler(makeRequest(body, {
      ip: "198.51.100.10",
      forwardedFor: "198.51.100.11",
    }));
    const forged = await handler(makeRequest(body, {
      ip: "203.0.113.90",
      forwardedFor: "203.0.113.91",
    }));

    expect(first.status).toBe(200);
    expect(forged.status).toBe(429);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("uses only the allowlisted paused-restart server scenario", async () => {
    let capturedRequest: Parameters<typeof runAssistant>[0] | undefined;
    const runner: typeof runAssistant = async (request, dependencies) => {
      capturedRequest = request;
      return result({ requestId: dependencies?.requestId ?? "req_mock" });
    };
    const response = await makeHandler({ runAssistant: runner })(
      makeRequest(
        JSON.stringify({
          question: "Can I restart my paused SIP?",
          selectedCategory: "RESTART_SIP",
          demoScenario: "PAUSED_RESTART",
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(capturedRequest?.state?.sip.status).toBe("PAUSED");
    expect(capturedRequest?.state?.sip.monthlyAmount).toBe(5_000);
    expect(capturedRequest?.state?.asOfDate).toBe("2026-11-12");
  });

  it("returns the existing safe unavailable result when the assistant is disabled", async () => {
    const response = await makeHandler({
      env: { ASSISTANT_ENABLED: "false" },
    })(makeRequest(JSON.stringify({ question: "What is a SIP?" })));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "UNAVAILABLE",
      qualityLabel: "Assistant unavailable",
      fallbackUsed: true,
      actionPreview: null,
      executionPerformed: false,
    });
    expect(body.directAnswer).toContain("disabled");
  });

  it("returns unavailable without a key and does not expose configuration details", async () => {
    const response = await makeHandler({
      env: {
        ASSISTANT_ENABLED: "true",
        OPENAI_MODEL: "configured-test-model",
      },
    })(makeRequest(JSON.stringify({ question: "What is a SIP?" })));
    const bodyText = await response.text();

    expect(response.status).toBe(200);
    expect(bodyText).toContain('"status":"UNAVAILABLE"');
    expect(bodyText).toContain('"qualityLabel":"Assistant unavailable"');
    expect(bodyText).not.toContain("MISSING_API_KEY");
    expect(bodyText).not.toContain("OPENAI_API_KEY");
  });

  it("keeps the official-evidence fallback and makes no model call", async () => {
    const modelClient = fakeModelClient([]);
    const response = await makeHandler({
      runAssistant: (request, dependencies) =>
        runAssistant(request, {
          ...dependencies,
          config: READY_CONFIG,
          modelClient,
          log: () => {},
          now: fixedDate,
        }),
    })(
      makeRequest(
        JSON.stringify({
          question: "What is Groww's official policy on retries?",
        }),
      ),
    );
    const body = await json(response);

    expect(body.status).toBe("SAFE_FALLBACK");
    expect(body.directAnswer).toContain("verified official Groww documentation");
    expect(body.citations).toEqual([]);
    expect(body.actionPreview).toBeNull();
    expect(body.executionPerformed).toBe(false);
    expect(modelClient.calls).toHaveLength(0);
  });

  it("returns the pipeline's bounded timeout fallback without a repair call", async () => {
    const modelClient = fakeModelClient([
      { status: "TIMEOUT", errorCode: "timeout" },
    ]);
    const response = await makeHandler({
      runAssistant: (request, dependencies) =>
        runAssistant(request, {
          ...dependencies,
          config: READY_CONFIG,
          modelClient,
          log: () => {},
          now: fixedDate,
        }),
    })(makeRequest(JSON.stringify({ question: PAYMENT_QUESTION })));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "UNAVAILABLE",
      qualityLabel: "Assistant unavailable",
      fallbackUsed: true,
      citations: [],
      actionPreview: null,
      executionPerformed: false,
    });
    expect(modelClient.calls).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("timeout");
    expect(JSON.stringify(body)).not.toContain("MODEL_TIMEOUT");
  });

  it("returns a generic error and request ID when the pipeline throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const runner = vi.fn(async () => {
      throw new Error("raw provider error with secret-value");
    });
    const response = await makeHandler({ runAssistant: runner })(
      makeRequest(JSON.stringify({ question: "What is a SIP?" })),
    );
    const bodyText = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe("req_route_test");
    expect(bodyText).toContain('"code":"INTERNAL_ERROR"');
    expect(bodyText).not.toContain("raw provider error");
    expect(bodyText).not.toContain("secret-value");
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ event: "assistant_api_error", requestId: "req_route_test" }),
    );
  });
});

describe("public assistant response mapping", () => {
  it("includes only unique citations in both the passed gate and trusted retrieval packet", () => {
    const response = toAssistantApiResponse(
      result({
        status: "APPROVED",
        fallbackUsed: false,
        gateResult: {
          passed: true,
          criticalFailures: [],
          checkedAt: "2026-11-12T10:00:00.000Z",
          qualityLabel: "Limited evidence",
        },
        citedEvidenceIds: [
          trustedDemoEvidence.evidenceId,
          "model-invented.id",
          trustedDemoEvidence.evidenceId,
        ],
        retrievedEvidenceIds: [trustedDemoEvidence.evidenceId],
        retrievedEvidenceItems: [trustedDemoEvidence, otherRetrievedEvidence],
      }),
    );

    expect(response.citations).toHaveLength(1);
    expect(response.citations[0]).toMatchObject({
      evidenceId: trustedDemoEvidence.evidenceId,
      title: trustedDemoEvidence.title,
      sourceTier: "demo_policy",
      sourceLabel: "Demo policy — not Groww policy",
      verificationStatus: "fictional_demo",
      applicableDemoPolicyVersion: "demo-policy-v1.1",
    });
    expect(response.actionPreview).toBeNull();
    expect(response.executionPerformed).toBe(false);
    expect(JSON.stringify(response)).not.toContain("score");
    expect(JSON.stringify(response)).not.toContain("matchedTerms");
    expect(JSON.stringify(response)).not.toContain("gateResult");
  });

  it("does not expose citations when the existing runtime gate did not pass", () => {
    const response = toAssistantApiResponse(
      result({
        citedEvidenceIds: [trustedDemoEvidence.evidenceId],
        retrievedEvidenceIds: [trustedDemoEvidence.evidenceId],
        retrievedEvidenceItems: [trustedDemoEvidence],
      }),
    );

    expect(response.citations).toEqual([]);
  });
});
