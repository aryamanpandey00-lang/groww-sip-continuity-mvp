import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createAssistantRateLimiter } from "@/lib/ai/rate-limit";
import {
  ACTION_SESSION_COOKIE_NAME,
  createActionDemoSession,
  readSignedActionSession,
  signActionDemoSession,
} from "@/lib/assistant/action-session";
import { createActionApiHandlers } from "@/lib/assistant/action-api-handler";
import type {
  ActionOperationResponse,
  ActionPreviewResponse,
  PracticeActionInput,
} from "@/lib/assistant/action-contracts";
import {
  getAssistantDemoState,
  type AssistantDemoScenario,
} from "@/lib/domain/fixtures/assistant-scenarios";
import { demoPolicy } from "@/lib/domain/policy";

const SECRET = "unit-test-only-action-session-secret-32-bytes";

function createHarness(options: {
  secret?: string;
  now?: number;
  assistantEnabled?: string;
  nodeEnv?: string;
} = {}) {
  let nowMs = options.now ?? Date.now();
  let requestNumber = 0;
  const handlers = createActionApiHandlers({
    env: {
      NODE_ENV: options.nodeEnv ?? "test",
      ASSISTANT_ENABLED: options.assistantEnabled ?? "false",
      ACTION_SESSION_SIGNING_SECRET: options.secret ?? SECRET,
    },
    now: () => nowMs,
    requestIdFactory: () => `req_action_${++requestNumber}`,
    rateLimiter: createAssistantRateLimiter({ maxRequests: 100 }),
  });
  return {
    handlers,
    now: () => nowMs,
    setNow: (value: number) => { nowMs = value; },
  };
}

function request(path: string, body: unknown, cookie?: string): Request {
  const headers = new Headers({
    origin: "http://localhost",
    "content-type": "application/json",
  });
  if (cookie) headers.set("cookie", cookie);
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("Expected an action session cookie.");
  return setCookie.split(";", 1)[0]!;
}

async function preview(
  handlers: ReturnType<typeof createActionApiHandlers>,
  action: unknown,
  scenario = "BASE",
  cookie?: string,
) {
  return handlers.preview(request("/api/assistant/actions/preview", { scenario, action }, cookie));
}

async function confirm(
  handlers: ReturnType<typeof createActionApiHandlers>,
  previewId: string,
  confirmed: boolean,
  cookie: string,
) {
  return handlers.confirm(request(
    "/api/assistant/actions/confirm",
    { previewId, confirmed },
    cookie,
  ));
}

