import {
  addMinutesToIsoTimestamp,
  compareIsoTimestamps,
  getDatePartFromIsoTimestamp,
  isValidIsoTimestamp,
} from "./date-utils";
import {
  applySipModification,
  previewSipModification,
  validateDebitDay,
  validateSipAmount,
} from "./modification-engine";
import { demoPolicy } from "./policy";
import { applySipRestart, previewSipRestart } from "./restart-engine";
import { getRewardProgress } from "./reward-engine";
import {
  getCycleById,
  getRetryDeadline,
  isRetryEligible,
} from "./sip-engine";
import { formatInr } from "@/lib/utils/format";
import type {
  ActionApplication,
  ActionConfirmation,
  ActionPreview,
  DemoInvestorState,
  RestartEligibilityReason,
  RetryEligibilityReason,
  SimulatedActionEvent,
  SimulatedActionRequest,
} from "./types";

function cloneActionRequest(
  request: SimulatedActionRequest,
): SimulatedActionRequest {
  return { ...request };
}

/**
 * Deterministic, non-cryptographic state fingerprint used only to detect a
 * changed demo state between preview and confirmation.
 */
export function getStateFingerprint(state: DemoInvestorState): string {
  return JSON.stringify({
    asOfDate: state.asOfDate,
    investorId: state.investor.id,
    sip: {
      id: state.sip.id,
      monthlyAmount: state.sip.monthlyAmount,
      debitDay: state.sip.debitDay,
      status: state.sip.status,
      pausedOn: state.sip.pausedOn,
      stoppedOn: state.sip.stoppedOn,
      restartedOn: state.sip.restartedOn,
      lastModifiedOn: state.sip.lastModifiedOn,
      cycles: state.sip.cycles.map((cycle) => [
        cycle.id,
        cycle.monthKey,
        cycle.scheduledDate,
        cycle.amount,
        cycle.status,
        cycle.paidOn,
        cycle.failedOn,
        cycle.failureReason,
        cycle.retryAttempts,
        cycle.source,
      ]),
    },
  });
}

function describeRetryReason(reason: RetryEligibilityReason): string {
  switch (reason) {
    case "CYCLE_NOT_FOUND":
      return "The scheduled cycle could not be found.";
    case "SIP_NOT_ACTIVE":
      return "The SIP is not active.";
    case "CYCLE_NOT_FAILED":
      return "This cycle is not awaiting a retry.";
    case "BEFORE_FAILED_DATE":
      return "The retry cannot be requested before the failed debit date.";
    case "WINDOW_EXPIRED":
      return "The 7-day retry window has closed.";
    case "ATTEMPT_LIMIT_REACHED":
      return "The maximum of 3 retry attempts has been reached.";
    case "ELIGIBLE":
      return "The cycle is eligible for a simulated retry.";
  }
}

function describeRestartReason(reason: RestartEligibilityReason): string {
  switch (reason) {
    case "SIP_ALREADY_ACTIVE":
      return "The SIP is already active.";
    case "MISSING_STOP_DATE":
      return "The pause or stop date is missing.";
    case "BEFORE_STOP_DATE":
      return "The restart cannot be requested before the pause or stop date.";
    case "WINDOW_EXPIRED":
      return "The 90-day restart window has closed.";
    case "ELIGIBLE":
      return "The SIP is eligible for a simulated restart.";
  }
}

function previewBase(
  state: DemoInvestorState,
  action: SimulatedActionRequest,
  now: string,
): Pick<
  ActionPreview,
  "action" | "createdAt" | "expiresAt" | "stateFingerprint"
> {
  return {
    action: cloneActionRequest(action),
    createdAt: now,
    expiresAt: addMinutesToIsoTimestamp(
      now,
      demoPolicy.actionPreviewTtlMinutes,
    ),
    stateFingerprint: getStateFingerprint(state),
  };
}

function blockedPreview(
  state: DemoInvestorState,
  action: SimulatedActionRequest,
  now: string,
  status: "NOT_ELIGIBLE" | "INVALID_PARAMS",
  errors: string[],
): ActionPreview {
  return {
    ...previewBase(state, action, now),
    status,
    eligibility: status,
    effects: [],
    errors,
    requiresConfirmation: false,
  };
}

