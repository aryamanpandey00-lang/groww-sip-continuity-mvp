import type {
  DemoInvestorState,
  SimulatedActionType,
} from "@/lib/domain/types";
import type {
  EvidenceSourceTier,
  NoEvidenceReason,
  RetrievalStatus,
} from "@/lib/evidence";
import type {
  DeterministicFinancialFacts,
  GoldenFallbackReason,
} from "@/lib/evaluation";

/**
 * Server-side assistant intents. These are intentionally broader than the
 * evidence-retrieval intents because user-facing safety and scope questions do
 * not always need to retrieve a document.
 */
export const ASSISTANT_INTENTS = [
  "INSUFFICIENT_FUNDS",
  "PAYMENT_FAILED",
  "MARKET_UNCERTAINTY",
  "MODIFY_SIP",
  "RESTART_SIP",
  "REWARD_MILESTONE",
  "GENERAL_SIP_EDUCATION",
  "OFFICIAL_GROWW_POLICY",
  "ACCOUNT_SPECIFIC",
  "GUARANTEED_RETURN_REQUEST",
  "FUND_RECOMMENDATION_REQUEST",
  "OUT_OF_SCOPE",
  "PROMPT_INJECTION",
  "INSUFFICIENT_EVIDENCE",
] as const;

export type AssistantIntent = (typeof ASSISTANT_INTENTS)[number];

/**
 * Categories currently exposed by the assistant entry experience. A selected
 * category is only initial context; deterministic safety classification can
 * always override it.
 */
export const ASSISTANT_PROBLEM_CATEGORIES = [
  "INSUFFICIENT_FUNDS",
  "PAYMENT_FAILED",
  "MARKET_UNCERTAINTY",
  "MODIFY_SIP",
  "RESTART_SIP",
  "REWARD_MILESTONE",
] as const;

export type AssistantProblemCategory =
  (typeof ASSISTANT_PROBLEM_CATEGORIES)[number];

export const ASSISTANT_ACTION_TYPES = [
  "NONE",
  "RETRY_PAYMENT",
  "MODIFY_AMOUNT",
  "MODIFY_DEBIT_DAY",
  "RESTART_SIP",
] as const;

export type AssistantActionType = (typeof ASSISTANT_ACTION_TYPES)[number];
export type AssistantExecutableActionType = Exclude<
  SimulatedActionType,
  never
>;

export type AssistantProposedAction =
  | { type: "NONE" }
  | { type: "RETRY_PAYMENT"; cycleId: string }
  | { type: "MODIFY_AMOUNT"; amount: number }
  | { type: "MODIFY_DEBIT_DAY"; debitDay: number }
  | { type: "RESTART_SIP" };

export const ASSISTANT_QUALITY_LABELS = [
  "Evidence-backed",
  "Limited evidence",
  "Safety guidance",
  "Need more information",
  "Safe fallback",
  "Assistant unavailable",
] as const;

export type AssistantQualityLabel =
  (typeof ASSISTANT_QUALITY_LABELS)[number];

export const ASSISTANT_STATUSES = [
  "APPROVED",
  "NEEDS_MORE_INFORMATION",
  "SAFE_FALLBACK",
  "UNAVAILABLE",
] as const;

export type AssistantStatus = (typeof ASSISTANT_STATUSES)[number];

/**
 * Runtime fallback reasons are diagnostic and server-only. The Phase 4
 * evaluation contracts use a narrower set, exposed separately as
 * `evaluationFallbackReason`.
 */
export const ASSISTANT_FALLBACK_REASONS = [
  "NONE",
  "ASSISTANT_DISABLED",
  "MISSING_CONFIG",
  "INPUT_INVALID",
  "MISSING_INFORMATION",
  "OFFICIAL_EVIDENCE_UNAVAILABLE",
  "ACCOUNT_SPECIFIC_UNAVAILABLE",
  "INSUFFICIENT_EVIDENCE",
  "MODEL_UNAVAILABLE",
  "MODEL_TIMEOUT",
  "MODEL_INVALID_OUTPUT",
  "SAFETY_REFUSAL",
  "CONFIRMATION_REQUIRED",
  "ACTION_NOT_ELIGIBLE",
  "CITATION_SCOPE_VIOLATION",
  "GATE_FAILED",
  "REPAIR_FAILED",
] as const;