describe("simulated action API", () => {
  it("fails closed in production until durable shared action state is available", async () => {
    const harness = createHarness({ nodeEnv: "production" });

    const response = await preview(
      harness.handlers,
      { type: "RETRY_PAYMENT" },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "SHARED_STATE_UNAVAILABLE" },
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("creates an eligible deterministic retry preview without applying the action", async () => {
    const harness = createHarness();
    const response = await preview(harness.handlers, { type: "RETRY_PAYMENT" });
    const body = await response.json() as ActionPreviewResponse;
    const cookie = cookieFrom(response);
    const session = readSignedActionSession(cookie, SECRET, harness.now());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(body.status).toBe("PREVIEWED");
    expect(body.preview).toMatchObject({
      source: "DETERMINISTIC_DEMO_PRACTICE",
      sourceLabel: "Deterministic demo practice — no AI used",
      scenario: "BASE",
      actionType: "RETRY_PAYMENT",
      eligibility: "ELIGIBLE",
      requiresConfirmation: true,
      sipContext: { monthlyAmount: 5000, status: "ACTIVE" },
    });
    expect(body.preview.previewId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(session.status).toBe("VALID");
    if (session.status === "VALID") {
      expect(session.session.state.sip.cycles.find((cycle) => cycle.id === "cycle_2026_11")?.status).toBe("FAILED");
      expect(session.session.pendingPreview?.source).toBe("DETERMINISTIC_DEMO_PRACTICE");
    }
    const publicJson = JSON.stringify(body);
    expect(publicJson).not.toContain("stateFingerprint");
    expect(publicJson).not.toContain("sessionId");
    expect(publicJson).not.toContain(SECRET);
    expect(publicJson).not.toContain("cycle_2026_11");
  });

  it("shows ineligible actions without authorizing confirmation", async () => {
    const harness = createHarness();
    const response = await preview(
      harness.handlers,
      { type: "RESTART_SIP" },
      "BASE",
    );
    const body = await response.json() as ActionPreviewResponse;

    expect(body.status).toBe("NOT_ELIGIBLE");
    expect(body.preview).toMatchObject({
      actionType: "RESTART_SIP",
      eligibility: "NOT_ELIGIBLE",
      previewId: null,
      requiresConfirmation: false,
    });
    expect(body.preview.errors.length).toBeGreaterThan(0);
    expect(response.headers.get("set-cookie")).toBeTruthy();
  });

  it("rejects unknown actions and validates invalid amount or debit date through the domain engine", async () => {
    const harness = createHarness();
    const unknown = await preview(harness.handlers, { type: "CLAIM_REWARD" });
    expect(unknown.status).toBe(400);

    const amount = await preview(harness.handlers, { type: "MODIFY_AMOUNT", amount: 499 });
    const amountBody = await amount.json() as ActionPreviewResponse;
    expect(amountBody.status).toBe("INVALID_PARAMS");
    expect(amountBody.preview.eligibility).toBe("INVALID_PARAMS");

    const debitDate = await preview(harness.handlers, { type: "MODIFY_DEBIT_DAY", debitDay: 29 });
    const dateBody = await debitDate.json() as ActionPreviewResponse;
    expect(dateBody.status).toBe("INVALID_PARAMS");
    expect(dateBody.preview.errors.length).toBeGreaterThan(0);
  });

  it("resets pending previews when switching allowlisted scenarios", async () => {
    const harness = createHarness();
    const baseResponse = await preview(harness.handlers, { type: "RETRY_PAYMENT" });
    const baseBody = await baseResponse.json() as ActionPreviewResponse;
    const baseCookie = cookieFrom(baseResponse);

    const restartResponse = await preview(
      harness.handlers,
      { type: "RESTART_SIP" },
      "PAUSED_RESTART",
      baseCookie,
    );
    const restartBody = await restartResponse.json() as ActionPreviewResponse;
    const restartCookie = cookieFrom(restartResponse);

    expect(restartBody.status).toBe("PREVIEWED");
    expect(restartBody.preview.scenario).toBe("PAUSED_RESTART");
    expect(restartBody.preview.sipContext.status).toBe("PAUSED");
    const staleConfirm = await confirm(
      harness.handlers,
      baseBody.preview.previewId!,
      true,
      restartCookie,
    );
    expect(staleConfirm.status).toBe(409);
    expect((await staleConfirm.json() as ActionOperationResponse).status).toBe("PREVIEW_NOT_FOUND");
  });

  it("fails closed if the session signing secret is missing", async () => {
    const harness = createHarness({ secret: "" });
    const response = await preview(harness.handlers, { type: "RETRY_PAYMENT" });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "ACTION_SESSION_UNAVAILABLE" },
    });
  });

  it("fails closed for a signing secret below the minimum length", async () => {
    const harness = createHarness({ secret: "too-short" });
    const response = await preview(harness.handlers, { type: "RETRY_PAYMENT" });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "ACTION_SESSION_UNAVAILABLE" },
    });
  });

  it("rejects client-supplied confirmation timestamps and malformed preview IDs", async () => {
    const harness = createHarness();
    const created = await preview(harness.handlers, { type: "RETRY_PAYMENT" });
    const body = await created.json() as ActionPreviewResponse;
    const cookie = cookieFrom(created);
    const clientTimestamp = await harness.handlers.confirm(request(
      "/api/assistant/actions/confirm",
      {
        previewId: body.preview.previewId,
        confirmed: true,
        confirmedAt: "2099-01-01T00:00:00.000Z",
      },
      cookie,
    ));
    expect(clientTimestamp.status).toBe(400);

    const malformedId = await confirm(harness.handlers, "not-a-preview-id", true, cookie);
    expect(malformedId.status).toBe(400);
    const valid = await confirm(harness.handlers, body.preview.previewId!, true, cookie);
    expect((await valid.json() as ActionOperationResponse).status).toBe("APPLIED_SIMULATED");
  });

  it("rejects invalid or tampered session cookies while allowing an explicit reset", async () => {
    const harness = createHarness();
    const first = await preview(harness.handlers, { type: "RETRY_PAYMENT" });
    const validCookie = cookieFrom(first);
    const [name, token] = validCookie.split("=");
    const [version, payload, signature] = token!.split(".");
    const changedSignature = signature!.startsWith("A")
      ? `B${signature!.slice(1)}`
      : `A${signature!.slice(1)}`;
    const tampered = `${name}=${version}.${payload}.${changedSignature}`;

    const rejected = await preview(harness.handlers, { type: "RETRY_PAYMENT" }, "BASE", tampered);
    expect(rejected.status).toBe(401);
    expect((await rejected.json()).error.code).toBe("INVALID_SESSION");

    const reset = await harness.handlers.reset(request(
      "/api/assistant/actions/reset",
      { scenario: "BASE" },
      tampered,
    ));
    expect(reset.status).toBe(200);
    expect((await reset.json() as ActionOperationResponse).status).toBe("RESET");
  });

  it("rejects an expired preview using real elapsed time", async () => {
    const harness = createHarness();
    const response = await preview(harness.handlers, { type: "RETRY_PAYMENT" });
    const body = await response.json() as ActionPreviewResponse;
    const cookie = cookieFrom(response);
    harness.setNow(harness.now() + demoPolicy.actionPreviewTtlMinutes * 60_000 + 1);

    const rejected = await confirm(harness.handlers, body.preview.previewId!, true, cookie);
    const result = await rejected.json() as ActionOperationResponse;
    expect(result.status).toBe("PREVIEW_EXPIRED");
    expect(result.stateSummary.sip.status).toBe("ACTIVE");
    expect(result.stateSummary.rewardProgress.eligibleInstalments).toBe(11);
  });

  it("rejects a rolled-back session token before applying a preview", async () => {
    const harness = createHarness();
    const response = await preview(harness.handlers, { type: "RETRY_PAYMENT" });
    const body = await response.json() as ActionPreviewResponse;
    const cookie = cookieFrom(response);
    const read = readSignedActionSession(cookie, SECRET, harness.now());
    expect(read.status).toBe("VALID");
    if (read.status !== "VALID") return;

    const staleSession = { ...read.session, stateVersion: read.session.stateVersion + 1 };
    const staleCookie = `${ACTION_SESSION_COOKIE_NAME}=${signActionDemoSession(staleSession, SECRET)}`;
    const resultResponse = await confirm(
      harness.handlers,
      body.preview.previewId!,
      true,
      staleCookie,
    );
    expect(resultResponse.status).toBe(401);
    expect((await resultResponse.json()).error.code).toBe("INVALID_SESSION");
  });

  it("rejects a previously issued session cookie after a newer cookie is minted", async () => {
    const harness = createHarness();
    const olderSession = createActionDemoSession("BASE", harness.now());
    const oldCookie = `${ACTION_SESSION_COOKIE_NAME}=${signActionDemoSession(olderSession, SECRET)}`;
    const freshPreview = await preview(
      harness.handlers,
      { type: "RETRY_PAYMENT" },
      "BASE",
      oldCookie,
    );
    const freshCookie = cookieFrom(freshPreview);
    const rollbackAttempt = await preview(
      harness.handlers,
      { type: "RETRY_PAYMENT" },
      "BASE",
      oldCookie,
    );

    expect(freshCookie).not.toBe(oldCookie);
    expect(rollbackAttempt.status).toBe(401);
    expect((await rollbackAttempt.json()).error.code).toBe("INVALID_SESSION");
  });

  it("requires explicit confirmation and cancellation leaves fictional state unchanged", async () => {
    const harness = createHarness();
    const response = await preview(harness.handlers, { type: "RETRY_PAYMENT" });
    const body = await response.json() as ActionPreviewResponse;
    const cookie = cookieFrom(response);
    const before = readSignedActionSession(cookie, SECRET, harness.now());
    const cancel = await confirm(harness.handlers, body.preview.previewId!, false, cookie);
    const cancelBody = await cancel.json() as ActionOperationResponse;
    const after = readSignedActionSession(cookieFrom(cancel), SECRET, harness.now());

    expect(cancelBody.status).toBe("CANCELLED");
    expect(cancelBody.result).toBeNull();
    expect(before.status).toBe("VALID");
    expect(after.status).toBe("VALID");
    if (before.status === "VALID" && after.status === "VALID") {
      expect(after.session.state).toEqual(before.session.state);
      expect(after.session.pendingPreview).toBeNull();
    }

    const replay = await confirm(
      harness.handlers,
      body.preview.previewId!,
      true,
      cookie,
    );
    expect(replay.status).toBe(409);
    expect((await replay.json() as ActionOperationResponse).status).toBe("PREVIEW_NOT_FOUND");
  });

  it.each([
    {
      name: "retrying a failed cycle",
      scenario: "BASE",
      action: { type: "RETRY_PAYMENT" },
      expected: { status: "ACTIVE" },
    },
    {
      name: "modifying the SIP amount",
      scenario: "BASE",
      action: { type: "MODIFY_AMOUNT", amount: 6000 },
      expected: { monthlyAmount: 6000, status: "ACTIVE" },
    },
    {
      name: "modifying the debit day",
      scenario: "BASE",
      action: { type: "MODIFY_DEBIT_DAY", debitDay: 15 },
      expected: { debitDay: 15, status: "ACTIVE" },
    },
    {
      name: "restarting a paused SIP",
      scenario: "PAUSED_RESTART",
      action: { type: "RESTART_SIP" },
      expected: { status: "ACTIVE" },
    },
  ])("completes the preview-confirm lifecycle for $name", async ({
    scenario,
    action,
    expected,
  }) => {
    const harness = createHarness();
    const testAction = action as PracticeActionInput;
    const testScenario = scenario as AssistantDemoScenario;
    const previewResponse = await preview(harness.handlers, testAction, testScenario);
    const previewBody = await previewResponse.json() as ActionPreviewResponse;
    const previewCookie = cookieFrom(previewResponse);

    expect(previewBody.status).toBe("PREVIEWED");
    expect(previewBody.preview.requiresConfirmation).toBe(true);
    const before = readSignedActionSession(previewCookie, SECRET, harness.now());
    expect(before.status).toBe("VALID");
    if (before.status === "VALID") {
      expect(before.session.stateVersion).toBe(0);
      expect(before.session.state).toEqual(getAssistantDemoState(testScenario));
      if (testScenario === "BASE" && testAction.type === "RETRY_PAYMENT") {
        expect(before.session.state.sip.cycles.find((cycle) => cycle.id === "cycle_2026_11")?.status).toBe("FAILED");
      }
    }

    const appliedResponse = await confirm(
      harness.handlers,
      previewBody.preview.previewId!,
      true,
      previewCookie,
    );
    const applied = await appliedResponse.json() as ActionOperationResponse;
    expect(applied.status).toBe("APPLIED_SIMULATED");
    expect(applied.result).toMatchObject({ simulated: true, realPaymentMade: false });
    expect(applied.stateSummary.sip).toMatchObject(expected);
    if (testAction.type === "RETRY_PAYMENT") {
      expect(applied.stateSummary.rewardProgress.eligibleInstalments).toBe(12);
    }
    expect(JSON.stringify(applied)).not.toMatch(/stateFingerprint|sessionId|signingSecret/i);

    const followupAction = testAction.type === "RETRY_PAYMENT"
      ? { type: "RETRY_PAYMENT" }
      : testAction.type === "MODIFY_AMOUNT"
        ? { type: "MODIFY_AMOUNT", amount: testAction.amount + 1000 }
        : testAction.type === "MODIFY_DEBIT_DAY"
          ? { type: "MODIFY_DEBIT_DAY", debitDay: testAction.debitDay + 1 }
          : { type: "RESTART_SIP" };
    const followup = await preview(
      harness.handlers,
      followupAction,
      testScenario,
      cookieFrom(appliedResponse),
    );
    const followupBody = await followup.json() as ActionPreviewResponse;
    if (testAction.type === "RETRY_PAYMENT" || testAction.type === "RESTART_SIP") {
      expect(followupBody.status).toBe("NOT_ELIGIBLE");
    } else {
      expect(followupBody.status).toBe("PREVIEWED");
      expect(followupBody.preview.effects[0]).toContain(
        action.type === "MODIFY_AMOUNT" ? "from ₹6,000" : "from 15",
      );
    }
  });

  it("invalidates a prior preview when a newer preview replaces it", async () => {
    const harness = createHarness();
    const first = await preview(harness.handlers, { type: "RETRY_PAYMENT" });
    const firstBody = await first.json() as ActionPreviewResponse;
    const firstCookie = cookieFrom(first);
    const second = await preview(
      harness.handlers,
      { type: "MODIFY_AMOUNT", amount: 6000 },
      "BASE",
      firstCookie,
    );

    expect((await second.json() as ActionPreviewResponse).status).toBe("PREVIEWED");
    const replay = await confirm(
      harness.handlers,
      firstBody.preview.previewId!,
      true,
      firstCookie,
    );
    expect(replay.status).toBe(409);
    expect((await replay.json() as ActionOperationResponse).status).toBe("PREVIEW_NOT_FOUND");
  });

  it("rejects an old preview after an explicit reset", async () => {
    const harness = createHarness();
    const created = await preview(harness.handlers, { type: "RETRY_PAYMENT" });
    const createdBody = await created.json() as ActionPreviewResponse;
    const oldCookie = cookieFrom(created);
    const reset = await harness.handlers.reset(request(
      "/api/assistant/actions/reset",
      { scenario: "BASE" },
      oldCookie,
    ));
    expect((await reset.json() as ActionOperationResponse).status).toBe("RESET");

    const replay = await confirm(
      harness.handlers,
      createdBody.preview.previewId!,
      true,
      oldCookie,
    );
    expect(replay.status).toBe(409);
    expect((await replay.json() as ActionOperationResponse).status).toBe("PREVIEW_NOT_FOUND");
  });

  it("rejects an old preview after replacing the session with another scenario", async () => {
    const harness = createHarness();
    const created = await preview(harness.handlers, { type: "RETRY_PAYMENT" });
    const createdBody = await created.json() as ActionPreviewResponse;
    const oldCookie = cookieFrom(created);
    const replacement = await preview(
      harness.handlers,
      { type: "RESTART_SIP" },
      "PAUSED_RESTART",
      oldCookie,
    );
    expect((await replacement.json() as ActionPreviewResponse).status).toBe("PREVIEWED");

    const replay = await confirm(
      harness.handlers,
      createdBody.preview.previewId!,
      true,
      oldCookie,
    );
    expect(replay.status).toBe(409);
    expect((await replay.json() as ActionOperationResponse).status).toBe("PREVIEW_NOT_FOUND");
  });

  it("accepts only one concurrent confirmation for a preview", async () => {
    const harness = createHarness();
    const created = await preview(harness.handlers, { type: "RETRY_PAYMENT" });
    const body = await created.json() as ActionPreviewResponse;
    const cookie = cookieFrom(created);
    const attempts = await Promise.all([
      confirm(harness.handlers, body.preview.previewId!, true, cookie),
      confirm(harness.handlers, body.preview.previewId!, true, cookie),
    ]);
    const results = await Promise.all(
      attempts.map(async (response) => ({
        statusCode: response.status,
        body: await response.json() as ActionOperationResponse,
      })),
    );

    expect(results.filter((result) => result.body.status === "APPLIED_SIMULATED")).toHaveLength(1);
    expect(results.some((result) =>
      result.statusCode === 409 && result.body.status === "PREVIEW_NOT_FOUND",
    )).toBe(true);
  });

  it("applies only after confirmation and persists the server-owned state for later previews", async () => {
    const harness = createHarness();
    const previewResponse = await preview(harness.handlers, { type: "RETRY_PAYMENT" });
    const previewBody = await previewResponse.json() as ActionPreviewResponse;
    const cookie = cookieFrom(previewResponse);
    const appliedResponse = await confirm(
      harness.handlers,
      previewBody.preview.previewId!,
      true,
      cookie,
    );
    const applied = await appliedResponse.json() as ActionOperationResponse;
    const updatedCookie = cookieFrom(appliedResponse);
    const stored = readSignedActionSession(updatedCookie, SECRET, harness.now());

    expect(applied.status).toBe("APPLIED_SIMULATED");
    expect(applied.message).toContain("No real transaction occurred");
    expect(applied.result).toMatchObject({
      actionType: "RETRY_PAYMENT",
      simulated: true,
      realPaymentMade: false,
      rewardProgressBefore: 11,
      rewardProgressAfter: 12,
    });
    expect(applied.stateSummary.rewardProgress.eligibleInstalments).toBe(12);
    expect(stored.status).toBe("VALID");
    if (stored.status === "VALID") {
      expect(stored.session.stateVersion).toBe(1);
      expect(stored.session.state.sip.cycles.find((cycle) => cycle.id === "cycle_2026_11")?.status).toBe("PAID");
    }

    const secondPreview = await preview(
      harness.handlers,
      { type: "RETRY_PAYMENT" },
      "BASE",
      updatedCookie,
    );
    const secondPreviewBody = await secondPreview.json() as ActionPreviewResponse;
    expect(secondPreviewBody.status).toBe("NOT_ELIGIBLE");

    const duplicate = await confirm(
      harness.handlers,
      previewBody.preview.previewId!,
      true,
      cookieFrom(secondPreview),
    );
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json() as ActionOperationResponse).status).toBe("PREVIEW_NOT_FOUND");
    expect(JSON.stringify(applied)).not.toContain("stateFingerprint");
  });

  it("resets a modified session to the original server-owned scenario fixture", async () => {
    const harness = createHarness();
    const previewResponse = await preview(
      harness.handlers,
      { type: "MODIFY_AMOUNT", amount: 6000 },
    );
    const previewBody = await previewResponse.json() as ActionPreviewResponse;
    const appliedResponse = await confirm(
      harness.handlers,
      previewBody.preview.previewId!,
      true,
      cookieFrom(previewResponse),
    );
    expect((await appliedResponse.json() as ActionOperationResponse).stateSummary.sip.monthlyAmount).toBe(6000);

    const reset = await harness.handlers.reset(request(
      "/api/assistant/actions/reset",
      { scenario: "BASE" },
      cookieFrom(appliedResponse),
    ));
    const resetBody = await reset.json() as ActionOperationResponse;
    const resetSession = readSignedActionSession(cookieFrom(reset), SECRET, harness.now());
    expect(resetBody.status).toBe("RESET");
    expect(resetBody.stateSummary).toEqual({
      scenario: "BASE",
      sip: {
        fundName: getAssistantDemoState("BASE").sip.fundName,
        monthlyAmount: 5000,
        debitDay: 10,
        status: "ACTIVE",
      },
      rewardProgress: { eligibleInstalments: 11, targetInstalments: 12, isUnlocked: false },
    });
    expect(resetSession.status).toBe("VALID");
    if (resetSession.status === "VALID") expect(resetSession.session.stateVersion).toBe(0);
  });

  it("allows deterministic practice while AI is disabled and has no model-pipeline dependency", async () => {
    const harness = createHarness({ assistantEnabled: "false" });
    const response = await preview(harness.handlers, { type: "RETRY_PAYMENT" });
    const body = await response.json() as ActionPreviewResponse;
    const source = fs.readFileSync("src/lib/assistant/action-api-handler.ts", "utf8") +
      fs.readFileSync("src/lib/assistant/action-service.ts", "utf8");

    expect(response.status).toBe(200);
    expect(body.preview.sourceLabel).toContain("no AI used");
    expect(source).not.toMatch(/from ["'][^"']*ai\/pipeline|createOpenAIModelClient/);
  });

  it("validates origin, content type, and request fields", async () => {
    const harness = createHarness();
    const crossOrigin = request("/api/assistant/actions/preview", { scenario: "BASE", action: { type: "RETRY_PAYMENT" } });
    const crossHeaders = new Headers(crossOrigin.headers);
    crossHeaders.set("origin", "https://attacker.example");
    const rejectedOrigin = await harness.handlers.preview(new Request(crossOrigin, { headers: crossHeaders }));
    expect(rejectedOrigin.status).toBe(403);

    for (const origin of [undefined, "null", "not-an-origin"]) {
      const headers = new Headers({ "content-type": "application/json" });
      if (origin !== undefined) headers.set("origin", origin);
      const rejected = await harness.handlers.preview(new Request(
        "http://localhost/api/assistant/actions/preview",
        { method: "POST", headers, body: JSON.stringify({ scenario: "BASE", action: { type: "RETRY_PAYMENT" } }) },
      ));
      expect(rejected.status).toBe(403);
    }

    const unsupported = new Request("http://localhost/api/assistant/actions/preview", {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "text/plain" },
      body: "{}",
    });
    expect((await harness.handlers.preview(unsupported)).status).toBe(415);

    const unknownField = await preview(harness.handlers, { type: "RETRY_PAYMENT", cycleId: "cycle_2026_11" });
    expect(unknownField.status).toBe(400);
    const invalidScenario = await preview(harness.handlers, { type: "RETRY_PAYMENT" }, "INVENTED");
    expect(invalidScenario.status).toBe(400);
  });

  it("enforces the 8 KiB limit on streamed bytes even when Content-Length is understated", async () => {
    const harness = createHarness();
    const body = JSON.stringify({
      scenario: "BASE",
      action: { type: "RETRY_PAYMENT" },
      padding: "x".repeat(9_000),
    });
    const oversized = new Request("http://localhost/api/assistant/actions/preview", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
        "content-length": "1",
      },
      body,
    });

    const response = await harness.handlers.preview(oversized);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
  });
});
