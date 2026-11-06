import { describe, expect, it } from "vitest";
import {
  ASSISTANT_RESPONSE_JSON_SCHEMA,
  parseAssistantModelOutput,
} from "@/lib/ai/schemas";
import { validPaymentOutput } from "./fixtures";

describe("structured output schema", () => {
  it("uses a strict Responses API schema with all properties required", () => {
    expect(ASSISTANT_RESPONSE_JSON_SCHEMA.type).toBe("object");
    expect(ASSISTANT_RESPONSE_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(ASSISTANT_RESPONSE_JSON_SCHEMA.required).toEqual(
      expect.arrayContaining([
        "intent",
        "directAnswer",
        "keyPoints",
        "citedEvidenceIds",
        "proposedAction",
        "followUpQuestion",
        "refusal",
      ]),
    );
  });

  it("parses a valid structured response", () => {
    const result = parseAssistantModelOutput(
      JSON.stringify(validPaymentOutput()),
    );

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.output.intent).toBe("PAYMENT_FAILED");
      expect(result.output.proposedAction).toEqual({
        type: "RETRY_PAYMENT",
        cycleId: "cycle_2026_11",
      });
    }
  });

  it("rejects invalid JSON", () => {
    const result = parseAssistantModelOutput("not json");

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.issues.join(" ")).toContain("not valid JSON");
    }
  });

  it("rejects extra properties", () => {
    const result = parseAssistantModelOutput({
      ...validPaymentOutput(),
      chainOfThought: "hidden reasoning",
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.issues.join(" ")).toContain("Unexpected property");
    }
  });

  it("rejects unknown intents and illegal actions", () => {
    const unknownIntent = parseAssistantModelOutput({
      ...validPaymentOutput(),
      intent: "ALLOW_EVERYTHING",
    });
    const illegalAction = parseAssistantModelOutput({
      ...validPaymentOutput(),
      proposedAction: { type: "DELETE_ACCOUNT" },
    });

    expect(unknownIntent.success).toBe(false);
    expect(illegalAction.success).toBe(false);
  });

  it("rejects action parameters of the wrong type", () => {
    const result = parseAssistantModelOutput({
      ...validPaymentOutput(),
      proposedAction: { type: "MODIFY_AMOUNT", amount: "6000" },
    });

    expect(result.success).toBe(false);
  });

  it("rejects action values outside the strict JSON Schema bounds", () => {
    const fractionalAmount = parseAssistantModelOutput({
      ...validPaymentOutput(),
      proposedAction: { type: "MODIFY_AMOUNT", amount: 500.5 },
    });
    const unsafeAmount = parseAssistantModelOutput({
      ...validPaymentOutput(),
      proposedAction: { type: "MODIFY_AMOUNT", amount: Number.MAX_SAFE_INTEGER + 1 },
    });
    const invalidDebitDay = parseAssistantModelOutput({
      ...validPaymentOutput(),
      proposedAction: { type: "MODIFY_DEBIT_DAY", debitDay: 32 },
    });

    expect(fractionalAmount.success).toBe(false);
    expect(unsafeAmount.success).toBe(false);
    expect(invalidDebitDay.success).toBe(false);
  });

  it("rejects oversized raw model output before JSON parsing", () => {
    const result = parseAssistantModelOutput("x".repeat(64_001));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.join(" ")).toContain("exceeds 64000 characters");
    }
  });

  it("allows an empty follow-up question and rejects overlong text", () => {
    const emptyFollowUp = parseAssistantModelOutput({
      ...validPaymentOutput(),
      followUpQuestion: "",
    });
    const tooLong = parseAssistantModelOutput({
      ...validPaymentOutput(),
      directAnswer: "x".repeat(1_201),
    });

    expect(emptyFollowUp.success).toBe(true);
    expect(tooLong.success).toBe(false);
  });
});