function eligiblePreview(
  state: DemoInvestorState,
  action: SimulatedActionRequest,
  now: string,
  effects: string[],
): ActionPreview {
  return {
    ...previewBase(state, action, now),
    status: "PREVIEWED",
    eligibility: "ELIGIBLE",
    effects,
    errors: [],
    requiresConfirmation: true,
  };
}

function applyRetryToState(
  state: DemoInvestorState,
  cycleId: string,
  asOfDate: string,
): DemoInvestorState | null {
  const eligibility = isRetryEligible(state.sip, cycleId, asOfDate);
  const cycle = getCycleById(state.sip, cycleId);

  if (!eligibility.eligible || !cycle) {
    return null;
  }

  return {
    ...state,
    sip: {
      ...state.sip,
      cycles: state.sip.cycles.map((item) =>
        item.id === cycleId
          ? {
              ...item,
              status: "PAID",
              paidOn: asOfDate,
              failureReason: null,
              retryAttempts: item.retryAttempts + 1,
              source: "RETRY",
            }
          : item,
      ),
    },
  };
}

/**
 * Builds a preview only. It never mutates the supplied state.
 */
export function previewSimulatedAction(
  state: DemoInvestorState,
  request: SimulatedActionRequest,
  now: string = demoPolicy.demoNow,
): ActionPreview {
  if (!isValidIsoTimestamp(now)) {
    throw new Error(`Invalid action preview timestamp: ${now}`);
  }

  const asOfDate = getDatePartFromIsoTimestamp(now);
  const action = cloneActionRequest(request);

  switch (action.type) {
    case "RETRY_PAYMENT": {
      const cycle = getCycleById(state.sip, action.cycleId);

      if (!cycle) {
        return blockedPreview(
          state,
          action,
          now,
          "NOT_ELIGIBLE",
          [describeRetryReason("CYCLE_NOT_FOUND")],
        );
      }

      const eligibility = isRetryEligible(
        state.sip,
        action.cycleId,
        asOfDate,
      );

      if (!eligibility.eligible) {
        return blockedPreview(state, action, now, "NOT_ELIGIBLE", [
          describeRetryReason(eligibility.reason),
        ]);
      }

      const projectedState = applyRetryToState(
        state,
        action.cycleId,
        asOfDate,
      );

      if (!projectedState) {
        return blockedPreview(state, action, now, "NOT_ELIGIBLE", [
          "The retry could not be previewed for the current state.",
        ]);
      }

      const before = getRewardProgress(state.sip.cycles);
      const after = getRewardProgress(projectedState.sip.cycles);
      const attemptsRemaining = Math.max(0, eligibility.attemptsRemaining - 1);

      return eligiblePreview(state, action, now, [
        `Simulated retry for the ${formatInr(cycle.amount)} instalment scheduled on ${cycle.scheduledDate}.`,
        `Retry deadline: ${eligibility.deadline ?? getRetryDeadline(cycle.failedOn ?? asOfDate)}.`,
        `Reward progress moves from ${before.eligibleInstalments}/${before.targetInstalments} to ${after.eligibleInstalments}/${after.targetInstalments}.`,
        `${attemptsRemaining} simulated retry attempt${attemptsRemaining === 1 ? "" : "s"} would remain for this cycle.`,
        "No real payment will be made.",
      ]);
    }

    case "MODIFY_AMOUNT": {
      const errors = validateSipAmount(action.amount);

      if (errors.length > 0) {
        return blockedPreview(
          state,
          action,
          now,
          "INVALID_PARAMS",
          errors,
        );
      }

      const preview = previewSipModification(
        state.sip,
        { amount: action.amount },
        asOfDate,
      );

      if (preview.status !== "PREVIEWED") {
        return blockedPreview(
          state,
          action,
          now,
          "INVALID_PARAMS",
          preview.errors,
        );
      }

      const reward = getRewardProgress(state.sip.cycles);

      return eligiblePreview(state, action, now, [
        `Monthly amount would change from ${formatInr(preview.currentAmount)} to ${formatInr(action.amount)}.`,
        `Effective from ${preview.effectiveDate}.`,
        `Reward progress is preserved at ${reward.eligibleInstalments}/${reward.targetInstalments}.`,
        "No real SIP modification will be made.",
      ]);
    }

    case "MODIFY_DEBIT_DAY": {
      const errors = validateDebitDay(action.debitDay);

      if (errors.length > 0) {
        return blockedPreview(
          state,
          action,
          now,
          "INVALID_PARAMS",
          errors,
        );
      }

      const preview = previewSipModification(
        state.sip,
        { debitDay: action.debitDay },
        asOfDate,
      );

      if (preview.status !== "PREVIEWED") {
        return blockedPreview(
          state,
          action,
          now,
          "INVALID_PARAMS",
          preview.errors,
        );
      }

      const reward = getRewardProgress(state.sip.cycles);

      return eligiblePreview(state, action, now, [
        `Debit day would change from ${preview.currentDebitDay} to ${action.debitDay}.`,
        `Effective from ${preview.effectiveDate}.`,
        `Reward progress is preserved at ${reward.eligibleInstalments}/${reward.targetInstalments}.`,
        "No real SIP modification will be made.",
      ]);
    }

    case "RESTART_SIP": {
      const preview = previewSipRestart(state.sip, asOfDate);

      if (preview.status !== "PREVIEWED") {
        return blockedPreview(state, action, now, "NOT_ELIGIBLE", [
          describeRestartReason(preview.eligibility.reason),
        ]);
      }

      const reward = getRewardProgress(state.sip.cycles);

      return eligiblePreview(state, action, now, [
        `SIP would continue in the demo from ${asOfDate}.`,
        `Restart deadline: ${preview.eligibility.deadline}.`,
        `Reward progress is preserved at ${reward.eligibleInstalments}/${reward.targetInstalments}.`,
        "No real SIP restart will be made.",
      ]);
    }
  }
}