export type AssistantFallbackReason =
  (typeof ASSISTANT_FALLBACK_REASONS)[number];

export interface AssistantConfig {
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  maxInputChars: number;
}

export type AssistantConfigUnavailableReason =
  | "ASSISTANT_DISABLED"
  | "MISSING_API_KEY"
  | "MISSING_MODEL"
  | "INVALID_MAX_OUTPUT_TOKENS";

export type AssistantConfigResolution =
  | { status: "READY"; config: AssistantConfig }
  | {
      status: "UNAVAILABLE";
      reason: AssistantConfigUnavailableReason;
      fallbackReason: AssistantFallbackReason;
    };

export interface AssistantModelOutput {
  intent: AssistantIntent;
  directAnswer: string;
  keyPoints: string[];
  citedEvidenceIds: string[];
  proposedAction: AssistantProposedAction;
  followUpQuestion: string;
  refusal: boolean;
}

export interface AssistantModelRequest {
  instructions: string;
  input: string;
}

export interface AssistantTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type AssistantModelCallResult =
  | {
      status: "OK";
      outputText: string;
      modelId?: string;
      usage?: AssistantTokenUsage;
    }
  | { status: "TIMEOUT"; errorCode?: string; usage?: AssistantTokenUsage }
  | { status: "UNAVAILABLE"; errorCode?: string; usage?: AssistantTokenUsage }
  | { status: "INVALID_OUTPUT"; errorCode?: string; usage?: AssistantTokenUsage };

export interface AssistantTokenBudgetReservation {
  /** Settle with reported usage, or null to charge the full reservation. */
  settle(actualTokens: number | null): Promise<void> | void;
}

export interface AssistantTokenBudgetCoordinator {
  /** Production adapters must declare a deployment-wide atomic scope. */
  scope: "deployment-shared" | "process-local";
  /** Production reservations must be atomic across the whole deployment. */
  reserve(input: {
    reservationId: string;
    maxTokens: number;
    nowMs: number;
  }): Promise<AssistantTokenBudgetReservation | null> | AssistantTokenBudgetReservation | null;
}

export interface AssistantModelClient {
  respond(request: AssistantModelRequest): Promise<AssistantModelCallResult>;
}

export interface VerifiedSipFacts extends DeterministicFinancialFacts {
  asOfDate: string;
  nextInstalmentDate: string | null;
  failedCycleId: string | null;
  failedOn: string | null;
  failureReason: string | null;
  latestPaymentStatus: "SUCCESS" | "FAILED" | null;
  latestPaymentDate: string | null;
  rewardRemainingInstalments: number;
  voucherLabel: string;
  voucherNote: string;
  policyVersion: string;
  policyLabel: string;
}

export interface AssistantEvidenceItem {
  evidenceId: string;
  title: string;
  sourceTier: EvidenceSourceTier;
  sourceLabel: string;
  sourceName: string;
  excerpt: string;
  score: number;
  matchedTerms: string[];
  verificationStatus:
    | "verified"
    | "unverified"
    | "fictional_demo";
  verificationLabel: string;
  sourceUrl: string | null;
  sourceDate: string | null;
  applicableDemoPolicyVersion: string | null;
}

export interface AssistantEvidenceContext {
  retrievalStatus: RetrievalStatus;
  effectiveSourceTier: EvidenceSourceTier | null;
  noEvidenceReason: NoEvidenceReason | null;
  evidenceIds: string[];
  items: AssistantEvidenceItem[];
  message: string;
}

export interface AssistantContextPacket {
  question: string;
  selectedCategory: AssistantProblemCategory | null;
  intent: AssistantIntent;
  evidenceIntent: string | null;
  facts: VerifiedSipFacts;
  evidence: AssistantEvidenceContext;
  allowedAmounts: number[];
  allowedDates: string[];
  requestedAmounts: number[];
  requestedDebitDays: number[];
  allowedActionTypes: AssistantActionType[];
  requiresCitations: boolean;
  demoTierAvailable: boolean;
  createdAt: string;
}

