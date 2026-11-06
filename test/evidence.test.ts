import { describe, expect, it } from "vitest";
import { demoPolicy } from "@/lib/domain/policy";
import {
  ACCOUNT_SPECIFIC_UNAVAILABLE_MESSAGE,
  CitationScopeError,
  EVIDENCE_CORPUS_VERSION,
  INSUFFICIENT_EVIDENCE_MESSAGE,
  OFFICIAL_EVIDENCE_UNAVAILABLE_MESSAGE,
  assertCitationIdsInPacket,
  assertUniqueEvidenceIds,
  createCitationPacket,
  defaultEvidenceCorpus,
  getCitationSourceLabel,
  getSourceTierLabel,
  getVerificationLabel,
  loadEvidenceCorpusFromJsonl,
  parseEvidenceRecord,
  retrieveEvidence,
  validateCitationIds,
  validateEvidenceRecord,
  type EvidenceRecord,
  type EvidenceSourceTier,
} from "@/lib/evidence";

function recordById(id: string): EvidenceRecord {
  const record = defaultEvidenceCorpus.find((item) => item.id === id);

  if (!record) {
    throw new Error(`Missing test evidence record: ${id}`);
  }

  return record;
}

function countByTier(): Record<EvidenceSourceTier, number> {
  const counts: Record<EvidenceSourceTier, number> = {
    demo_policy: 0,
    general_education: 0,
    official_groww: 0,
  };

  for (const record of defaultEvidenceCorpus) {
    counts[record.sourceTier] += 1;
  }

  return counts;
}

