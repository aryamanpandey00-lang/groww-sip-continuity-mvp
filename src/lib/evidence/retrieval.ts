import { createCitationPacket } from "./citation";
import { defaultEvidenceCorpus } from "./loader";
import {
  DEFAULT_MIN_RELEVANCE_SCORE,
  normalizeText,
  rankDocuments,
} from "./scoring";
import type {
  EvidenceIntent,
  EvidenceQuery,
  EvidenceSourceTier,
  NoEvidenceReason,
  RetrievalOptions,
  RetrievalResult,
  ScoredEvidence,
} from "./types";

export const OFFICIAL_EVIDENCE_UNAVAILABLE_MESSAGE =
  "I don't have verified official Groww documentation for this question.";
export const ACCOUNT_SPECIFIC_UNAVAILABLE_MESSAGE =
  "I don't have verified account-specific evidence for this question.";
export const INSUFFICIENT_EVIDENCE_MESSAGE =
  "I don't have sufficient verified evidence to answer this question.";

const GENERAL_EDUCATION_INTENTS: ReadonlySet<EvidenceIntent> = new Set([
  "sip_basics",
  "market_volatility",
  "investment_risk",
  "guaranteed_returns",
  "long_term_investing",
  "sip_discipline",
  "investor_support",
  "sip_vs_lumpsum",
]);

export function isOfficialPolicyQuestion(
  question: string,
  intent: EvidenceIntent,
): boolean {
  if (intent === "official_groww_policy") {
    return true;
  }

  const normalized = normalizeText(question);
  const mentionsGroww = /\bgroww\b/.test(normalized);
  const mentionsPolicy = /\b(policy|policies)\b/.test(normalized);
  const asksForOfficial =
    /\b(actual|official|real|genuine)\b/.test(normalized) ||
    /\bis this\b/.test(normalized);

  return mentionsGroww && mentionsPolicy && asksForOfficial;
}

export function isAccountSpecificQuestion(question: string): boolean {
  const normalized = normalizeText(question);
  return /\b(my|personal)\s+(account|folio|sip|payment|instalment|bank|transaction)\b/.test(
    normalized,
  );
}

function noEvidenceResult(
  query: EvidenceQuery,
  effectiveSourceTier: EvidenceSourceTier | null,
  officialPolicyQuery: boolean,
  reason: NoEvidenceReason,
  message: string,
): RetrievalResult {
  return {
    status: "NO_EVIDENCE",
    query,
    effectiveSourceTier,
    officialPolicyQuery,
    matches: [],
    evidenceIds: [],
    noEvidenceReason: reason,
    message,
  };
}

function compareRankedEvidence(
  left: ScoredEvidence,
  right: ScoredEvidence,
): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (left.record.id < right.record.id) {
    return -1;
  }

  if (left.record.id > right.record.id) {
    return 1;
  }

  return 0;
}

/**
 * Deterministic lexical retrieval:
 * normalize → filter verification/intent/tier → BM25 score → rank → threshold.
 */
