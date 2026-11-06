import { previewSimulatedAction } from "@/lib/domain/action-engine";
import { getRestartEligibility } from "@/lib/domain/restart-engine";
import { getRewardProgress } from "@/lib/domain/reward-engine";
import {
  getLatestFailedCycle,
  isRetryEligible,
} from "@/lib/domain/sip-engine";
import type {
  ActionPreview,
  DemoInvestorState,
  SimulatedActionRequest,
} from "@/lib/domain/types";
import type {
  DeterministicFinancialFacts,
  GoldenAction,
  GoldenFinancialFacts,
} from "./types";

export function toSimulatedAction(
  action: GoldenAction,
): SimulatedActionRequest | null {
  switch (action.type) {
    case "NONE":
      return null;
    case "RETRY_PAYMENT":
      return { type: "RETRY_PAYMENT", cycleId: action.cycleId };
    case "MODIFY_AMOUNT":
      return { type: "MODIFY_AMOUNT", amount: action.amount };
    case "MODIFY_DEBIT_DAY":
      return { type: "MODIFY_DEBIT_DAY", debitDay: action.debitDay };
    case "RESTART_SIP":
      return { type: "RESTART_SIP" };
  }
}

export function actionsEqual(left: GoldenAction, right: GoldenAction): boolean {
  if (left.type !== right.type) {
    return false;
  }

  switch (left.type) {
    case "NONE":
    case "RESTART_SIP":
      return true;
    case "RETRY_PAYMENT":
      return (
        right.type === "RETRY_PAYMENT" && left.cycleId === right.cycleId
      );
    case "MODIFY_AMOUNT":
      return right.type === "MODIFY_AMOUNT" && left.amount === right.amount;
    case "MODIFY_DEBIT_DAY":
      return (
        right.type === "MODIFY_DEBIT_DAY" && left.debitDay === right.debitDay
      );
  }
}

export function getDeterministicFinancialFacts(
  state: DemoInvestorState,
): DeterministicFinancialFacts {
  const failedCycle = getLatestFailedCycle(state.sip);
  const retry = failedCycle
    ? isRetryEligible(state.sip, failedCycle.id, state.asOfDate)
    : null;
  const reward = getRewardProgress(state.sip.cycles);
  const restart =
    state.sip.status === "ACTIVE"
      ? null
      : getRestartEligibility(state.sip, state.asOfDate);

  return {
    sipStatus: state.sip.status,
    monthlyAmount: state.sip.monthlyAmount,
    debitDay: state.sip.debitDay,
    retryEligible: retry?.eligible ?? null,
    retryDeadline: retry?.deadline ?? null,
    retryAttemptsUsed: retry?.attemptsUsed ?? null,
    retryAttemptsRemaining: retry?.attemptsRemaining ?? null,
    rewardEligibleInstalments: reward.eligibleInstalments,
    rewardTargetInstalments: reward.targetInstalments,
    rewardUnlocked: reward.isUnlocked,
    restartEligible: restart?.eligible ?? null,
    restartDeadline: restart?.deadline ?? null,
    restartDaysRemaining: restart?.daysRemaining ?? null,
  };
}

export function previewGoldenAction(
  state: DemoInvestorState,
  action: GoldenAction,
): ActionPreview | null {
  const request = toSimulatedAction(action);

  if (!request) {
    return null;
  }

  return previewSimulatedAction(
    state,
    request,
    `${state.asOfDate}T10:00:00.000Z`,
  );
}

export function compareFinancialFacts(
  claimed: GoldenFinancialFacts,
  expected: DeterministicFinancialFacts,
): string[] {
  const mismatches: string[] = [];

  for (const [key, value] of Object.entries(claimed)) {
    const expectedValue = expected[key as keyof DeterministicFinancialFacts];

    if (value !== expectedValue) {
      mismatches.push(
        `${key}: claimed ${JSON.stringify(value)}, expected ${JSON.stringify(expectedValue)}`,
      );
    }
  }

  return mismatches;
}
