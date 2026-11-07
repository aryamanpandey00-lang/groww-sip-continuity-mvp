import { describe, expect, it } from "vitest";
import { ASSISTANT_JOURNEYS } from "@/components/assistant/journeys";
import { runAssistant } from "@/lib/ai/pipeline";
import { createInMemoryAssistantDemoQuotaCoordinator } from "@/lib/ai/demo-quota";
import { createInMemoryAssistantTokenBudgetCoordinator } from "@/lib/ai/token-budget";
import type { AssistantModelOutput } from "@/lib/ai/types";
import {
  confirmSimulatedAction,
  previewSimulatedAction,
} from "@/lib/domain/action-engine";
import { getAssistantDemoState } from "@/lib/domain/fixtures/assistant-scenarios";
import {
  fakeModelClient,
  okResult,
  READY_CONFIG,
} from "./fixtures";

const FIXED_NOW = () => new Date("2026-11-12T10:00:00.000Z");

const JOURNEY_OUTPUTS: Record<string, AssistantModelOutput> = {
  INSUFFICIENT_FUNDS: {
    intent: "INSUFFICIENT_FUNDS",
    directAnswer:
      "In this fictional demo, insufficient funds caused the simulated failed debit. A retry can be previewed within the seven-calendar-day window, including its final day. This is not Groww policy.",
    keyPoints: [],
    citedEvidenceIds: [
      "demo-policy.insufficient-funds",
      "demo-policy.retry-window",
    ],
    proposedAction: { type: "NONE" },
    followUpQuestion: "",
    refusal: false,
  },
  PAYMENT_FAILED: {
    intent: "PAYMENT_FAILED",
    directAnswer:
      "The fictional demo state marks this SIP debit as failed. Under the fictional demo rule, a retry may be previewed within the seven-calendar-day window. This explanation does not make a payment, and this is not Groww policy.",
    keyPoints: [],
    citedEvidenceIds: ["demo-policy.retry-window"],
    proposedAction: { type: "NONE" },
    followUpQuestion: "",
    refusal: false,
  },
  MARKET_UNCERTAINTY: {
    intent: "MARKET_UNCERTAINTY",
    directAnswer:
      "Mutual-fund NAV can rise or fall as market conditions change. AMFI describes a SIP as investing a fixed sum on a fixed schedule, which can help avoid trying to time the market. This does not predict or guarantee returns and is general education.",
    keyPoints: [],
    citedEvidenceIds: [
      "general-education.market-volatility",
      "general-education.sip-discipline",
      "general-education.no-guaranteed-returns",
    ],
    proposedAction: { type: "NONE" },
    followUpQuestion: "",
    refusal: false,
  },
  MODIFY_SIP: {
    intent: "MODIFY_SIP",
    directAnswer:
      "Under the fictional demo rules, the monthly SIP amount can range from INR 500 to INR 25,000, and a change takes effect from the next monthly cycle. The debit day can range from day 1 to day 28, also taking effect from the next cycle. This is not Groww policy; no change is made by this explanation.",
    keyPoints: [],
    citedEvidenceIds: [
      "demo-policy.amount-modification",
      "demo-policy.debit-day-modification",
    ],
    proposedAction: { type: "NONE" },
    followUpQuestion: "",
    refusal: false,
  },
  RESTART_SIP: {
    intent: "RESTART_SIP",
    directAnswer:
      "The PAUSED_RESTART scenario is fictional and its SIP is paused. The demo rule allows restart within 90 calendar days of the pause, so this scenario is eligible for a restart preview. This is not Groww policy; no restart is applied.",
    keyPoints: [],
    citedEvidenceIds: ["demo-policy.restart-eligibility"],
    proposedAction: { type: "NONE" },
    followUpQuestion: "",
    refusal: false,
  },
  REWARD_MILESTONE: {
    intent: "REWARD_MILESTONE",
    directAnswer:
      "The fictional demo shows progress of 11 out of 12 eligible instalments. Its displayed voucher is simulated and not redeemable; it is not an actual Groww reward.",
    keyPoints: [],
    citedEvidenceIds: ["demo-policy.reward-progress"],
    proposedAction: { type: "NONE" },
    followUpQuestion: "",
    refusal: false,
  },
};

function dependencies(output?: AssistantModelOutput) {
  const modelClient = fakeModelClient(output ? [okResult(output)] : []);
  const quota = createInMemoryAssistantDemoQuotaCoordinator({
    maxSuccessfulResponses: 10,
  });

  return {
    modelClient,
    quota,
    options: {
      env: { NODE_ENV: "test" },
      config: READY_CONFIG,
      modelClient,
      budgetCoordinator: createInMemoryAssistantTokenBudgetCoordinator({
        maxTokens: 100_000,
        windowMs: 60 * 60 * 1_000,
      }),
      demoQuotaCoordinator: quota,
      allowRepair: false,
      now: FIXED_NOW,
    },
  };
}

