import { describe, expect, it } from "vitest";
import {
  hasJsonContentType,
  hasSameOrigin,
  assistantRateLimitKey,
  readBoundedAssistantJson,
  validateAssistantApiRequest,
} from "@/lib/ai/api-validation";
import { createAssistantRateLimiter } from "@/lib/ai/rate-limit";
import {
  ASSISTANT_DEMO_SCENARIOS,
  getAssistantDemoState,
} from "@/lib/domain/fixtures/assistant-scenarios";

const validBody = {
  question: "  Why did my SIP payment fail?  ",
  selectedCategory: "PAYMENT_FAILED",
  demoScenario: "BASE",
};

function requestWith(body: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/assistant", {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "content-type": "application/json",
      ...headers,
    },
    body,
  });
}

describe("assistant API request validation", () => {
  it("trims a valid question and defaults the server-owned scenario", () => {
    const result = validateAssistantApiRequest({
      question: "  What is a SIP?  ",
    });

    expect(result).toEqual({
      valid: true,
      request: {
        question: "What is a SIP?",
        selectedCategory: undefined,
        demoScenario: "BASE",
      },
    });
  });

  it("accepts the six existing problem categories and fixed scenarios", () => {
    expect(
      validateAssistantApiRequest({
        question: validBody.question,
        selectedCategory: "PAYMENT_FAILED",
        demoScenario: "BASE",
      }).valid,
    ).toBe(true);
    expect(ASSISTANT_DEMO_SCENARIOS).toEqual(["BASE", "PAUSED_RESTART"]);
  });

  it.each(["", "   ", "x".repeat(2_001)])(
    "rejects an empty or overlong question",
    (question) => {
      expect(validateAssistantApiRequest({ question }).valid).toBe(false);
    },
  );

  it.each([
    "state",
    "evidence",
    "balance",
    "policy",
    "permissions",
    "instructions",
    "conversationHistory",
  ])("rejects client-controlled or unexpected field %s", (field) => {
    expect(
      validateAssistantApiRequest({
        question: "What is a SIP?",
        [field]: {},
      }).valid,
    ).toBe(false);
  });

  it("rejects invalid categories and scenarios", () => {
    expect(
      validateAssistantApiRequest({
        question: "Help",
        selectedCategory: "ADMIN",
      }).valid,
    ).toBe(false);
    expect(
      validateAssistantApiRequest({
        question: "Help",
        demoScenario: "CUSTOM_STATE",
      }).valid,
    ).toBe(false);
  });

  it("checks JSON content type without accepting other media types", () => {
    expect(
      hasJsonContentType(requestWith(JSON.stringify(validBody))),
    ).toBe(true);
    expect(
      hasJsonContentType(
        requestWith(JSON.stringify(validBody), {
          "content-type": "text/plain",
        }),
      ),
    ).toBe(false);
  });

  it("requires a valid exact same-origin Origin header", () => {
    const make = (origin?: string) =>
      new Request("https://demo.example/api/assistant", {
        method: "POST",
        headers: origin === undefined ? {} : { origin },
      });

    expect(hasSameOrigin(make("https://demo.example"))).toBe(true);
    expect(hasSameOrigin(make())).toBe(false);
    expect(hasSameOrigin(make("null"))).toBe(false);
    expect(hasSameOrigin(make("not a URL"))).toBe(false);
    expect(hasSameOrigin(make("https://attacker.example"))).toBe(false);
    expect(hasSameOrigin(make("https://demo.example/extra"))).toBe(false);
  });

  it("limits the actual streamed body bytes even without a length header", async () => {
    const tooLarge = requestWith(JSON.stringify({ question: "x".repeat(9_000) }));
    const result = await readBoundedAssistantJson(tooLarge);

    expect(result).toEqual({ status: "PAYLOAD_TOO_LARGE" });
  });

  it("rejects malformed JSON", async () => {
    const result = await readBoundedAssistantJson(requestWith("{"));

    expect(result).toEqual({ status: "INVALID_JSON" });
  });
});