describe("evidence corpus and schema", () => {
  it("1. validates the complete corpus schema and expected tier population", () => {
    expect(EVIDENCE_CORPUS_VERSION).toBe("evidence-corpus-v1.0.0");
    expect(defaultEvidenceCorpus).toHaveLength(19);
    expect(countByTier()).toEqual({
      demo_policy: 11,
      general_education: 8,
      official_groww: 0,
    });

    for (const record of defaultEvidenceCorpus) {
      expect(validateEvidenceRecord(record)).toEqual(record);
      expect(record.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(record.intents.length).toBeGreaterThan(0);
    }

    const demoRecords = defaultEvidenceCorpus.filter(
      (record) => record.sourceTier === "demo_policy",
    );
    const generalRecords = defaultEvidenceCorpus.filter(
      (record) => record.sourceTier === "general_education",
    );
    const officialRecords = defaultEvidenceCorpus.filter(
      (record) => record.sourceTier === "official_groww",
    );

    expect(demoRecords).toHaveLength(11);
    expect(generalRecords).toHaveLength(8);
    expect(officialRecords).toHaveLength(0);
    expect(
      demoRecords.every(
        (record) =>
          record.verificationStatus === "fictional_demo" &&
          record.text.toLowerCase().includes("fictional demonstration rule") &&
          record.text.toLowerCase().includes("not groww policy"),
      ),
    ).toBe(true);
    expect(
      generalRecords.every(
        (record) =>
          record.verificationStatus === "verified" &&
          record.verifiedAt === "2026-11-04",
      ),
    ).toBe(true);
    expect(JSON.stringify(defaultEvidenceCorpus)).not.toContain("{{");

    const retryWindow = recordById("demo-policy.retry-window");
    const retryAttempts = recordById("demo-policy.retry-attempt-limit");

    expect(retryWindow.applicableDemoPolicyVersion).toBe(demoPolicy.version);
    expect(retryWindow.text).toContain(String(demoPolicy.retryWindowDays));
    expect(retryAttempts.text).toContain(
      String(demoPolicy.maxRetryAttempts),
    );
  });

  it("2. rejects duplicate evidence IDs", () => {
    const record = recordById("general-education.sip-basics");
    const line = JSON.stringify(record);

    expect(() =>
      loadEvidenceCorpusFromJsonl(`${line}\n${line}`),
    ).toThrow(/Duplicate evidence ID/);
    expect(() => assertUniqueEvidenceIds([record, { ...record }])).toThrow(
      /Duplicate evidence IDs/,
    );
  });

  it("3. rejects malformed records, unknown fields and invalid JSON", () => {
    const record = recordById("general-education.sip-basics");

    expect(
      parseEvidenceRecord({ ...record, sourceTier: "made_up" }),
    ).toMatchObject({ success: false });
    expect(
      parseEvidenceRecord({ ...record, unexpectedField: "nope" }),
    ).toMatchObject({ success: false });
    expect(() => loadEvidenceCorpusFromJsonl("{not valid json}")).toThrow(
      /Invalid JSON/,
    );
    expect(() =>
      loadEvidenceCorpusFromJsonl(JSON.stringify({ ...record, id: "" })),
    ).toThrow(/Invalid evidence record/);
    expect(() =>
      validateEvidenceRecord({ ...record, text: "" }),
    ).toThrow(/text must be a non-empty string/);
  });
});

describe("deterministic evidence retrieval", () => {
  it("4. filters records by intent", () => {
    const result = retrieveEvidence(
      {
        question: "What happens when my SIP debit fails?",
        intent: "retry_payment",
      },
      { topK: 10 },
    );

    expect(result.status).toBe("OK");
    expect(result.matches.length).toBeGreaterThan(0);

    for (const match of result.matches) {
      expect(recordById(match.evidenceId).intents).toContain("retry_payment");
    }

    expect(result.evidenceIds).not.toContain(
      "general-education.market-volatility",
    );
  });

  it("5. filters records by requested source tier", () => {
    const generalOnly = retrieveEvidence({
      question: "What is a SIP?",
      intent: "sip_basics",
      requestedSourceTier: "general_education",
    });

    expect(generalOnly.status).toBe("OK");
    expect(generalOnly.matches.length).toBeGreaterThan(0);
    expect(
      generalOnly.matches.every(
        (match) => match.sourceTier === "general_education",
      ),
    ).toBe(true);

    const demoCannotAnswerGeneralIntent = retrieveEvidence({
      question: "What is a SIP?",
      intent: "sip_basics",
      requestedSourceTier: "demo_policy",
    });

    expect(demoCannotAnswerGeneralIntent.status).toBe("NO_EVIDENCE");
    expect(demoCannotAnswerGeneralIntent.noEvidenceReason).toBe(
      "NO_MATCHING_INTENT",
    );
    expect(demoCannotAnswerGeneralIntent.matches).toEqual([]);
  });

  it("6. retrieves retry evidence for a failed debit", () => {
    const result = retrieveEvidence({
      question: "What is the retry window after a failed debit?",
      intent: "retry_payment",
    });

    expect(result.status).toBe("OK");
    expect(result.evidenceIds).toContain("demo-policy.retry-window");

    const retryWindow = result.matches.find(
      (match) => match.evidenceId === "demo-policy.retry-window",
    );

    expect(retryWindow?.sourceTier).toBe("demo_policy");
    expect(retryWindow?.excerpt).toContain("7 calendar days");
  });

  it("7. retrieves market-volatility evidence", () => {
    const result = retrieveEvidence({
      question: "How does market volatility affect mutual fund NAV?",
      intent: "market_volatility",
    });

    expect(result.status).toBe("OK");
    expect(result.evidenceIds).toContain(
      "general-education.market-volatility",
    );
    expect(result.matches[0]?.sourceTier).toBe("general_education");
  });

  it("8. retrieves reward-progress evidence", () => {
    const result = retrieveEvidence(
      {
        question:
          "How many eligible instalments are needed for the reward milestone?",
        intent: "reward_progress",
      },
      { topK: 5 },
    );

    expect(result.status).toBe("OK");
    expect(result.evidenceIds).toContain("demo-policy.reward-progress");
    expect(result.evidenceIds).toContain(
      "demo-policy.successful-retry-reward",
    );
  });

  it("9. returns NO_EVIDENCE for an official query when the official corpus is empty", () => {
    const result = retrieveEvidence({
      question: "Is this the actual Groww policy?",
      intent: "official_groww_policy",
    });

    expect(result.status).toBe("NO_EVIDENCE");
    expect(result.noEvidenceReason).toBe("OFFICIAL_EVIDENCE_UNAVAILABLE");
    expect(result.message).toBe(OFFICIAL_EVIDENCE_UNAVAILABLE_MESSAGE);
    expect(result.officialPolicyQuery).toBe(true);
    expect(result.effectiveSourceTier).toBe("official_groww");
    expect(result.matches).toEqual([]);
    expect(result.evidenceIds).toEqual([]);
  });

  it("10. never lets demo-policy evidence satisfy an official Groww query", () => {
    const demoOnlyCorpus = defaultEvidenceCorpus.filter(
      (record) => record.sourceTier === "demo_policy",
    );
    const result = retrieveEvidence(
      {
        question: "Is this the actual Groww policy?",
        intent: "retry_payment",
        requestedSourceTier: "demo_policy",
      },
      { corpus: demoOnlyCorpus },
    );

    expect(result.status).toBe("NO_EVIDENCE");
    expect(result.noEvidenceReason).toBe("OFFICIAL_EVIDENCE_UNAVAILABLE");
    expect(result.message).toBe(OFFICIAL_EVIDENCE_UNAVAILABLE_MESSAGE);
    expect(result.matches).toEqual([]);
    expect(result.evidenceIds).toEqual([]);
  });

  it("11. prevents general education from satisfying account-specific questions", () => {
    const explicitIntent = retrieveEvidence({
      question: "What is the balance in my account?",
      intent: "account_specific",
      requestedSourceTier: "general_education",
    });
    const inferredFromWording = retrieveEvidence({
      question: "What is my account balance?",
      intent: "sip_basics",
      requestedSourceTier: "general_education",
    });
    const inferredWithoutTier = retrieveEvidence({
      question: "What is my account balance?",
      intent: "sip_basics",
    });

    for (const result of [
      explicitIntent,
      inferredFromWording,
      inferredWithoutTier,
    ]) {
      expect(result.status).toBe("NO_EVIDENCE");
      expect(result.noEvidenceReason).toBe("ACCOUNT_SPECIFIC_UNAVAILABLE");
      expect(result.message).toBe(ACCOUNT_SPECIFIC_UNAVAILABLE_MESSAGE);
      expect(result.matches).toEqual([]);
    }

    expect(getVerificationLabel("unverified")).toBe(
      "Unverified — do not present as verified",
    );
  });

  it("12. excludes unverified records and never labels them verified", () => {
    const baseRecord = recordById("general-education.sip-basics");
    const unverifiedRecord = validateEvidenceRecord({
      ...baseRecord,
      id: "general-education.unverified-fixture",
      verificationStatus: "unverified",
      verifiedAt: null,
    });
    const result = retrieveEvidence(
      {
        question: "What is a SIP?",
        intent: "sip_basics",
        requestedSourceTier: "general_education",
      },
      { corpus: [unverifiedRecord] },
    );

    expect(result.status).toBe("NO_EVIDENCE");
    expect(result.noEvidenceReason).toBe("UNVERIFIED_ONLY");
    expect(result.matches).toEqual([]);

    const packet = createCitationPacket(
      { question: "What is a SIP?", intent: "sip_basics" },
      [{ record: unverifiedRecord, score: 1, matchedTerms: ["sip"] }],
    );

    expect(packet.results[0]?.verificationStatus).toBe("unverified");
    expect(packet.results[0]?.verificationLabel).toBe(
      "Unverified — do not present as verified",
    );
  });
});

describe("citations and ranking", () => {
  it("13. requires citation IDs to exist in the retrieved packet", () => {
    const result = retrieveEvidence({
      question: "What is a SIP?",
      intent: "sip_basics",
      requestedSourceTier: "general_education",
    });
    const packet = {
      query: result.query,
      results: result.matches,
      evidenceIds: result.evidenceIds,
    };
    const packetId = result.evidenceIds[0];

    expect(packetId).toBeDefined();
    expect(validateCitationIds([packetId], packet)).toEqual({
      valid: true,
      invalidIds: [],
    });
    expect(validateCitationIds(["invented-evidence-id"], packet)).toEqual({
      valid: false,
      invalidIds: ["invented-evidence-id"],
    });
    expect(() =>
      assertCitationIdsInPacket(["invented-evidence-id"], packet),
    ).toThrow(CitationScopeError);
  });

  it("14. produces deterministic rankings across repeated calls and corpus order", () => {
    const query = {
      question: "What happens when my SIP debit fails?",
      intent: "retry_payment" as const,
    };
    const first = retrieveEvidence(query, { topK: 5 });
    const second = retrieveEvidence(query, { topK: 5 });
    const reversed = retrieveEvidence(query, {
      topK: 5,
      corpus: [...defaultEvidenceCorpus].reverse(),
    });
    const compact = (matches: typeof first.matches) =>
      matches.map((match) => [match.evidenceId, match.score]);

    expect(second.matches).toEqual(first.matches);
    expect(compact(reversed.matches)).toEqual(compact(first.matches));
  });

  it("15. breaks score ties by evidence ID ascending", () => {
    const baseRecord = recordById("demo-policy.retry-window");
    const makeTieRecord = (id: string) =>
      validateEvidenceRecord({
        ...baseRecord,
        id,
      });
    const tieZ = makeTieRecord("tie.zzz");
    const tieA = makeTieRecord("tie.aaa");
    const result = retrieveEvidence(
      {
        question: "retry window failed debit",
        intent: "retry_payment",
      },
      { corpus: [tieZ, tieA], topK: 2 },
    );

    expect(result.status).toBe("OK");
    expect(result.evidenceIds).toEqual(["tie.aaa", "tie.zzz"]);
    expect(result.matches[0]?.score).toBe(result.matches[1]?.score);
  });

  it("16. applies the minimum relevance threshold", () => {
    const result = retrieveEvidence(
      {
        question: "retry window failed debit",
        intent: "retry_payment",
      },
      { minScore: 100 },
    );

    expect(result.status).toBe("NO_EVIDENCE");
    expect(result.noEvidenceReason).toBe("BELOW_THRESHOLD");
    expect(result.message).toBe(INSUFFICIENT_EVIDENCE_MESSAGE);
    expect(result.matches).toEqual([]);
  });

  it("17. returns NO_EVIDENCE when no relevant evidence exists", () => {
    const result = retrieveEvidence(
      {
        question: "What is the capital of France?",
        intent: "sip_basics",
      },
      { topK: 5 },
    );

    expect(result.status).toBe("NO_EVIDENCE");
    expect(result.noEvidenceReason).toBe("BELOW_THRESHOLD");
    expect(result.message).toBe(INSUFFICIENT_EVIDENCE_MESSAGE);
    expect(result.evidenceIds).toEqual([]);
  });

  it("18. generates correct excerpts, source labels and verification labels", () => {
    const retryResult = retrieveEvidence({
      question: "What is the retry window after a failed debit?",
      intent: "retry_payment",
    });
    const retry = retryResult.matches.find(
      (match) => match.evidenceId === "demo-policy.retry-window",
    );

    expect(retry).toMatchObject({
      title: "Demo policy: retry window after a failed debit",
      sourceTier: "demo_policy",
      sourceLabel: "Demo policy — not Groww policy",
      verificationStatus: "fictional_demo",
      verificationLabel: "Fictional demo rule — not Groww policy",
      sourceUrl: null,
    });
    expect(retry?.score).toBeGreaterThan(0);
    expect(retry?.matchedTerms.length).toBeGreaterThan(0);
    expect(retry?.excerpt).toContain("7 calendar days");
    expect(retry?.excerpt).toContain("fictional demonstration rule");
    expect(retry?.excerpt).not.toContain("{{");

    const generalResult = retrieveEvidence({
      question: "How does market volatility affect mutual fund NAV?",
      intent: "market_volatility",
    });
    const general = generalResult.matches[0];

    expect(general?.sourceLabel).toBe(
      "General investor education — SEBI Investor Education",
    );
    expect(general?.verificationLabel).toBe("Verified source");
    expect(general?.sourceUrl).toBe(
      "https://investor.sebi.gov.in/securities-mf-investments.html",
    );
    expect(getSourceTierLabel("demo_policy")).toBe(
      "Demo policy — not Groww policy",
    );
    expect(getSourceTierLabel("general_education")).toBe(
      "General investor education",
    );
    expect(getSourceTierLabel("official_groww")).toBe(
      "Official Groww documentation",
    );
    expect(getVerificationLabel("verified")).toBe("Verified source");
    expect(getCitationSourceLabel(recordById("demo-policy.retry-window"))).toBe(
      "Demo policy — not Groww policy",
    );
  });
});
