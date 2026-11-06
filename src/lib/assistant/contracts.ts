import type {
  AssistantIntent,
  AssistantProblemCategory,
  AssistantQualityLabel,
  AssistantStatus,
} from "@/lib/ai/types";
import type { AssistantDemoScenario } from "@/lib/domain/fixtures/assistant-scenarios";
import type {
  EvidenceSourceTier,
  EvidenceVerificationStatus,
} from "@/lib/evidence/types";
import type { PublicActionPreview } from "./action-contracts";

export interface AssistantApiRequest {
  question: string;
  selectedCategory?: AssistantProblemCategory | null;
  demoScenario?: AssistantDemoScenario;
}

export interface AssistantApiCitation {
  evidenceId: string;
  title: string;
  sourceTier: EvidenceSourceTier;
  sourceLabel: string;
  sourceName: string;
  excerpt: string;
  verificationStatus: EvidenceVerificationStatus;
  verificationLabel: string;
  sourceUrl: string | null;
  sourceDate: string | null;
  applicableDemoPolicyVersion: string | null;
}

export interface AssistantApiResponse {
  requestId: string;
  status: AssistantStatus;
  intent: AssistantIntent;
  directAnswer: string;
  keyPoints: string[];
  followUpQuestion: string;
  qualityLabel: AssistantQualityLabel;
  fallbackUsed: boolean;
  citations: AssistantApiCitation[];
  actionPreview: PublicActionPreview | null;
  executionPerformed: false;
}

export const ASSISTANT_API_ERROR_CODES = [
  "INVALID_JSON",
  "INVALID_REQUEST",
  "UNSUPPORTED_MEDIA_TYPE",
  "PAYLOAD_TOO_LARGE",
  "ORIGIN_NOT_ALLOWED",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const;

export type AssistantApiErrorCode =
  (typeof ASSISTANT_API_ERROR_CODES)[number];

export interface AssistantApiErrorResponse {
  requestId: string;
  error: {
    code: AssistantApiErrorCode;
    message: string;
  };
}
