import {
  addCalendarDays,
  compareDateOnly,
  getNextScheduledDate,
} from "./date-utils";
import { demoPolicy } from "./policy";
import type {
  DemoPaymentAttempt,
  PaymentState,
  RetryEligibility,
  RetryEligibilityReason,
  SipAccount,
  SipCycle,
  SipDashboardSummary,
} from "./types";

export interface PaymentStateValidation {
  state: PaymentState;
  retry: RetryEligibility;
}

export function getCycleById(
  sip: SipAccount,
  cycleId: string,
): SipCycle | undefined {
  return sip.cycles.find((cycle) => cycle.id === cycleId);
}

export function isCyclePaid(cycle: SipCycle): boolean {
  return cycle.status === "PAID";
}

export function isCycleFailed(cycle: SipCycle): boolean {
  return cycle.status === "FAILED";
}

function sortCyclesByScheduledDate(cycles: SipCycle[]): SipCycle[] {
  return [...cycles].sort((left, right) =>
    compareDateOnly(left.scheduledDate, right.scheduledDate),
  );
}

export function getLatestPaymentCycle(
  sip: SipAccount,
): SipCycle | undefined {
  return sortCyclesByScheduledDate(sip.cycles).at(-1);
}

export function getLatestFailedCycle(
  sip: SipAccount,
): SipCycle | undefined {
  return sortCyclesByScheduledDate(
    sip.cycles.filter((cycle) => cycle.status === "FAILED"),
  ).at(-1);
}

/**
 * Returns the next scheduled debit strictly after `fromDate`.
 * Paused or stopped SIPs do not have a next instalment.
 */
export function getNextInstalmentDate(
  sip: SipAccount,
  fromDate: string,
): string | null {
  if (sip.status !== "ACTIVE") {
    return null;
  }

  return getNextScheduledDate(sip.debitDay, fromDate);
}

export function getRetryDeadline(failedOn: string): string {
  return addCalendarDays(failedOn, demoPolicy.retryWindowDays);
}

export function getRetryAttemptsRemaining(cycle: SipCycle): number {
  return Math.max(0, demoPolicy.maxRetryAttempts - cycle.retryAttempts);
}

function retryResult(
  reason: RetryEligibilityReason,
  cycle: SipCycle | undefined,
  eligible = false,
): RetryEligibility {
  const failedOn = cycle?.failedOn ?? null;
  const attemptsUsed = cycle?.retryAttempts ?? 0;

  return {
    eligible,
    reason,
    failedOn,
    deadline: failedOn ? getRetryDeadline(failedOn) : null,
    attemptsUsed,
    attemptsRemaining: cycle
      ? getRetryAttemptsRemaining(cycle)
      : demoPolicy.maxRetryAttempts,
  };
}

/**
 * Validates retry eligibility for a scheduled cycle.
 *
 * The retry window is inclusive: the failure date and the seventh calendar day
 * after it are both eligible. Each cycle can use at most three retry attempts,
 * and only the first successful retry can resolve the cycle.
 */
export function isRetryEligible(
  sip: SipAccount,
  cycleId: string,
  asOfDate: string,
): RetryEligibility {
  const cycle = getCycleById(sip, cycleId);

  if (!cycle) {
    return retryResult("CYCLE_NOT_FOUND", undefined);
  }

  if (sip.status !== "ACTIVE") {
    return retryResult("SIP_NOT_ACTIVE", cycle);
  }

  if (cycle.status !== "FAILED" || !cycle.failedOn) {
    return retryResult("CYCLE_NOT_FAILED", cycle);
  }

  if (compareDateOnly(asOfDate, cycle.failedOn) < 0) {
    return retryResult("BEFORE_FAILED_DATE", cycle);
  }

  if (cycle.retryAttempts >= demoPolicy.maxRetryAttempts) {
    return retryResult("ATTEMPT_LIMIT_REACHED", cycle);
  }

  const deadline = getRetryDeadline(cycle.failedOn);

  if (compareDateOnly(asOfDate, deadline) > 0) {
    return retryResult("WINDOW_EXPIRED", cycle);
  }

  return retryResult("ELIGIBLE", cycle, true);
}

export function validatePaymentState(
  sip: SipAccount,
  cycleId: string,
  asOfDate: string,
): PaymentStateValidation {
  const cycle = getCycleById(sip, cycleId);
  const retry = isRetryEligible(sip, cycleId, asOfDate);

  if (!cycle) {
    return { state: "NOT_FOUND", retry };
  }

  if (cycle.status === "PAID") {
    return { state: "PAID", retry };
  }

  if (cycle.status === "PENDING") {
    return { state: "PENDING", retry };
  }

  if (cycle.status === "MISSED") {
    return { state: "MISSED", retry };
  }

  if (sip.status !== "ACTIVE") {
    return { state: "SIP_INACTIVE", retry };
  }

  if (retry.eligible) {
    return { state: "FAILED_RETRY_AVAILABLE", retry };
  }

  if (retry.reason === "ATTEMPT_LIMIT_REACHED") {
    return { state: "FAILED_RETRY_EXHAUSTED", retry };
  }

  if (retry.reason === "BEFORE_FAILED_DATE") {
    return { state: "PENDING", retry };
  }

  return { state: "FAILED_WINDOW_EXPIRED", retry };
}

export function getPaymentState(
  sip: SipAccount,
  cycleId: string,
  asOfDate: string,
): PaymentState {
  return validatePaymentState(sip, cycleId, asOfDate).state;
}

function buildLastPayment(cycle: SipCycle | undefined, asOfDate: string): DemoPaymentAttempt {
  if (!cycle) {
    return {
      attemptedOn: asOfDate,
      status: "FAILED",
      reason: "No simulated payment history",
    };
  }

  const isPaid = cycle.status === "PAID";

  return {
    attemptedOn: cycle.paidOn ?? cycle.failedOn ?? cycle.scheduledDate,
    status: isPaid ? "SUCCESS" : "FAILED",
    reason: isPaid
      ? "Simulated scheduled debit"
      : (cycle.failureReason ?? "Simulated payment failure"),
  };
}

/**
 * Derives the display-oriented SIP status and payment summary without
 * duplicating business rules in the dashboard fixture.
 */
export function getSipDashboardSummary(
  sip: SipAccount,
  asOfDate: string,
): SipDashboardSummary {
  const latestPaymentCycle = getLatestPaymentCycle(sip);
  const latestFailedCycle = getLatestFailedCycle(sip);
  const retry = latestFailedCycle
    ? isRetryEligible(sip, latestFailedCycle.id, asOfDate)
    : null;

  let status: SipDashboardSummary["status"] = "ACTIVE";
  let statusLabel = "SIP active";

  if (sip.status === "PAUSED") {
    status = "PAUSED";
    statusLabel = "SIP paused";
  } else if (sip.status === "STOPPED") {
    status = "STOPPED";
    statusLabel = "SIP stopped";
  } else if (latestFailedCycle) {
    status = "PAYMENT_FAILED";
    statusLabel = retry?.eligible
      ? "Payment needs attention"
      : "Retry window closed";
  }

  return {
    status,
    statusLabel,
    lastPayment: buildLastPayment(latestPaymentCycle, asOfDate),
    retryBy: latestFailedCycle?.failedOn
      ? getRetryDeadline(latestFailedCycle.failedOn)
      : null,
    nextInstalmentDate: getNextInstalmentDate(sip, asOfDate),
  };
}
