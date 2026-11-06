import { describe, expect, it } from "vitest";
import { demoPolicy } from "@/lib/domain/policy";
import {
  GOLDEN_CATEGORIES,
  GOLDEN_DATASET_VERSION,
  GOLDEN_SPLITS,
  GoldenDatasetValidationError,
  assertGoldenDatasetValid,
  isResolvedEvidenceLogReference,
  loadGoldenDataset,
  loadGoldenDatasetFromSource,
  parseGoldenCase,
  validateGoldenDataset,
  type GoldenCase,
} from "@/lib/evaluation";
import { EvaluationFileError } from "@/lib/evaluation/loader";
import { defaultEvidenceCorpus } from "@/lib/evidence";

const EXPECTED_SPLIT_COUNTS = { dev: 29, holdout: 12, adversarial: 7 } as const;
const REQUIRED_COVERAGE_CATEGORIES = [
  "insufficient_funds",
  "payment_failure",
  "retry",
  "retry_outside_window",
  "retry_attempt_limit",
  "market_volatility",
  "guaranteed_returns",
  "fund_recommendation",
  "amount_modification",
  "amount_boundary",
  "debit_day_modification",
  "debit_day_boundary",
  "restart",
  "reward_progress",
  "reward_unlock",
  "missed_cycle",
  "duplicate_retry",
  "official_policy",
  "account_specific",
  "missing_evidence",
  "citation_integrity",
  "demo_misattribution",
  "prompt_injection",
  "confirmation_bypass",
  "credential_request",
  "out_of_scope",
  "model_unavailable",
  "action_token_replay",
] as const;

const dataset = loadGoldenDataset();
const corpusById = new Map(
  defaultEvidenceCorpus.map((record) => [record.id, record]),
);

function caseById(id: string): GoldenCase {
  const item = dataset.cases.find((candidate) => candidate.id === id);

  if (!item) {
    throw new Error(`Missing test case: ${id}`);
  }

  return item;
}

function rawCaseById(id: string): Record<string, unknown> {
  return JSON.parse(JSON.stringify(caseById(id))) as Record<string, unknown>;
}

function cloneCase(id: string): GoldenCase {
  return JSON.parse(JSON.stringify(caseById(id))) as GoldenCase;
}

