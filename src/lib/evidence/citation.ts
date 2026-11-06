import { tokenize } from "./scoring";
import type {
  CitationPacket,
  CitationPacketItem,
  CitationValidation,
  EvidenceQuery,
  EvidenceRecord,
  EvidenceSourceTier,
  EvidenceVerificationStatus,
  ScoredEvidence,
} from "./types";

const MAX_EXCERPT_LENGTH = 320;

export const SOURCE_TIER_LABELS: Record<EvidenceSourceTier, string> = {
  demo_policy: "Demo policy — not Groww policy",
  general_education: "General investor education",
  official_groww: "Official Groww documentation",
};

const VERIFICATION_LABELS: Record<EvidenceVerificationStatus, string> = {
  verified: "Verified source",
  unverified: "Unverified — do not present as verified",
  fictional_demo: "Fictional demo rule — not Groww policy",
};

export class CitationScopeError extends Error {
  readonly invalidIds: string[];

  constructor(invalidIds: string[]) {
    super(`Citation IDs are outside the retrieved packet: ${invalidIds.join(", ")}.`);
    this.name = "CitationScopeError";
    this.invalidIds = invalidIds;
  }
}

export function getSourceTierLabel(tier: EvidenceSourceTier): string {
  return SOURCE_TIER_LABELS[tier];
}

export function getVerificationLabel(
  status: EvidenceVerificationStatus,
): string {
  return VERIFICATION_LABELS[status];
}

export function getCitationSourceLabel(record: EvidenceRecord): string {
  const tierLabel = getSourceTierLabel(record.sourceTier);

  if (record.sourceTier === "demo_policy") {
    return tierLabel;
  }

  return `${tierLabel} — ${record.sourceName}`;
}

/**
 * Selects a short, deterministic excerpt. Short records are returned in full so
 * demo-policy disclaimers are never accidentally hidden.
 */
export function extractExcerpt(record: EvidenceRecord, question: string): string {
  const text = record.text.trim();

  if (text.length <= MAX_EXCERPT_LENGTH) {
    return text;
  }

  const queryTerms = new Set(tokenize(question));
  const sentences = text.match(/[^.!?]+[.!?]?/g) ?? [text];
  let bestSentence = sentences[0].trim();
  let bestScore = -1;

  for (const sentence of sentences) {
    const normalizedSentence = sentence.trim();

    if (normalizedSentence.length === 0) {
      continue;
    }

    const score = tokenize(normalizedSentence).filter((term) =>
      queryTerms.has(term),
    ).length;

    if (score > bestScore) {
      bestSentence = normalizedSentence;
      bestScore = score;
    }
  }

  if (bestSentence.length <= MAX_EXCERPT_LENGTH) {
    return bestSentence;
  }

  return `${bestSentence.slice(0, MAX_EXCERPT_LENGTH - 1).trimEnd()}…`;
}

export function toCitationPacketItem(
  scored: ScoredEvidence,
  question: string,
): CitationPacketItem {
  const { record, score, matchedTerms } = scored;

  return {
    evidenceId: record.id,
    title: record.title,
    sourceTier: record.sourceTier,
    sourceLabel: getCitationSourceLabel(record),
    sourceName: record.sourceName,
    excerpt: extractExcerpt(record, question),
    score,
    matchedTerms,
    verificationStatus: record.verificationStatus,
    verificationLabel: getVerificationLabel(record.verificationStatus),
    sourceUrl: record.sourceUrl,
    sourceDate: record.sourceDate,
    applicableDemoPolicyVersion: record.applicableDemoPolicyVersion,
  };
}

export function createCitationPacket(
  query: EvidenceQuery,
  matches: ScoredEvidence[],
): CitationPacket {
  const results = matches.map((match) =>
    toCitationPacketItem(match, query.question),
  );

  return {
    query,
    results,
    evidenceIds: results.map((result) => result.evidenceId),
  };
}

export function validateCitationIds(
  citedIds: string[],
  packet: CitationPacket,
): CitationValidation {
  const allowedIds = new Set(packet.evidenceIds);
  const invalidIds = [...new Set(citedIds)].filter(
    (id) => !allowedIds.has(id),
  );

  return {
    valid: invalidIds.length === 0,
    invalidIds,
  };
}

export function assertCitationIdsInPacket(
  citedIds: string[],
  packet: CitationPacket,
): void {
  const validation = validateCitationIds(citedIds, packet);

  if (!validation.valid) {
    throw new CitationScopeError(validation.invalidIds);
  }
}