describe("server-owned assistant demo scenarios", () => {
  it("returns an isolated clone of the base fixture", () => {
    const state = getAssistantDemoState("BASE");
    state.sip.monthlyAmount = 9_000;

    expect(getAssistantDemoState("BASE").sip.monthlyAmount).toBe(5_000);
  });

  it("builds the paused restart scenario from the domain fixture", () => {
    const state = getAssistantDemoState("PAUSED_RESTART");

    expect(state.sip.status).toBe("PAUSED");
    expect(state.sip.pausedOn).toBe("2026-10-13");
    expect(state.sip.cycles.every((cycle) => cycle.scheduledDate <= "2026-10-13")).toBe(
      true,
    );
    expect(getAssistantDemoState("BASE").sip.status).toBe("ACTIVE");
  });
});

describe("bounded assistant rate limiter", () => {
  it("does not let untrusted forwarding headers create fresh rate-limit identities", () => {
    const keyFor = (headers: Record<string, string>) =>
      assistantRateLimitKey(
        new Request("https://demo.example/api/assistant", { headers }),
      );
    const limiter = createAssistantRateLimiter({ maxRequests: 1 });
    const firstKey = keyFor({ "x-forwarded-for": "198.51.100.10" });
    const forgedKey = keyFor({
      "x-forwarded-for": "203.0.113.88",
      "x-real-ip": "203.0.113.89",
    });

    expect(forgedKey).toBe(firstKey);
    expect(limiter.acquire(firstKey, 0).allowed).toBe(true);
    expect(limiter.acquire(forgedKey, 0)).toMatchObject({
      allowed: false,
      reason: "RATE_LIMITED",
    });
  });

  it("enforces request quotas and resets them on a deterministic window", () => {
    const limiter = createAssistantRateLimiter({
      maxRequests: 2,
      windowMs: 1_000,
      maxConcurrentPerKey: 2,
      maxConcurrentTotal: 3,
      maxTrackedKeys: 5,
    });
    const first = limiter.acquire("test-ip", 0);
    const second = limiter.acquire("test-ip", 0);
    first.release();
    second.release();

    expect(limiter.acquire("test-ip", 0)).toMatchObject({
      allowed: false,
      reason: "RATE_LIMITED",
    });
    expect(limiter.acquire("test-ip", 1_000).allowed).toBe(true);
  });

  it("limits per-key and total in-flight requests without timers", () => {
    const limiter = createAssistantRateLimiter({
      maxRequests: 10,
      windowMs: 60_000,
      maxConcurrentPerKey: 1,
      maxConcurrentTotal: 2,
      maxTrackedKeys: 5,
    });
    const first = limiter.acquire("ip-a", 100);

    expect(limiter.acquire("ip-a", 100)).toMatchObject({
      allowed: false,
      reason: "CONCURRENCY_LIMITED",
    });
    const second = limiter.acquire("ip-b", 100);
    expect(limiter.acquire("ip-c", 100)).toMatchObject({
      allowed: false,
      reason: "CONCURRENCY_LIMITED",
    });

    first.release();
    second.release();
    expect(limiter.acquire("ip-a", 100).allowed).toBe(true);
  });

  it("bounds tracked keys and recovers after expired buckets are pruned", () => {
    const limiter = createAssistantRateLimiter({
      maxRequests: 10,
      windowMs: 1_000,
      maxConcurrentPerKey: 1,
      maxConcurrentTotal: 2,
      maxTrackedKeys: 1,
    });
    const first = limiter.acquire("ip-a", 0);
    first.release();

    expect(limiter.acquire("ip-b", 0)).toMatchObject({
      allowed: false,
      reason: "RATE_LIMITED",
    });
    expect(limiter.acquire("ip-b", 1_000).allowed).toBe(true);
  });
});
