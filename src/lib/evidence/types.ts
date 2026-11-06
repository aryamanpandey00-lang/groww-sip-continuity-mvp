export const EVIDENCE_SOURCE_TIERS = [
  "demo_policy",
  "general_education",
  "official_groww",
] as const;

export type EvidenceSourceTier = (typeof EVIDENCE_SOURCE_TIERS)[number];

export const EVIDENCE_INTENTS = [
  "retry_payment",
  "insufficient_funds",
  "retry_attempt_limit",
  "modify_sip_amount",
  "modify_debit_day",
  "restart_sip",
  "reward_progress",
  "missed_cycle",
  "successful_retry_reward",
  "action_confirmation",
  "simulated_action_disclaimer",
  "sip_basics",
  "market_volatility",
  "investment_risk",
  "guaranteed_returns",
  "long_term_investing",
  "sip_discipline",
  "investor_support",
  "sip_vs_lumpsum",
  "official_groww_policy",
  "account_specific",
] as const;

export type EvidenceIntent = (typeof EVIDENCE_INTENTS)[number];

export const EVIDENCE_VERIFICATION_STATUSES = [
  "verified",
  "unverified",
  "fictional_demo",
] as const;

export type EvidenceVerificationStatus =
  (typeof EVIDENCE_VERIFICATION_STATUSES)[number];

export interface EvidenceRecord {
  id: string;
  version: string;
  sourceTier: EvidenceSourceTier;
  intents: EvidenceIntent[];
  title: string;
  text: string;
  keywords: string[];
  sourceName: string;
  sourceUrl: string | null;
  sourceDate: string | null;
  verifiedAt: string | null;
  verificationStatus: EvidenceVerificationStatus;
  applicableDemoPolicyVersion: string | null;
}

export interface EvidenceQuery {
  question: string;
  intent: EvidenceIntent;
  requestedSourceTier?: EvidenceSourceTier | null;
}

export interface RetrievalOptions {
  corpus?: EvidenceRecord[];
  minScore?: number;
  topK?: number;
  includeUnverified?: boolean;
}

export type RetrievalStatus = "OK" | "NO_EVIDENCE";

export type NoEvidenceReason =
  | "EMPTY_QUERY"
  | "ACCOUNT_SPECIFIC_UNAVAILABLE"
  | "OFFICIAL_EVIDENCE_UNAVAILABLE"
  | "NO_MATCHING_INTENT"
  | "NO_TIER_MATCH"
  | "UNVERIFIED_ONLY"
  | "BELOW_THRESHOLD";

export interface CitationPacketItem {
  evidenceId: string;
  title: string;
  sourceTier: EvidenceSourceTier;
  sourceLabel: string;
  sourceName: string;
  excerpt: string;
  score: number;
  matchedTerms: string[];
  verificationStatus: EvidenceVerificationStatus;
  verificationLabel: string;
  sourceUrl: string | null;
  sourceDate: string | null;
  applicableDemoPolicyVersion: string | null;
}

export interface CitationPacket {
  query: EvidenceQuery;
  results: CitationPacketItem[];
  evidenceIds: string[];
}

export interface RetrievalResult {
  status: RetrievalStatus;
  query: EvidenceQuery;
  effectiveSourceTier: EvidenceSourceTier | null;
  officialPolicyQuery: boolean;
  matches: CitationPacketItem[];
  evidenceIds: string[];
  noEvidenceReason: NoEvidenceReason | null;
  message: string;
}

export interface ScoredEvidence {
  record: EvidenceRecord;
  score: number;
  matchedTerms: string[];
}

export interface CitationValidation {
  valid: boolean;
  invalidIds: string[];
}
