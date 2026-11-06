import { describe, expect, it } from "vitest";
import {
  createInMemoryAssistantTokenBudgetCoordinator,
  estimateMaxAssistantCallTokens,
  normalizeAssistantTokenUsage,
  resolveAssistantTokenBudgetCoordinator,
} from "@/lib/ai/token-budget";

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

  it("uses a conservative upper bound for each model attempt", () => {
    const input = { instructions: "sys", input: "hello" };
    expect(estimateMaxAssistantCallTokens(input, 700)).toBe(964);
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
  });
});