describe("golden dataset schema and validation", () => {
  it("1. validates the versioned dataset and exact split counts", () => {
    expect(dataset.validation.valid).toBe(true);
    expect(dataset.validation.errors).toEqual([]);
    expect(dataset.cases).toHaveLength(48);
    expect(dataset.validation.counts.bySplit).toEqual(EXPECTED_SPLIT_COUNTS);
    expect(
      Object.values(dataset.validation.counts.byCategory).reduce(
        (total, count) => total + count,
        0,
      ),
    ).toBe(48);
    expect(dataset.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("2. uses unique IDs, the declared dataset version and valid enum values", () => {
    const ids = new Set(dataset.cases.map((item) => item.id));
    expect(ids.size).toBe(dataset.cases.length);

    for (const item of dataset.cases) {
      expect(item.datasetVersion).toBe(GOLDEN_DATASET_VERSION);
      expect(GOLDEN_SPLITS).toContain(item.split);
      expect(GOLDEN_CATEGORIES).toContain(item.category);
      expect(item.expectedResponsePoints.length).toBeGreaterThan(0);
      expect(item.humanReferenceResponse.trim().length).toBeGreaterThan(0);
    }
  });

  it("3. covers every required behaviour category", () => {
    const categories = new Set(
      dataset.cases.map((item) => item.category as string),
    );

    for (const category of REQUIRED_COVERAGE_CATEGORIES) {
      expect(categories.has(category), `missing category ${category}`).toBe(
        true,
      );
    }
  });

  it("4. keeps review metadata honest and does not fabricate Evidence Log IDs", () => {
    for (const item of dataset.cases) {
      expect(item.reviewStatus).toBe("pending_human_review");
      expect(item.evidenceLogReference).toBeNull();
      expect(isResolvedEvidenceLogReference(item.evidenceLogReference)).toBe(
        false,
      );
    }
  });

  it("5. resolves every expected evidence ID against the evidence corpus", () => {
    for (const item of dataset.cases) {
      for (const evidenceId of item.expectedEvidenceIds) {
        expect(
          corpusById.has(evidenceId),
          `${item.id} references ${evidenceId}`,
        ).toBe(true);
      }
    }
  });

  it("6. preserves evidence tier and demo-policy attribution", () => {
    const retry = caseById("dev_retry_eligible_01");
    const volatility = caseById("dev_market_volatility_01");
    const guaranteed = caseById("adv_guaranteed_returns_01");
    const official = caseById("dev_official_policy_01");
    const accountSpecific = caseById("dev_account_specific_01");

    expect(retry.expectedEvidenceIds).toContain("demo-policy.retry-window");
    expect(volatility.expectedEvidenceIds).toContain(
      "general-education.market-volatility",
    );
    expect(guaranteed.expectedEvidenceIds).toContain(
      "general-education.no-guaranteed-returns",
    );
    expect(official.expectedEvidenceIds).toEqual([]);
    expect(accountSpecific.expectedEvidenceIds).toEqual([]);

    for (const evidenceId of retry.expectedEvidenceIds) {
      const record = corpusById.get(evidenceId);
      expect(record?.sourceTier).toBe("demo_policy");
      expect(record?.applicableDemoPolicyVersion).toBe(demoPolicy.version);
    }

    for (const evidenceId of volatility.expectedEvidenceIds) {
      expect(corpusById.get(evidenceId)?.sourceTier).toBe("general_education");
    }
  });

  it("7. rejects duplicate case IDs", () => {
    const first = rawCaseById("dev_insufficient_funds_01");
    const second = rawCaseById("dev_payment_failed_01");
    second.id = first.id;

    const validation = validateGoldenDataset([first, second], {
      expectedSplitCounts: { dev: 2, holdout: 0, adversarial: 0 },
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toContain(
      `Duplicate golden case ID: ${String(first.id)}`,
    );
  });

  it("8. rejects unknown evidence IDs", () => {
    const item = rawCaseById("dev_retry_eligible_01");
    item.expectedEvidenceIds = ["demo-policy.made-up-evidence"];
    const parsed = parseGoldenCase(item);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.errors.join(" ")).toContain(
        "Unknown expectedEvidenceId: demo-policy.made-up-evidence",
      );
    }
  });

  it("9. rejects evidence that does not support the expected intent or tier", () => {
    const item = rawCaseById("dev_sip_basics_01");
    item.expectedEvidenceIds = ["demo-policy.retry-window"];
    const parsed = parseGoldenCase(item);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const errors = parsed.errors.join(" ");
      expect(errors).toContain("does not support intent sip_basics");
      expect(errors).toContain("expected general_education");
    }
  });

  it("10. rejects invalid splits, categories, intents, severities and versions", () => {
    const invalidCases = [
      { ...rawCaseById("dev_retry_eligible_01"), split: "validation" },
      { ...rawCaseById("dev_retry_eligible_01"), category: "made_up" },
      { ...rawCaseById("dev_retry_eligible_01"), expectedIntent: "weather" },
      { ...rawCaseById("dev_retry_eligible_01"), severity: "urgent" },
      {
        ...rawCaseById("dev_retry_eligible_01"),
        datasetVersion: "golden-v0.0.0",
      },
    ];

    for (const item of invalidCases) {
      expect(parseGoldenCase(item).success).toBe(false);
    }
  });

  it("11. rejects a missing, blank or internally inconsistent reference response", () => {
    const missing = rawCaseById("dev_reward_progress_11_01");
    delete missing.humanReferenceResponse;
    expect(parseGoldenCase(missing).success).toBe(false);

    const blank = rawCaseById("dev_reward_progress_11_01");
    blank.humanReferenceResponse = "   ";
    expect(parseGoldenCase(blank).success).toBe(false);

    const missingPointTerm = rawCaseById("dev_reward_progress_11_01");
    missingPointTerm.humanReferenceResponse = "The reward is discussed elsewhere.";
    const parsed = parseGoldenCase(missingPointTerm);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.errors.join(" ")).toContain(
        "humanReferenceResponse is missing response-point term",
      );
    }
  });

  it("12. rejects a reference response that contains its own prohibited claim", () => {
    const item = rawCaseById("adv_guaranteed_returns_01");
    item.humanReferenceResponse =
      "Returns are guaranteed by this demo and I guarantee a 15% return.";
    const parsed = parseGoldenCase(item);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.errors.join(" ")).toContain(
        "humanReferenceResponse contains prohibited claim",
      );
    }
  });

  it("13. rejects inconsistent fallback expectations", () => {
    const fallbackWithoutReason = rawCaseById("dev_official_policy_01");
    fallbackWithoutReason.expectedFallbackReason = "NONE";
    expect(parseGoldenCase(fallbackWithoutReason).success).toBe(false);

    const reasonWithoutFallback = rawCaseById("dev_retry_eligible_01");
    reasonWithoutFallback.expectedFallbackReason = "SAFETY_REFUSAL";
    expect(parseGoldenCase(reasonWithoutFallback).success).toBe(false);

    const fallbackWithAction = rawCaseById("dev_retry_eligible_01");
    fallbackWithAction.expectedFallback = true;
    fallbackWithAction.expectedFallbackReason = "SAFETY_REFUSAL";
    const parsed = parseGoldenCase(fallbackWithAction);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.errors.join(" ")).toContain(
        "expectedAction must be NONE when expectedFallback is true",
      );
    }
  });

  it("14. requires fallback reasons to have empty evidence when evidence cannot answer", () => {
    const item = rawCaseById("dev_official_policy_01");
    item.expectedEvidenceIds = ["demo-policy.retry-window"];
    const parsed = parseGoldenCase(item);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.errors.join(" ")).toContain(
        "OFFICIAL_EVIDENCE_UNAVAILABLE requires expectedEvidenceIds to be empty",
      );
    }
  });

  it("15. rejects invalid action types and out-of-policy action parameters", () => {
    const invalidType = rawCaseById("dev_retry_eligible_01");
    invalidType.expectedAction = { type: "CANCEL_SIP" };
    expect(parseGoldenCase(invalidType).success).toBe(false);

    const lowAmount = rawCaseById("dev_amount_modification_01");
    lowAmount.expectedAction = { type: "MODIFY_AMOUNT", amount: 499 };
    expect(parseGoldenCase(lowAmount).success).toBe(false);

    const highAmount = rawCaseById("dev_amount_modification_01");
    highAmount.expectedAction = { type: "MODIFY_AMOUNT", amount: 25_001 };
    expect(parseGoldenCase(highAmount).success).toBe(false);

    const invalidDebitDay = rawCaseById("dev_debit_day_modification_01");
    invalidDebitDay.expectedAction = { type: "MODIFY_DEBIT_DAY", debitDay: 29 };
    expect(parseGoldenCase(invalidDebitDay).success).toBe(false);

    const missingCycle = rawCaseById("dev_retry_eligible_01");
    missingCycle.expectedAction = { type: "RETRY_PAYMENT" };
    expect(parseGoldenCase(missingCycle).success).toBe(false);
  });

  it("16. enforces Evidence Log references for human-reviewed cases", () => {
    const unreferenced = rawCaseById("dev_retry_eligible_01");
    unreferenced.reviewStatus = "human_reviewed";
    unreferenced.evidenceLogReference = null;
    expect(parseGoldenCase(unreferenced).success).toBe(false);

    const malformed = rawCaseById("dev_retry_eligible_01");
    malformed.evidenceLogReference = "evidence-log-1";
    expect(parseGoldenCase(malformed).success).toBe(false);

    const pending = rawCaseById("dev_retry_eligible_01");
    pending.evidenceLogReference = "pending";
    expect(parseGoldenCase(pending).success).toBe(true);

    // Test-only object. No Evidence Log ID is written to the golden dataset.
    const resolved = rawCaseById("dev_retry_eligible_01");
    resolved.reviewStatus = "human_reviewed";
    resolved.evidenceLogReference = "EVL-DEMO-0001";
    expect(parseGoldenCase(resolved).success).toBe(true);
  });

  it("17. rejects unknown fields and malformed response points", () => {
    const unknownField = rawCaseById("dev_retry_eligible_01");
    unknownField.unexpectedField = "nope";
    expect(parseGoldenCase(unknownField).success).toBe(false);

    const duplicatePoints = rawCaseById("dev_retry_eligible_01");
    const points = duplicatePoints.expectedResponsePoints as Array<
      Record<string, unknown>
    >;
    points.push({ ...points[0] });
    const parsed = parseGoldenCase(duplicatePoints);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.errors.join(" ")).toContain(
        "Duplicate expectedResponsePoints id",
      );
    }
  });

  it("18. reports malformed JSONL line numbers", () => {
    expect(() =>
      loadGoldenDatasetFromSource(
        '{"id":"one"}\n{not valid json}\n',
      ),
    ).toThrow(EvaluationFileError);

    try {
      loadGoldenDatasetFromSource('{"id":"one"}\n{not valid json}\n');
    } catch (error) {
      expect(String(error)).toContain("Invalid JSON on line 2");
    }
  });

  it("19. throws a typed validation error for an invalid dataset", () => {
    const invalid = loadGoldenDatasetFromSource(
      JSON.stringify({ ...rawCaseById("dev_retry_eligible_01"), split: "bad" }),
    );

    expect(invalid.validation.valid).toBe(false);
    expect(() => assertGoldenDatasetValid(invalid)).toThrow(
      GoldenDatasetValidationError,
    );
  });

  it("20. produces a deterministic dataset hash", () => {
    const second = loadGoldenDataset();
    expect(second.hash).toBe(dataset.hash);
    expect(assertGoldenDatasetValid(dataset)).toHaveLength(48);
    expect(cloneCase("dev_retry_eligible_01").id).toBe("dev_retry_eligible_01");
  });
});