function buildEvent(
  type: SimulatedActionEvent["type"],
  state: DemoInvestorState,
  cycleId: string | null,
  confirmedAt: string,
  appliedOn: string,
  description: string,
  rewardProgressBefore: number,
  rewardProgressAfter: number,
  details: SimulatedActionEvent["details"],
): SimulatedActionEvent {
  return {
    id: `simulated_${type.toLowerCase()}_${state.sip.id}_${cycleId ?? "sip"}_${confirmedAt}`,
    type,
    sipId: state.sip.id,
    cycleId,
    confirmedAt,
    appliedOn,
    simulated: true,
    description,
    rewardProgressBefore,
    rewardProgressAfter,
    details,
  };
}

function applyActionToState(
  action: SimulatedActionRequest,
  state: DemoInvestorState,
  confirmedAt: string,
): { state: DemoInvestorState; event: SimulatedActionEvent } | null {
  const asOfDate = getDatePartFromIsoTimestamp(confirmedAt);
  const rewardBefore = getRewardProgress(state.sip.cycles);

  switch (action.type) {
    case "RETRY_PAYMENT": {
      const cycle = getCycleById(state.sip, action.cycleId);
      const nextState = applyRetryToState(state, action.cycleId, asOfDate);

      if (!cycle || !nextState) {
        return null;
      }

      const rewardAfter = getRewardProgress(nextState.sip.cycles);

      return {
        state: nextState,
        event: buildEvent(
          "RETRY_PAYMENT",
          state,
          cycle.id,
          confirmedAt,
          asOfDate,
          `Simulated retry applied for the ${cycle.scheduledDate} instalment.`,
          rewardBefore.eligibleInstalments,
          rewardAfter.eligibleInstalments,
          {
            scheduledDate: cycle.scheduledDate,
            amount: cycle.amount,
            attemptsBefore: cycle.retryAttempts,
            attemptsAfter: cycle.retryAttempts + 1,
          },
        ),
      };
    }

    case "MODIFY_AMOUNT": {
      const application = applySipModification(
        state.sip,
        { amount: action.amount },
        asOfDate,
        asOfDate,
      );

      if (!application.applied) {
        return null;
      }

      const nextState = { ...state, sip: application.sip };
      const rewardAfter = getRewardProgress(nextState.sip.cycles);

      return {
        state: nextState,
        event: buildEvent(
          "MODIFY_AMOUNT",
          state,
          null,
          confirmedAt,
          asOfDate,
          `Simulated monthly amount change applied from ${application.effectiveDate}.`,
          rewardBefore.eligibleInstalments,
          rewardAfter.eligibleInstalments,
          {
            previousAmount: state.sip.monthlyAmount,
            newAmount: action.amount,
            effectiveDate: application.effectiveDate,
          },
        ),
      };
    }

    case "MODIFY_DEBIT_DAY": {
      const application = applySipModification(
        state.sip,
        { debitDay: action.debitDay },
        asOfDate,
        asOfDate,
      );

      if (!application.applied) {
        return null;
      }

      const nextState = { ...state, sip: application.sip };
      const rewardAfter = getRewardProgress(nextState.sip.cycles);

      return {
        state: nextState,
        event: buildEvent(
          "MODIFY_DEBIT_DAY",
          state,
          null,
          confirmedAt,
          asOfDate,
          `Simulated debit-day change applied from ${application.effectiveDate}.`,
          rewardBefore.eligibleInstalments,
          rewardAfter.eligibleInstalments,
          {
            previousDebitDay: state.sip.debitDay,
            newDebitDay: action.debitDay,
            effectiveDate: application.effectiveDate,
          },
        ),
      };
    }

    case "RESTART_SIP": {
      const application = applySipRestart(state.sip, asOfDate);

      if (!application.applied) {
        return null;
      }

      const nextState = { ...state, sip: application.sip };
      const rewardAfter = getRewardProgress(nextState.sip.cycles);

      return {
        state: nextState,
        event: buildEvent(
          "RESTART_SIP",
          state,
          null,
          confirmedAt,
          asOfDate,
          `Simulated SIP restart applied on ${asOfDate}.`,
          rewardBefore.eligibleInstalments,
          rewardAfter.eligibleInstalments,
          {
            stoppedOn: application.eligibility.stoppedOn,
            deadline: application.eligibility.deadline,
            progressPreserved: true,
          },
        ),
      };
    }
  }
}