export function retrieveEvidence(
  query: EvidenceQuery,
  options: RetrievalOptions = {},
): RetrievalResult {
  const corpus = options.corpus ?? defaultEvidenceCorpus;
  const minScore = options.minScore ?? DEFAULT_MIN_RELEVANCE_SCORE;
  const topK = Math.max(1, Math.floor(options.topK ?? 3));
  const officialPolicyQuery = isOfficialPolicyQuestion(
    query.question,
    query.intent,
  );
  const effectiveSourceTier: EvidenceSourceTier | null = officialPolicyQuery
    ? "official_groww"
    : (query.requestedSourceTier ?? null);

  if (query.question.trim().length === 0) {
    return noEvidenceResult(
      query,
      effectiveSourceTier,
      officialPolicyQuery,
      "EMPTY_QUERY",
      INSUFFICIENT_EVIDENCE_MESSAGE,
    );
  }

  const accountSpecific =
    query.intent === "account_specific" ||
    ((effectiveSourceTier === "general_education" ||
      (effectiveSourceTier === null &&
        GENERAL_EDUCATION_INTENTS.has(query.intent))) &&
      isAccountSpecificQuestion(query.question));

  if (accountSpecific) {
    return noEvidenceResult(
      query,
      effectiveSourceTier,
      officialPolicyQuery,
      "ACCOUNT_SPECIFIC_UNAVAILABLE",
      ACCOUNT_SPECIFIC_UNAVAILABLE_MESSAGE,
    );
  }

  const verifiedCorpus = corpus.filter(
    (record) =>
      options.includeUnverified === true ||
      record.verificationStatus !== "unverified",
  );
  const unverifiedOnly =
    corpus.length > 0 && verifiedCorpus.length === 0;
  const tierFiltered = effectiveSourceTier
    ? verifiedCorpus.filter(
        (record) => record.sourceTier === effectiveSourceTier,
      )
    : verifiedCorpus;

  if (tierFiltered.length === 0) {
    if (
      officialPolicyQuery ||
      effectiveSourceTier === "official_groww"
    ) {
      return noEvidenceResult(
        query,
        effectiveSourceTier,
        officialPolicyQuery,
        "OFFICIAL_EVIDENCE_UNAVAILABLE",
        OFFICIAL_EVIDENCE_UNAVAILABLE_MESSAGE,
      );
    }

    if (unverifiedOnly) {
      return noEvidenceResult(
        query,
        effectiveSourceTier,
        officialPolicyQuery,
        "UNVERIFIED_ONLY",
        INSUFFICIENT_EVIDENCE_MESSAGE,
      );
    }

    return noEvidenceResult(
      query,
      effectiveSourceTier,
      officialPolicyQuery,
      "NO_TIER_MATCH",
      INSUFFICIENT_EVIDENCE_MESSAGE,
    );
  }

  const intentFiltered = tierFiltered.filter((record) =>
    record.intents.includes(query.intent),
  );

  if (intentFiltered.length === 0) {
    return noEvidenceResult(
      query,
      effectiveSourceTier,
      officialPolicyQuery,
      "NO_MATCHING_INTENT",
      INSUFFICIENT_EVIDENCE_MESSAGE,
    );
  }

  const ranking = new Map(
    rankDocuments(
      query.question,
      intentFiltered.map((record) => ({
        id: record.id,
        title: record.title,
        text: record.text,
        keywords: record.keywords,
      })),
    ).map((result) => [result.id, result]),
  );
  const scored: ScoredEvidence[] = intentFiltered.map((record) => {
    const result = ranking.get(record.id);

    return {
      record,
      score: result?.score ?? 0,
      matchedTerms: result?.matchedTerms ?? [],
    };
  });
  const matches = scored
    .filter((match) => match.score > 0 && match.score >= minScore)
    .sort(compareRankedEvidence)
    .slice(0, topK);

  if (matches.length === 0) {
    if (
      officialPolicyQuery ||
      effectiveSourceTier === "official_groww"
    ) {
      return noEvidenceResult(
        query,
        effectiveSourceTier,
        officialPolicyQuery,
        "OFFICIAL_EVIDENCE_UNAVAILABLE",
        OFFICIAL_EVIDENCE_UNAVAILABLE_MESSAGE,
      );
    }

    return noEvidenceResult(
      query,
      effectiveSourceTier,
      officialPolicyQuery,
      "BELOW_THRESHOLD",
      INSUFFICIENT_EVIDENCE_MESSAGE,
    );
  }

  const packet = createCitationPacket(query, matches);

  return {
    status: "OK",
    query,
    effectiveSourceTier,
    officialPolicyQuery,
    matches: packet.results,
    evidenceIds: packet.evidenceIds,
    noEvidenceReason: null,
    message: officialPolicyQuery
      ? "Retrieved verified official Groww documentation only."
      : "Retrieved evidence matching the query.",
  };
}
