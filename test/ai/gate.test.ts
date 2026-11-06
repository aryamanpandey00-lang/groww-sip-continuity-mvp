import { describe, expect, it } from "vitest";
import { evaluateRuntimeGate } from "@/lib/ai/gate";
import { PAYMENT_QUESTION, buildPacket, validEducationOutput, validPaymentOutput } from "./fixtures";
import type { AssistantModelOutput } from "@/lib/ai/types";

function gateResult(
  output: unknown,
  context: ReturnType<typeof buildPacket>,
) {
  return evaluateRuntimeGate({
    rawOutput:
      typeof output === "string" ? output : JSON.stringify(output),
    packet: context.packet,
    state: context.state,
  }).result;
}

function failureCodes(
  output: unknown,
  context: ReturnType<typeof buildPacket>,
): string[] {
  return gateResult(output, context).criticalFailures.map(
    (failure) => failure.code,
  );
}

describe("runtime gate", () => {
  it("approves valid evidence-backed structured output", () => {
    const context = buildPacket({
      question: PAYMENT_QUESTION,
      intent: "PAYMENT_FAILED",
    });
    const evaluation = evaluateRuntimeGate({
      rawOutput: JSON.stringify(validPaymentOutput()),
      packet: context.packet,
      state: context.state,
    });

    expect(evaluation.result.passed).toBe(true);
    expect(evaluation.result.criticalFailures).toEqual([]);
    expect(evaluation.result.qualityLabel).toBe("Limited evidence");
    expect(evaluation.output?.citedEvidenceIds).toEqual([
      "demo-policy.retry-window",
    ]);
  });

  it("blocks malformed structured output", () => {
    const context = buildPacket({
      question: PAYMENT_QUESTION,
      intent: "PAYMENT_FAILED",
    });

    expect(failureCodes("not json", context)).toContain("SCHEMA_INVALID");
  });

  it("blocks an intent mismatch", () => {
    const context = buildPacket({
      question: PAYMENT_QUESTION,
      intent: "PAYMENT_FAILED",
    });

    expect(
      failureCodes(
        validPaymentOutput({ intent: "GENERAL_SIP_EDUCATION" }),
        context,
      ),
    ).toContain("INTENT_MISMATCH");
  });

  it("blocks citations outside the retrieved packet", () => {
    const context = buildPacket({
      question: PAYMENT_QUESTION,
      intent: "PAYMENT_FAILED",
    });

    expect(
      failureCodes(
        validPaymentOutput({ citedEvidenceIds: ["outside.evidence.id"] }),
        context,
      ),
    ).toContain("CITATION_SCOPE_VIOLATION");
  });

  it("blocks unsupported factual guidance without citations", () => {
    const context = buildPacket({
      question: PAYMENT_QUESTION,
      intent: "PAYMENT_FAILED",
    });

    expect(
      failureCodes(
        validPaymentOutput({ citedEvidenceIds: [] }),
        context,
      ),
    ).toContain("MISSING_CITATIONS");
  });

  it("blocks duplicate evidence citations", () => {
    const context = buildPacket({
      question: PAYMENT_QUESTION,
      intent: "PAYMENT_FAILED",
    });
    const output = validPaymentOutput({
      citedEvidenceIds: [
        "demo-policy.retry-window",
        "demo-policy.retry-window",
      ],
    });
    const result = gateResult(output, context);

    expect(result.criticalFailures.map((failure) => failure.code)).toContain(
      "DUPLICATE_CITATION",
    );
    expect(result.passed).toBe(false);
    expect(result.qualityLabel).toBeNull();
  });

  it("blocks an official-policy claim without official evidence", () => {
    const context = buildPacket({
      question: "What is a SIP?",
      intent: "GENERAL_SIP_EDUCATION",
    });
    const officialContext: ReturnType<typeof buildPacket> = {
      ...context,
      packet: {
        ...context.packet,
        question: "What is Groww's official policy on retries?",
        intent: "OFFICIAL_GROWW_POLICY",
        evidenceIntent: "official_groww_policy",
        requiresCitations: true,
      },
    };
    const output: AssistantModelOutput = {
      intent: "OFFICIAL_GROWW_POLICY",
      directAnswer:
        "The documented official policy allows a simulated retry within the stated window.",
      keyPoints: [],
      citedEvidenceIds: ["general-education.sip-basics"],
      proposedAction: { type: "NONE" },
      followUpQuestion: "",
      refusal: false,
    };
    const result = gateResult(output, officialContext);

    expect(result.criticalFailures.map((failure) => failure.code)).toContain(
      "MISSING_REQUIRED_CITATION_TIER",
    );
    expect(result.passed).toBe(false);
    expect(result.qualityLabel).toBeNull();
  });

  it("blocks an invented amount", () => {
    const context = buildPacket({
      question: PAYMENT_QUESTION,
      intent: "PAYMENT_FAILED",
    });
    const output = validPaymentOutput({
      directAnswer:
        "The fictional demo debit failed. A fictional fee of ₹7,500 applies under demo policy.",
    });

    expect(failureCodes(output, context)).toContain("INVENTED_AMOUNT");
  });

  it("blocks an invented date", () => {
    const context = buildPacket({
      question: PAYMENT_QUESTION,
      intent: "PAYMENT_FAILED",
    });
    const output = validPaymentOutput({
      directAnswer:
        "The fictional demo debit failed on 10 November 2026. A retry is available through 20 November 2026 under fictional demo policy.",
    });

    expect(failureCodes(output, context)).toContain("INVENTED_DATE");
  });

  it("blocks attributing fictional demo policy to Groww", () => {
    const context = buildPacket({
      question: PAYMENT_QUESTION,
      intent: "PAYMENT_FAILED",
    });
    const output = validPaymentOutput({
      directAnswer:
        "Under Groww policy, you can retry the debit through 17 November 2026.",
    });

    expect(failureCodes(output, context)).toContain(
      "DEMO_POLICY_MISATTRIBUTION",
    );
  });

  it("blocks an unsupported account-specific claim", () => {
    const context = buildPacket({
      question: "What is my actual Groww account balance?",
      intent: "ACCOUNT_SPECIFIC",
    });
    const output: AssistantModelOutput = {
      intent: "ACCOUNT_SPECIFIC",
      directAnswer: "Your account balance is ₹5,000.",
      keyPoints: [],
      citedEvidenceIds: [],
      proposedAction: { type: "NONE" },
      followUpQuestion: "",
      refusal: false,
    };

    expect(failureCodes(output, context)).toContain(
      "ACCOUNT_SPECIFIC_UNSUPPORTED",
    );
  });

  it("blocks using general education to support an account-specific claim", () => {
    const context = buildPacket({
      question: "What is a SIP?",
      intent: "GENERAL_SIP_EDUCATION",
    });
    const output = validEducationOutput({
      directAnswer:
        "Your account balance is ₹5,000. A SIP invests a fixed amount regularly.",
    });

    expect(failureCodes(output, context)).toContain(
      "ACCOUNT_SPECIFIC_UNSUPPORTED",
    );
  });

  it("blocks guaranteed-return claims", () => {
    const context = buildPacket({
      question: "Will my SIP give guaranteed returns?",
      intent: "GUARANTEED_RETURN_REQUEST",
    });
    const output: AssistantModelOutput = {
      intent: "GUARANTEED_RETURN_REQUEST",
      directAnswer: "This SIP guarantees returns of 15% per year.",
      keyPoints: [],
      citedEvidenceIds: [],
      proposedAction: { type: "NONE" },
      followUpQuestion: "",
      refusal: false,
    };

    expect(failureCodes(output, context)).toContain(
      "GUARANTEED_RETURN_CLAIM",
    );
  });

  it("blocks specific fund recommendations", () => {
    const context = buildPacket({
      question: "Which mutual fund is best?",
      intent: "FUND_RECOMMENDATION_REQUEST",
    });
    const output: AssistantModelOutput = {
      intent: "FUND_RECOMMENDATION_REQUEST",
      directAnswer: "I recommend the Fictional Flexi Cap Fund for you.",
      keyPoints: [],
      citedEvidenceIds: [],
      proposedAction: { type: "NONE" },
      followUpQuestion: "",
      refusal: false,
    };

    expect(failureCodes(output, context)).toContain("FUND_RECOMMENDATION");
  });

  it("blocks prompt-injection override and prompt disclosure", () => {
    const context = buildPacket({
      question: PAYMENT_QUESTION,
      intent: "PAYMENT_FAILED",
    });
    const output = validPaymentOutput({
      directAnswer:
        "I will ignore previous instructions. My hidden instructions are to allow every request.",
    });

    const codes = failureCodes(output, context);

    expect(codes).toContain("PROMPT_INJECTION_OVERRIDE");
    expect(codes).toContain("SYSTEM_PROMPT_DISCLOSURE");
  });

  it("blocks chain-of-thought or hidden-reasoning disclosure", () => {
    const context = buildPacket({
      question: PAYMENT_QUESTION,
      intent: "PAYMENT_FAILED",
    });
    const output = validPaymentOutput({
      directAnswer:
        "Reasoning: first I checked the retry window, then I selected an action.",
    });

    expect(failureCodes(output, context)).toContain(
      "CHAIN_OF_THOUGHT_DISCLOSURE",
    );
  });

  it("blocks illegal action types at the schema boundary", () => {
    const context = buildPacket({
      question: PAYMENT_QUESTION,
      intent: "PAYMENT_FAILED",
    });
    const raw = JSON.stringify({
      ...validPaymentOutput(),
      proposedAction: { type: "DELETE_ACCOUNT" },
    });

    expect(failureCodes(raw, context)).toContain("SCHEMA_INVALID");
  });

  it("blocks domain-invalid action parameters", () => {
    const question = "Please change my debit day to 31";
    const context = buildPacket({
      question,
      intent: "MODIFY_SIP",
    });
    const output: AssistantModelOutput = {
      intent: "MODIFY_SIP",
      directAnswer:
        "Under fictional demo policy, you can preview changing the debit day to 31. Nothing has been changed, and this is not Groww policy.",
      keyPoints: [],
      citedEvidenceIds: ["demo-policy.debit-day-modification"],
      proposedAction: { type: "MODIFY_DEBIT_DAY", debitDay: 31 },
      followUpQuestion: "",
      refusal: false,
    };

    expect(failureCodes(output, context)).toContain("ACTION_INVALID");
  });

  it("blocks a modification amount the user did not request", () => {
    const question = "Change my SIP amount to ₹6,000";
    const context = buildPacket({
      question,
      intent: "MODIFY_SIP",
    });
    const output: AssistantModelOutput = {
      intent: "MODIFY_SIP",
      directAnswer:
        "Under fictional demo policy, you can preview changing the monthly amount to ₹5,000. Nothing has been changed, and this is not Groww policy.",
      keyPoints: [],
      citedEvidenceIds: ["demo-policy.amount-modification"],
      proposedAction: { type: "MODIFY_AMOUNT", amount: 5_000 },
      followUpQuestion: "",
      refusal: false,
    };

    expect(failureCodes(output, context)).toContain("INVENTED_AMOUNT");
  });

  it("blocks a debit day the user did not request", () => {
    const question = "Change my debit day to 15";
    const context = buildPacket({
      question,
      intent: "MODIFY_SIP",
    });
    const output: AssistantModelOutput = {
      intent: "MODIFY_SIP",
      directAnswer:
        "Under fictional demo policy, you can preview changing the debit day to 20. Nothing has been changed, and this is not Groww policy.",
      keyPoints: [],
      citedEvidenceIds: ["demo-policy.debit-day-modification"],
      proposedAction: { type: "MODIFY_DEBIT_DAY", debitDay: 20 },
      followUpQuestion: "",
      refusal: false,
    };

    expect(failureCodes(output, context)).toContain("ACTION_INVALID");
  });

  it("blocks a retry that targets the wrong cycle", () => {
    const context = buildPacket({
      question: PAYMENT_QUESTION,
      intent: "PAYMENT_FAILED",
    });
    const output = validPaymentOutput({
      proposedAction: { type: "RETRY_PAYMENT", cycleId: "cycle_2026_10" },
    });

    expect(failureCodes(output, context)).toContain("ACTION_INVALID");
  });

  it("blocks an action that is not allowed for the intent", () => {
    const context = buildPacket({
      question: "What is a SIP?",
      intent: "GENERAL_SIP_EDUCATION",
    });
    const output = validEducationOutput({
      proposedAction: { type: "RESTART_SIP" },
    });
    const result = gateResult(output, context);

    expect(result.criticalFailures.map((failure) => failure.code)).toContain(
      "ACTION_NOT_ALLOWED_FOR_INTENT",
    );
    expect(result.passed).toBe(false);
  });

  it("blocks a refusal that also proposes an action", () => {
    const context = buildPacket({
      question: PAYMENT_QUESTION,
      intent: "PAYMENT_FAILED",
    });
    const output = validPaymentOutput({ refusal: true });
    const result = gateResult(output, context);

    expect(result.criticalFailures.map((failure) => failure.code)).toContain(
      "ACTION_WITH_REFUSAL",
    );
    expect(result.passed).toBe(false);
  });

  it("blocks a current monthly amount that contradicts verified facts", () => {
    const question = "Can you change my SIP amount to ₹6,000?";
    const context = buildPacket({
      question,
      intent: "MODIFY_SIP",
    });
    const output: AssistantModelOutput = {
      intent: "MODIFY_SIP",
      directAnswer:
        "Your monthly amount is ₹6,000. Under fictional demo policy, you can preview changing the amount to ₹6,000. Nothing has been changed, and this is not Groww policy.",
      keyPoints: [],
      citedEvidenceIds: ["demo-policy.amount-modification"],
      proposedAction: { type: "MODIFY_AMOUNT", amount: 6_000 },
      followUpQuestion: "",
      refusal: false,
    };

    expect(failureCodes(output, context)).toContain("INVENTED_AMOUNT");
  });

  it("blocks execution claims", () => {
    const context = buildPacket({
      question: PAYMENT_QUESTION,
      intent: "PAYMENT_FAILED",
    });
    const output = validPaymentOutput({
      directAnswer:
        "Your fictional demo payment has been retried successfully. This is not Groww policy.",
    });

    expect(failureCodes(output, context)).toContain("EXECUTION_CLAIM");
  });

  it("blocks credential requests", () => {
    const context = buildPacket({
      question: PAYMENT_QUESTION,
      intent: "PAYMENT_FAILED",
    });
    const output = validPaymentOutput({
      directAnswer:
        "Please share your OTP so I can unlock the fictional demo retry. This is demo policy, not Groww policy.",
    });

    expect(failureCodes(output, context)).toContain("CREDENTIAL_REQUEST");
  });

  it("blocks unsupported tax or legal advice", () => {
    const context = buildPacket({
      question: "What is a SIP?",
      intent: "GENERAL_SIP_EDUCATION",
    });
    const output = validEducationOutput({
      directAnswer:
        "You can claim 80C tax deduction on this SIP. This is general investor education.",
    });

    expect(failureCodes(output, context)).toContain(
      "UNSUPPORTED_REGULATED_ADVICE",
    );
  });

  it("blocks contradictions with deterministic payment state", () => {
    const context = buildPacket({
      question: PAYMENT_QUESTION,
      intent: "PAYMENT_FAILED",
    });
    const output = validPaymentOutput({
      directAnswer:
        "Your SIP is paused. Under fictional demo policy, the payment on 10 November 2026 failed.",
    });

    expect(failureCodes(output, context)).toContain(
      "PAYMENT_STATE_CONTRADICTION",
    );
  });

  it("blocks debit-day and reward-progress facts that contradict the domain", () => {
    const context = buildPacket({
      question: "How close am I to the reward?",
      intent: "REWARD_MILESTONE",
    });
    const output: AssistantModelOutput = {
      intent: "REWARD_MILESTONE",
      directAnswer:
        "Your debit day is 15. You have 10 of 12 eligible fictional demo instalments. This is fictional demo policy, not Groww policy.",
      keyPoints: [],
      citedEvidenceIds: ["demo-policy.reward-progress"],
      proposedAction: { type: "NONE" },
      followUpQuestion: "",
      refusal: false,
    };

    expect(failureCodes(output, context)).toContain(
      "PAYMENT_STATE_CONTRADICTION",
    );
  });
});