/**
 * Confirms a previewed action. Without `confirmed: true`, the result remains in
 * AWAITING_CONFIRMATION and no next state is produced.
 */
export function confirmSimulatedAction(
  preview: ActionPreview,
  currentState: DemoInvestorState,
  confirmation: { confirmed: boolean; confirmedAt: string },
): ActionConfirmation {
  if (preview.status !== "PREVIEWED") {
    return {
      status: preview.status,
      applied: false,
      nextState: null,
      event: null,
      message:
        preview.errors[0] ?? "The simulated action is not eligible.",
    };
  }

  if (!confirmation.confirmed) {
    return {
      status: "AWAITING_CONFIRMATION",
      applied: false,
      nextState: null,
      event: null,
      message:
        "The simulated action is waiting for explicit confirmation.",
    };
  }

  if (!isValidIsoTimestamp(confirmation.confirmedAt)) {
    return {
      status: "INVALID_PARAMS",
      applied: false,
      nextState: null,
      event: null,
      message: "The confirmation timestamp is invalid.",
    };
  }

  if (
    compareIsoTimestamps(confirmation.confirmedAt, preview.expiresAt) > 0
  ) {
    return {
      status: "TOKEN_EXPIRED",
      applied: false,
      nextState: null,
      event: null,
      message: "The simulated action preview has expired.",
    };
  }

  if (
    getStateFingerprint(currentState) !== preview.stateFingerprint ||
    preview.action === null
  ) {
    return {
      status: "STATE_CHANGED",
      applied: false,
      nextState: null,
      event: null,
      message:
        "The demo state changed after preview. Create a new preview.",
    };
  }

  const applied = applyActionToState(
    preview.action,
    currentState,
    confirmation.confirmedAt,
  );

  if (!applied) {
    return {
      status: "NOT_ELIGIBLE",
      applied: false,
      nextState: null,
      event: null,
      message:
        "The simulated action is no longer eligible for the current state.",
    };
  }

  return {
    status: "CONFIRMED_SIMULATED",
    applied: false,
    nextState: applied.state,
    event: applied.event,
    message:
      "Simulated action confirmed. Apply the confirmed transition to complete the demo.",
  };
}

/**
 * Applies a confirmed simulated transition. This is the only function that
 * exposes the next demo state, and it requires CONFIRMED_SIMULATED first.
 */
export function applyConfirmedAction(
  confirmation: ActionConfirmation,
): ActionApplication {
  if (
    confirmation.status !== "CONFIRMED_SIMULATED" ||
    !confirmation.nextState
  ) {
    return {
      status: confirmation.status,
      applied: false,
      state: null,
      event: null,
      message: confirmation.message,
    };
  }

  return {
    status: "APPLIED_SIMULATED",
    applied: true,
    state: confirmation.nextState,
    event: confirmation.event,
    message: "Simulated action applied. No real transaction occurred.",
  };
}
