export type SipStatus = "ACTIVE" | "PAYMENT_FAILED" | "PAUSED" | "STOPPED";

export type SipLifecycleStatus = "ACTIVE" | "PAUSED" | "STOPPED";

export type PaymentStatus = "SUCCESS" | "FAILED";

export type SipCycleStatus = "PAID" | "FAILED" | "PENDING" | "MISSED";

export type InstalmentSource = "SCHEDULED" | "RETRY";

export interface DemoInvestor {
  id: string;
  displayName: string;
  initials: string;
}

export interface DemoPortfolio {
  totalValue: number;
  investedAmount: number;
  returnsAmount: number;
  returnsPercent: number;
}

export interface DemoPaymentAttempt {
  attemptedOn: string;
  status: PaymentStatus;
  reason: string;
}

export interface DemoSip {
  id: string;
  fundName: string;
  fundCategory: string;
  monthlyAmount: number;
  debitDay: number;
  nextInstalmentDate: string;
  status: SipStatus;
  statusLabel: string;
  lastPayment: DemoPaymentAttempt;
  retryBy: string;
}

export interface DemoReward {
  targetInstalments: number;
  eligibleInstalments: number;
  rewardLabel: string;
  rewardNote: string;
  isUnlocked: boolean;
}

export interface QuickAction {
  id: "mutual-funds" | "stocks" | "add-money" | "my-sips";
  label: string;
  description: string;
  href: string;
}

export interface DemoDashboard {
  asOfDate: string;
  investor: DemoInvestor;
  portfolio: DemoPortfolio;
  sip: DemoSip;
  reward: DemoReward;
  quickActions: QuickAction[];
  disclaimer: string;
}

export interface SipCycle {
  id: string;
  monthKey: string;
  scheduledDate: string;
  amount: number;
  status: SipCycleStatus;
  paidOn: string | null;
  failedOn: string | null;
  failureReason: string | null;
  retryAttempts: number;
  source: InstalmentSource | null;
}

export interface SipAccount {
  id: string;
  investorId: string;
  fundName: string;
  fundCategory: string;
  monthlyAmount: number;
  debitDay: number;
  startDate: string;
  status: SipLifecycleStatus;
  pausedOn: string | null;
  stoppedOn: string | null;
  restartedOn: string | null;
  lastModifiedOn: string | null;
  cycles: SipCycle[];
}

export interface DemoInvestorState {
  asOfDate: string;
  investor: DemoInvestor;
  sip: SipAccount;
}

export type RetryEligibilityReason =
  | "ELIGIBLE"
  | "CYCLE_NOT_FOUND"
  | "SIP_NOT_ACTIVE"
  | "CYCLE_NOT_FAILED"
  | "BEFORE_FAILED_DATE"
  | "WINDOW_EXPIRED"
  | "ATTEMPT_LIMIT_REACHED";

export interface RetryEligibility {
  eligible: boolean;
  reason: RetryEligibilityReason;
  failedOn: string | null;
  deadline: string | null;
  attemptsUsed: number;
  attemptsRemaining: number;
}

export type PaymentState =
  | "PAID"
  | "PENDING"
  | "FAILED_RETRY_AVAILABLE"
  | "FAILED_RETRY_EXHAUSTED"
  | "FAILED_WINDOW_EXPIRED"
  | "MISSED"
  | "SIP_INACTIVE"
  | "NOT_FOUND";

export interface SipDashboardSummary {
  status: SipStatus;
  statusLabel: string;
  lastPayment: DemoPaymentAttempt;
  retryBy: string | null;
  nextInstalmentDate: string | null;
}

export interface SipModificationRequest {
  amount?: number;
  debitDay?: number;
}

export interface SipModificationPreview {
  status: "PREVIEWED" | "INVALID_PARAMS";
  currentAmount: number;
  currentDebitDay: number;
  proposedAmount: number | null;
  proposedDebitDay: number | null;
  effectiveDate: string | null;
  changes: string[];
  errors: string[];
  requiresConfirmation: boolean;
}

export interface SipModificationApplication {
  applied: boolean;
  sip: SipAccount;
  effectiveDate: string | null;
  errors: string[];
}

export type RestartEligibilityReason =
  | "ELIGIBLE"
  | "SIP_ALREADY_ACTIVE"
  | "MISSING_STOP_DATE"
  | "BEFORE_STOP_DATE"
  | "WINDOW_EXPIRED";

export interface RestartEligibility {
  eligible: boolean;
  reason: RestartEligibilityReason;
  stoppedOn: string | null;
  deadline: string | null;
  daysRemaining: number | null;
}

export interface SipRestartPreview {
  status: "PREVIEWED" | "NOT_ELIGIBLE";
  eligibility: RestartEligibility;
  progressPreserved: boolean;
  requiresConfirmation: boolean;
}

export interface SipRestartApplication {
  applied: boolean;
  sip: SipAccount;
  eligibility: RestartEligibility;
  errors: string[];
}

export interface RewardProgress {
  eligibleInstalments: number;
  targetInstalments: number;
  remainingInstalments: number;
  isUnlocked: boolean;
  voucherLabel: string;
  voucherNote: string;
  policyLabel: string;
  simulated: true;
}

export type SimulatedActionType =
  | "RETRY_PAYMENT"
  | "MODIFY_AMOUNT"
  | "MODIFY_DEBIT_DAY"
  | "RESTART_SIP";

export type SimulatedActionRequest =
  | { type: "RETRY_PAYMENT"; cycleId: string }
  | { type: "MODIFY_AMOUNT"; amount: number }
  | { type: "MODIFY_DEBIT_DAY"; debitDay: number }
  | { type: "RESTART_SIP" };

export type ActionEligibility = "ELIGIBLE" | "NOT_ELIGIBLE" | "INVALID_PARAMS";

export type ActionBlockedStatus =
  | "NOT_ELIGIBLE"
  | "INVALID_PARAMS"
  | "STATE_CHANGED"
  | "TOKEN_EXPIRED";

export type ActionState =
  | "ELIGIBLE"
  | "PREVIEWED"
  | "AWAITING_CONFIRMATION"
  | "CONFIRMED_SIMULATED"
  | "APPLIED_SIMULATED"
  | ActionBlockedStatus;

export interface ActionPreview {
  status: "PREVIEWED" | "NOT_ELIGIBLE" | "INVALID_PARAMS";
  eligibility: ActionEligibility;
  action: SimulatedActionRequest | null;
  createdAt: string;
  expiresAt: string;
  stateFingerprint: string;
  effects: string[];
  errors: string[];
  requiresConfirmation: boolean;
}

export interface ActionConfirmation {
  status:
    | "AWAITING_CONFIRMATION"
    | "CONFIRMED_SIMULATED"
    | ActionBlockedStatus;
  applied: false;
  nextState: DemoInvestorState | null;
  event: SimulatedActionEvent | null;
  message: string;
}

export interface ActionApplication {
  status: "APPLIED_SIMULATED" | ActionConfirmation["status"];
  applied: boolean;
  state: DemoInvestorState | null;
  event: SimulatedActionEvent | null;
  message: string;
}

export interface SimulatedActionEvent {
  id: string;
  type: SimulatedActionType;
  sipId: string;
  cycleId: string | null;
  confirmedAt: string;
  appliedOn: string;
  simulated: true;
  description: string;
  rewardProgressBefore: number;
  rewardProgressAfter: number;
  details: Record<string, string | number | boolean | null>;
}