describe("predefined assistant journeys", () => {
  it("returns grounded, schema-valid answers for all six exact card questions", async () => {
    expect(ASSISTANT_JOURNEYS).toHaveLength(6);

    for (const journey of ASSISTANT_JOURNEYS) {
      const fixture = JOURNEY_OUTPUTS[journey.id];
      expect(fixture, journey.id).toBeDefined();
      const deps = dependencies(fixture);
      const result = await runAssistant(
        {
          question: journey.starterQuestion,
          selectedCategory: journey.id,
          state: getAssistantDemoState(journey.demoScenario),
        },
        deps.options,
      );

      expect(result.status, journey.id).toBe("APPROVED");
      expect(result.gateResult?.passed, journey.id).toBe(true);
      expect(result.executionPerformed, journey.id).toBe(false);
      expect(result.proposedAction, journey.id).toEqual({ type: "NONE" });
      expect(result.citedEvidenceIds.length, journey.id).toBeGreaterThan(0);
      expect(
        result.citedEvidenceIds.every((id) => result.retrievedEvidenceIds.includes(id)),
        journey.id,
      ).toBe(true);
      expect(deps.modelClient.calls, journey.id).toHaveLength(1);
      expect(deps.quota.snapshot(), journey.id).toEqual({
        successfulResponses: 1,
        reservedResponses: 0,
      });

      const citedEvidence = result.retrievedEvidenceItems.filter((item) =>
        result.citedEvidenceIds.includes(item.evidenceId),
      );
      if (journey.id === "MARKET_UNCERTAINTY") {
        expect(citedEvidence.every((item) =>
          item.sourceTier === "general_education" &&
          item.verificationStatus === "verified",
        )).toBe(true);
      } else {
        expect(citedEvidence.every((item) =>
          item.sourceTier === "demo_policy" &&
          item.verificationStatus === "fictional_demo",
        )).toBe(true);
      }
    }
  });

  it("requires action details for mixed requests and keeps specified changes preview-only", async () => {
    const missingValueQuestion = "Explain the rules and change my SIP amount";
    const missingValueDeps = dependencies();
    const missingValueResult = await runAssistant(
      {
        question: missingValueQuestion,
        selectedCategory: "MODIFY_SIP",
        state: getAssistantDemoState("BASE"),
      },
      missingValueDeps.options,
    );

    expect(missingValueResult.status).toBe("NEEDS_MORE_INFORMATION");
    expect(missingValueResult.followUpQuestion).toMatch(/monthly SIP amount/i);
    expect(missingValueResult.proposedAction).toEqual({ type: "NONE" });
    expect(missingValueResult.executionPerformed).toBe(false);
    expect(missingValueDeps.modelClient.calls).toHaveLength(0);
    expect(missingValueDeps.quota.snapshot()).toEqual({
      successfulResponses: 0,
      reservedResponses: 0,
    });

    const specifiedQuestion =
      "Explain the rules and change my SIP amount to ₹5,000";
    const state = getAssistantDemoState("BASE");
    const specifiedDeps = dependencies({
      ...JOURNEY_OUTPUTS.MODIFY_SIP,
      directAnswer:
        "Under the fictional demo rules, you can preview changing the monthly amount to ₹5,000. Nothing has changed, and this is not Groww policy.",
      citedEvidenceIds: ["demo-policy.amount-modification"],
      proposedAction: { type: "MODIFY_AMOUNT", amount: 5_000 },
    });
    const specifiedResult = await runAssistant(
      {
        question: specifiedQuestion,
        selectedCategory: "MODIFY_SIP",
        state,
      },
      specifiedDeps.options,
    );

    expect(specifiedResult.status).toBe("APPROVED");
    expect(specifiedResult.gateResult?.passed).toBe(true);
    expect(specifiedResult.proposedAction).toEqual({
      type: "MODIFY_AMOUNT",
      amount: 5_000,
    });
    expect(specifiedResult.executionPerformed).toBe(false);

    if (specifiedResult.proposedAction.type !== "MODIFY_AMOUNT") {
      throw new Error("Expected a validated amount preview proposal.");
    }
    const preview = previewSimulatedAction(
      state,
      specifiedResult.proposedAction,
      "2026-11-12T10:00:00.000Z",
    );
    expect(preview).toMatchObject({
      status: "PREVIEWED",
      requiresConfirmation: true,
    });
    const awaitingConfirmation = confirmSimulatedAction(preview, state, {
      confirmed: false,
      confirmedAt: "2026-11-12T10:00:00.000Z",
    });
    expect(awaitingConfirmation).toMatchObject({
      status: "AWAITING_CONFIRMATION",
      applied: false,
      nextState: null,
    });
  });

  it("does not call a model for unsupported official-policy or real-account requests", async () => {
    const unsupportedQuestions = [
      "What is Groww's official policy for failed SIP payments?",
      "What is my actual Groww account balance?",
    ];

    for (const question of unsupportedQuestions) {
      const deps = dependencies();
      const result = await runAssistant(
        { question },
        deps.options,
      );

      expect(result.status).toBe("SAFE_FALLBACK");
      expect(result.fallbackUsed).toBe(true);
      expect(result.citedEvidenceIds).toEqual([]);
      expect(result.executionPerformed).toBe(false);
      expect(deps.modelClient.calls).toHaveLength(0);
      expect(deps.quota.snapshot()).toEqual({
        successfulResponses: 0,
        reservedResponses: 0,
      });
    }
  });

  it("fails safely when a provider response cites evidence outside the retrieved packet", async () => {
    const journey = ASSISTANT_JOURNEYS.find(
      (item) => item.id === "RESTART_SIP",
    );
    expect(journey).toBeDefined();
    const deps = dependencies({
      ...JOURNEY_OUTPUTS.RESTART_SIP,
      citedEvidenceIds: ["demo-policy.not-in-packet"],
    });
    const result = await runAssistant(
      {
        question: journey!.starterQuestion,
        selectedCategory: journey!.id,
        state: getAssistantDemoState(journey!.demoScenario),
      },
      deps.options,
    );

    expect(result.status).toBe("SAFE_FALLBACK");
    expect(result.fallbackReason).toBe("MODEL_INVALID_OUTPUT");
    expect(result.gateResult?.passed).toBe(false);
    expect(result.gateResult?.criticalFailures.map((failure) => failure.code)).toContain(
      "CITATION_SCOPE_VIOLATION",
    );
    expect(result.executionPerformed).toBe(false);
    expect(deps.quota.snapshot()).toEqual({
      successfulResponses: 0,
      reservedResponses: 0,
    });
  });
});
