import type { AssistantDemoScenario } from "@/lib/domain/fixtures/assistant-scenarios";
import type {
  ActionEligibility,
  SimulatedActionType,
  SipLifecycleStatus,
} from "@/lib/domain/types";

export type PracticeActionInput =
  | { type: "RETRY_PAYMENT" }
  | { type: "MODIFY_AMOUNT"; amount: number }
  | { type: "MODIFY_DEBIT_DAY"; debitDay: number }
  | { type: "RESTART_SIP" };

export interface ActionPreviewRequest {
  scenario: AssistantDemoScenario;
  action: PracticeActionInput;
}

export interface ActionConfirmationRequest {
  previewId: string;
  confirmed: boolean;
}

export interface ActionResetRequest {
  scenario?: AssistantDemoScenario;
}

export type ActionPreviewSource =
  | "DETERMINISTIC_DEMO_PRACTICE"
  | "AI_APPROVED";

export interface PublicActionPreview {
  previewId: string | null;
  source: ActionPreviewSource;
  sourceLabel: string;
  scenario: AssistantDemoScenario;
  actionType: SimulatedActionType;
  actionTitle: string;
  sipContext: {
    label: "Fictional SIP — Demo only";
    fundName: string;
    monthlyAmount: number;
    debitDay: number;
    status: SipLifecycleStatus;
  };
  proposedChange: string | null;
  eligibility: ActionEligibility;
  effects: string[];
  errors: string[];
  expiresAt: string | null;
  requiresConfirmation: boolean;
}

export interface ActionPreviewResponse {
  requestId: string;
  status: "PREVIEWED" | "NOT_ELIGIBLE" | "INVALID_PARAMS";
  preview: PublicActionPreview;
}

export interface ActionStateSummary {
  scenario: AssistantDemoScenario;
  sip: {
    fundName: string;
    monthlyAmount: number;
    debitDay: number;
    status: SipLifecycleStatus;
  };
  rewardProgress: {
    eligibleInstalments: number;
    targetInstalments: number;
    isUnlocked: boolean;
  };
}

export interface ActionOperationResponse {
  requestId: string;
  status:
    | "CANCELLED"
    | "APPLIED_SIMULATED"
    | "NOT_ELIGIBLE"
    | "INVALID_PARAMS"
    | "PREVIEW_EXPIRED"
    | "STATE_CHANGED"
    | "PREVIEW_NOT_FOUND"
    | "RESET";
  message: string;
  stateSummary: ActionStateSummary;
  result: {
    actionType: SimulatedActionType;
    description: string;
    simulated: true;
    realPaymentMade: false;
    rewardProgressBefore: number;
    rewardProgressAfter: number;
  } | null;
}

export const ACTION_API_ERROR_CODES = [
  "INVALID_JSON",
  "INVALID_REQUEST",
  "UNSUPPORTED_MEDIA_TYPE",
  "PAYLOAD_TOO_LARGE",
  "ORIGIN_NOT_ALLOWED",
  "RATE_LIMITED",
  "ACTION_SESSION_UNAVAILABLE",
  "INVALID_SESSION",
  "SESSION_EXPIRED",
  "PREVIEW_NOT_FOUND",
  "CONFIRMATION_IN_PROGRESS",
  "INTERNAL_ERROR",
] as const;

export type ActionApiErrorCode = (typeof ACTION_API_ERROR_CODES)[number];

export interface ActionApiErrorResponse {
  requestId: string;
  error: {
    code: ActionApiErrorCode;
    message: string;
  };
}