export const RUNTIME_GATE_FAILURE_CODES = [
  "SCHEMA_INVALID",
  "INTENT_MISMATCH",
  "CITATION_SCOPE_VIOLATION",
  "DUPLICATE_CITATION",
  "MISSING_CITATIONS",
  "MISSING_REQUIRED_CITATION_TIER",
  "DEMO_POLICY_MISATTRIBUTION",
  "ACCOUNT_SPECIFIC_UNSUPPORTED",
  "INVENTED_AMOUNT",
  "INVENTED_DATE",
  "PAYMENT_STATE_CONTRADICTION",
  "EXECUTION_CLAIM",
  "ACTION_NOT_ALLOWED_FOR_INTENT",
  "ACTION_INVALID",
  "ACTION_WITH_REFUSAL",
  "GUARANTEED_RETURN_CLAIM",
  "FUND_RECOMMENDATION",
  "UNSUPPORTED_REGULATED_ADVICE",
  "CREDENTIAL_REQUEST",
  "PROMPT_INJECTION_OVERRIDE",
  "SYSTEM_PROMPT_DISCLOSURE",
  "CHAIN_OF_THOUGHT_DISCLOSURE",
] as const;

export type RuntimeGateFailureCode =
  (typeof RUNTIME_GATE_FAILURE_CODES)[number];

export interface RuntimeGateFailure {
  code: RuntimeGateFailureCode;
  message: string;
  repairable: boolean;
}

export interface RuntimeGateResult {
  passed: boolean;
  criticalFailures: RuntimeGateFailure[];
  checkedAt: string;
  qualityLabel: AssistantQualityLabel | null;
}

export interface RuntimeGateEvaluation {
  result: RuntimeGateResult;
  output: AssistantModelOutput | null;
}

export interface AssistantRequest {
  question: string;
  selectedCategory?: AssistantProblemCategory | null;
  /**
   * Deterministic domain state to read. The pipeline never mutates or applies
   * an action to this state.
   */
  state?: DemoInvestorState;
}

export interface AssistantModelDiagnostics {
  modelId: string | null;
  latencyMs: number;
  usage: AssistantTokenUsage | null;
  modelCalls: number;
  usageComplete: boolean;
}

export interface AssistantResult {
  requestId: string;
  status: AssistantStatus;
  intent: AssistantIntent;
  directAnswer: string;
  keyPoints: string[];
  citedEvidenceIds: string[];
  proposedAction: AssistantProposedAction;
  followUpQuestion: string;
  refusal: boolean;
  qualityLabel: AssistantQualityLabel;
  fallbackReason: AssistantFallbackReason;
  evaluationFallbackReason: GoldenFallbackReason;
  fallbackUsed: boolean;
  repairAttempted: boolean;
  repairSucceeded: boolean;
  gateResult: RuntimeGateResult | null;
  retrievedEvidenceIds: string[];
  /** Trusted retrieval packet items retained for safe citation presentation. */
  retrievedEvidenceItems: AssistantEvidenceItem[];
  model: AssistantModelDiagnostics | null;
  /** Runtime actions are previews only; this is always false. */
  executionPerformed: false;
  generatedAt: string;
}

export interface AssistantLogEvent {
  requestId: string;
  intent: AssistantIntent;
  retrievedEvidenceIds: string[];
  gatePassed: boolean | null;
  gateFailureCodes: RuntimeGateFailureCode[];
  fallbackReason: AssistantFallbackReason;
  qualityLabel: AssistantQualityLabel;
  modelId: string | null;
  latencyMs: number;
  tokenUsage: AssistantTokenUsage | null;
  modelCalls: number;
  tokenUsageComplete: boolean;
  repairAttempted: boolean;
  timestamp: string;
}

export type AssistantLogSink = (event: AssistantLogEvent) => void;

export interface AssistantDependencies {
  env?: Record<string, string | undefined>;
  config?: AssistantConfig;
  modelClient?: AssistantModelClient;
  budgetCoordinator?: AssistantTokenBudgetCoordinator;
  log?: AssistantLogSink;
  requestId?: string;
  now?: () => Date;
}

export interface MissingInformationDecision {
  required: boolean;
  question: string | null;
  code:
    | "NONE"
    | "EMPTY_QUESTION"
    | "TOO_VAGUE"
    | "MODIFY_TARGET"
    | "MODIFY_AMOUNT"
    | "MODIFY_DAY";
}
