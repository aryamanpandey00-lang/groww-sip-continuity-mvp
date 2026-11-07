import { describe, expect, it } from "vitest";
import { createAssistantRateLimiter } from "@/lib/ai/rate-limit";
import { createActionApiHandlers } from "@/lib/assistant/action-api-handler";
import {
  ACTION_SESSION_COOKIE_NAME,
  createActionDemoSession,
  signActionDemoSession,
} from "@/lib/assistant/action-session";
import { InMemorySharedActionSessionStore } from "../helpers/in-memory-shared-action-store";

const SECRET = "unit-test-only-action-session-secret-32-bytes";

function setup(options: { production?: boolean; verified?: boolean } = {}) {
  let nowMs = Date.now();
  const store = new InMemorySharedActionSessionStore(() => nowMs);
  const handlers = createActionApiHandlers({
    env: {
      NODE_ENV: options.production ? "production" : "test",
      SHARED_RUNTIME_VERIFIED: options.verified ? "true" : "false",
      ACTION_SESSION_SIGNING_SECRET: SECRET,
    },
    sessionStore: store,
    now: () => nowMs,
    rateLimiter: createAssistantRateLimiter({ maxRequests: 100 }),
  });
  return { handlers, store, now: () => nowMs, setNow: (value: number) => { nowMs = value; } };
}

function request(path: string, body: unknown, cookie?: string): Request {
  const headers = new Headers({ origin: "http://localhost", "content-type": "application/json" });
  if (cookie) headers.set("cookie", cookie);
  return new Request(`http://localhost${path}`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
}

function cookieFrom(response: Response): string {
  const value = response.headers.get("set-cookie");
  if (!value) throw new Error("Expected a persisted session cookie.");
  return value.split(";", 1)[0]!;
}

async function preview(handlers: ReturnType<typeof createActionApiHandlers>, cookie?: string) {
  return handlers.preview(request(
    "/api/assistant/actions/preview",
    { scenario: "BASE", action: { type: "RETRY_PAYMENT" } },
    cookie,
  ));
}

async function confirm(
  handlers: ReturnType<typeof createActionApiHandlers>,
  previewId: string,
  cookie: string,
) {
  return handlers.confirm(request(
    "/api/assistant/actions/confirm",
    { previewId, confirmed: true },
    cookie,
  ));
}

describe("deployment-shared action session behavior", () => {
  it("rejects a valid HMAC cookie for an unknown shared session", async () => {
    const harness = setup();
    const unknown = signActionDemoSession(createActionDemoSession("BASE", harness.now()), SECRET);
    const response = await preview(harness.handlers, `${ACTION_SESSION_COOKIE_NAME}=${unknown}`);
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("INVALID_SESSION");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects stale cookies and consumes replaced previews", async () => {
    const harness = setup();
    const first = await preview(harness.handlers);
    const firstCookie = cookieFrom(first);
    const firstBody = await first.json() as { preview: { previewId: string } };
    const second = await preview(harness.handlers, firstCookie);
    const secondCookie = cookieFrom(second);

    const oldPreview = await confirm(harness.handlers, firstBody.preview.previewId, secondCookie);
    expect(oldPreview.status).toBe(409);
    expect((await oldPreview.json()).status).toBe("PREVIEW_NOT_FOUND");
    const staleCookie = await confirm(harness.handlers, firstBody.preview.previewId, firstCookie);
    expect(staleCookie.status).toBe(401);
  });

  it("revokes the old session when the requested demo scenario changes", async () => {
    const harness = setup();
    const first = await preview(harness.handlers);
    const firstCookie = cookieFrom(first);
    const changed = await harness.handlers.preview(request(
      "/api/assistant/actions/preview",
      { scenario: "PAUSED_RESTART", action: { type: "RESTART_SIP" } },
      firstCookie,
    ));
    const currentCookie = cookieFrom(changed);
    expect(changed.status).toBe(200);
    const stale = await confirm(harness.handlers, "00000000-0000-4000-8000-000000000001", firstCookie);
    expect(stale.status).toBe(401);
    const current = await confirm(
      harness.handlers,
      (await changed.json() as { preview: { previewId: string } }).preview.previewId,
      currentCookie,
    );
    expect(current.status).toBe(200);
    expect((await current.json()).status).toBe("APPLIED_SIMULATED");
  });

  it("allows only one of two concurrent confirmations to commit", async () => {
    const harness = setup();
    const created = await preview(harness.handlers);
    const cookie = cookieFrom(created);
    const body = await created.json() as { preview: { previewId: string } };
    const outcomes = await Promise.all([
      confirm(harness.handlers, body.preview.previewId, cookie),
      confirm(harness.handlers, body.preview.previewId, cookie),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 200)).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 409 || outcome.status === 401)).toHaveLength(1);
  });

  it("makes reset and confirmation race through the same cookie/version CAS", async () => {
    const harness = setup();
    const created = await preview(harness.handlers);
    const cookie = cookieFrom(created);
    const body = await created.json() as { preview: { previewId: string } };
    const [confirmation, reset] = await Promise.all([
      confirm(harness.handlers, body.preview.previewId, cookie),
      harness.handlers.reset(request("/api/assistant/actions/reset", { scenario: "BASE" }, cookie)),
    ]);
    expect([confirmation.status, reset.status].filter((status) => status === 200)).toHaveLength(1);
    expect([confirmation.status, reset.status].every((status) => status === 200 || status === 401 || status === 409)).toBe(true);
  });

  it("does not issue a cookie when shared storage fails", async () => {
    const harness = setup();
    harness.store.failNextOperation();
    const response = await preview(harness.handlers);
    expect(response.status).toBe(500);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("keeps production routes disabled until the explicit verification gate is set", async () => {
    const harness = setup({ production: true, verified: false });
    const response = await preview(harness.handlers);
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
