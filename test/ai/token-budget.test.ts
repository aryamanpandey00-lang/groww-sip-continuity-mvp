import { describe, expect, it } from "vitest";
import { ASSISTANT_SMOKE_MAX_OUTPUT_TOKENS } from "../../scripts/assistant-smoke-config";
import {
  ASSISTANT_MODEL_PROTOCOL_OVERHEAD_TOKENS,
  MAX_ASSISTANT_MODEL_INPUT_BYTES,
  createInMemoryAssistantTokenBudgetCoordinator,
  estimateMaxAssistantCallTokens,
  normalizeAssistantTokenUsage,
  resolveAssistantTokenBudgetCoordinator,
} from "@/lib/ai/token-budget";
import {
  ASSISTANT_RESPONSE_FORMAT_NAME,
  ASSISTANT_RESPONSE_JSON_SCHEMA,
} from "@/lib/ai/schemas";
import type { AssistantTokenBudgetCoordinator } from "@/lib/ai/types";

const responseFormatBytes = new TextEncoder().encode(JSON.stringify({
  response_format: {
    type: "json_schema",
    json_schema: {
      name: ASSISTANT_RESPONSE_FORMAT_NAME,
      strict: true,
      schema: ASSISTANT_RESPONSE_JSON_SCHEMA,
    },
  },
})).byteLength;

describe("assistant token budget accounting", () => {
  it("reserves atomically, settles actual usage, and fails closed at the cap", async () => {
    const coordinator = createInMemoryAssistantTokenBudgetCoordinator({
      maxTokens: 200,
      windowMs: 1_000,
    });
    const first = await coordinator.reserve({
      reservationId: "first",
      maxTokens: 100,
      nowMs: 10,
    });

    expect(first).not.toBeNull();
    expect(await coordinator.reserve({
      reservationId: "too-large",
      maxTokens: 101,
      nowMs: 10,
    })).toBeNull();

    await first!.settle(40);
    const second = await coordinator.reserve({
      reservationId: "second",
      maxTokens: 160,
      nowMs: 10,
    });
    expect(second).not.toBeNull();

    await second!.settle(null);
    expect(coordinator.snapshot(10)).toEqual({
      spentTokens: 200,
      reservedTokens: 0,
    });
    expect(await coordinator.reserve({
      reservationId: "at-cap",
      maxTokens: 1,
      nowMs: 10,
    })).toBeNull();
    expect(await coordinator.reserve({
      reservationId: "new-window",
      maxTokens: 1,
      nowMs: 1_010,
    })).not.toBeNull();
  });

  it("marks missing and inconsistent provider usage as incomplete", () => {
    expect(normalizeAssistantTokenUsage({
      input_tokens: 12,
      output_tokens: 8,
    })).toEqual({
      usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
      complete: true,
    });
    expect(normalizeAssistantTokenUsage({
      input_tokens: 12,
      output_tokens: 8,
      total_tokens: 19,
    })).toEqual({
      usage: { inputTokens: 12, outputTokens: 8, totalTokens: 19 },
      complete: false,
    });
    expect(normalizeAssistantTokenUsage(null)).toEqual({
      usage: null,
      complete: false,
    });
  });

  it("accounts Groq Chat usage without double-counting reasoning details", () => {
    expect(normalizeAssistantTokenUsage({
      prompt_tokens: 82,
      prompt_tokens_details: { cached_tokens: 4 },
      completion_tokens: 266,
      completion_tokens_details: { reasoning_tokens: 18 },
      total_tokens: 348,
    })).toEqual({
      usage: { inputTokens: 82, outputTokens: 266, totalTokens: 348 },
      complete: true,
    });
  });

  it("reserves UTF-8 input, the full response format, output cap, and protocol allowance", () => {
    const input = { instructions: "sys", input: "hello" };
    expect(estimateMaxAssistantCallTokens(input, 700)).toBe(
      8 + responseFormatBytes + 700 + ASSISTANT_MODEL_PROTOCOL_OVERHEAD_TOKENS,
    );
    expect(estimateMaxAssistantCallTokens(
      { instructions: "₹", input: "🙂" },
      700,
    )).toBe(
      7 + responseFormatBytes + 700 + ASSISTANT_MODEL_PROTOCOL_OVERHEAD_TOKENS,
    );
  });

  it("includes the full 1024-token smoke cap before the provider call", () => {
    const input = { instructions: "sys", input: "hello" };
    const reservation256 = estimateMaxAssistantCallTokens(input, 256);
    const reservation1024 = estimateMaxAssistantCallTokens(
      input,
      ASSISTANT_SMOKE_MAX_OUTPUT_TOKENS,
    );

    expect(reservation1024 - reservation256).toBe(768);
    expect(reservation1024).toBe(
      8 + responseFormatBytes + ASSISTANT_SMOKE_MAX_OUTPUT_TOKENS + ASSISTANT_MODEL_PROTOCOL_OVERHEAD_TOKENS,
    );
  });

  it("admits the exact bounded input size and rejects one byte over", () => {
    const maxTextBytes = MAX_ASSISTANT_MODEL_INPUT_BYTES - responseFormatBytes;
    const atLimit = { instructions: "x".repeat(maxTextBytes), input: "" };
    const overLimit = { instructions: `${"x".repeat(maxTextBytes)}x`, input: "" };

    expect(estimateMaxAssistantCallTokens(atLimit, 2_000)).toBe(
      MAX_ASSISTANT_MODEL_INPUT_BYTES +
        2_000 +
        ASSISTANT_MODEL_PROTOCOL_OVERHEAD_TOKENS,
    );
    expect(() => estimateMaxAssistantCallTokens(overLimit, 2_000)).toThrow(
      "Assistant model input exceeds the supported byte limit.",
    );
  });

  it("counts multibyte text by its UTF-8 byte length", () => {
    expect(estimateMaxAssistantCallTokens(
      { instructions: "\u20B9", input: "\u{1F642}" },
      700,
    )).toBe(
      3 + 4 + responseFormatBytes + 700 + ASSISTANT_MODEL_PROTOCOL_OVERHEAD_TOKENS,
    );
  });

  it("rejects output limits outside the provider's configured ceiling", () => {
    expect(() => estimateMaxAssistantCallTokens({ instructions: "s", input: "u" }, 63)).toThrow(
      "Assistant model output limit is outside the supported range.",
    );
    expect(() => estimateMaxAssistantCallTokens({ instructions: "s", input: "u" }, 2_001)).toThrow(
      "Assistant model output limit is outside the supported range.",
    );
  });

  it("does not use process-local token budgets for production", () => {
    expect(resolveAssistantTokenBudgetCoordinator({ NODE_ENV: "production" })).toBeNull();
    expect(resolveAssistantTokenBudgetCoordinator({ NODE_ENV: "test" })).not.toBeNull();
    const local = createInMemoryAssistantTokenBudgetCoordinator({
      maxTokens: 10,
      windowMs: 100,
    });
    expect(
      resolveAssistantTokenBudgetCoordinator({ NODE_ENV: "production" }, local),
    ).toBeNull();
    const shared: AssistantTokenBudgetCoordinator = {
      scope: "deployment-shared",
      reserve: () => null,
    };
    expect(resolveAssistantTokenBudgetCoordinator(
      { NODE_ENV: "production", SHARED_RUNTIME_VERIFIED: "true" },
      shared,
    )).toBe(shared);
    expect(resolveAssistantTokenBudgetCoordinator(
      { NODE_ENV: "production", SHARED_RUNTIME_VERIFIED: "false" },
      shared,
    )).toBeNull();
  });
});
