import { describe, expect, it } from "vitest";
import {
  ASSISTANT_RESPONSE_JSON_SCHEMA,
  MAX_CITATIONS,
  MAX_KEY_POINTS,
  parseAssistantModelOutput,
} from "@/lib/ai/schemas";
import { validPaymentOutput } from "./fixtures";

describe("structured output schema", () => {
  it("uses a strict Chat Completions schema with required closed objects", () => {
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

    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (typeof value !== "object" || value === null) return;

      const schema = value as Record<string, unknown>;
      expect(schema).not.toHaveProperty("maxItems");
      if (schema.type === "object") {
        expect(schema.additionalProperties).toBe(false);
        const properties = schema.properties as Record<string, unknown>;
        expect([...((schema.required as string[]) ?? [])].sort()).toEqual(
          Object.keys(properties).sort(),
        );
      }
      Object.values(schema).forEach(visit);
    };

    visit(ASSISTANT_RESPONSE_JSON_SCHEMA);
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
      expect(result.validationDiagnostics).toEqual([
        { category: "invalid_json", fieldPath: "$" },
      ]);
    }
  });

  it("returns only allowlisted categories and paths for schema violations", () => {
    const untrustedPropertyName = "private_model_echo_field";
    const untrustedPropertyValue = "private model text";
    const result = parseAssistantModelOutput({
      ...validPaymentOutput(),
      [untrustedPropertyName]: untrustedPropertyValue,
      intent: "NOT_A_SUPPORTED_INTENT",
      proposedAction: "NONE",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.validationDiagnostics).toEqual(expect.arrayContaining([
        { category: "unexpected_field", fieldPath: "unknown" },
        { category: "invalid_enum", fieldPath: "intent" },
        { category: "invalid_type", fieldPath: "proposedAction" },
      ]));
      expect(JSON.stringify(result.validationDiagnostics)).not.toContain(
        untrustedPropertyName,
      );
      expect(JSON.stringify(result.validationDiagnostics)).not.toContain(
        untrustedPropertyValue,
      );
    }
  });

  it("classifies missing fields and oversized arrays without exposing values", () => {
    const withoutRefusal = Object.fromEntries(
      Object.entries(validPaymentOutput()).filter(([key]) => key !== "refusal"),
    );
    const result = parseAssistantModelOutput({
      ...withoutRefusal,
      keyPoints: Array.from({ length: MAX_KEY_POINTS + 1 }, () => "private point"),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.validationDiagnostics).toEqual(expect.arrayContaining([
        { category: "item_limit_exceeded", fieldPath: "keyPoints" },
        { category: "missing_field", fieldPath: "refusal" },
      ]));
      expect(JSON.stringify(result.validationDiagnostics)).not.toContain(
        "private point",
      );
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

  it("enforces array caps in the runtime parser after provider maxItems is omitted", () => {
    const tooManyKeyPoints = parseAssistantModelOutput({
      ...validPaymentOutput(),
      keyPoints: Array.from({ length: MAX_KEY_POINTS + 1 }, () => "supported point"),
    });
    const tooManyCitations = parseAssistantModelOutput({
      ...validPaymentOutput(),
      citedEvidenceIds: Array.from({
        length: MAX_CITATIONS + 1,
      }, (_, index) => `evidence-${index}`),
    });

    expect(tooManyKeyPoints.success).toBe(false);
    expect(tooManyCitations.success).toBe(false);
    if (!tooManyKeyPoints.success) {
      expect(tooManyKeyPoints.issues.join(" ")).toContain("keyPoints must contain at most");
    }
    if (!tooManyCitations.success) {
      expect(tooManyCitations.issues.join(" ")).toContain("citedEvidenceIds must contain at most");
    }
  });
});
