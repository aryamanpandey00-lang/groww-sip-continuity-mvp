import {
  getNextScheduledDate,
  parseDateOnly,
  toDateOnly,
} from "./date-utils";
import { demoPolicy } from "./policy";
import type {
  SipAccount,
  SipModificationApplication,
  SipModificationPreview,
  SipModificationRequest,
} from "./types";

export function validateSipAmount(amount: number): string[] {
  const errors: string[] = [];

  if (!Number.isFinite(amount)) {
    errors.push("Monthly amount must be a finite number.");
  } else if (!Number.isInteger(amount)) {
    errors.push("Monthly amount must be a whole rupee value.");
  } else if (amount < demoPolicy.minMonthlyAmount) {
    errors.push(
      `Monthly amount must be at least ₹${demoPolicy.minMonthlyAmount}.`,
    );
  } else if (amount > demoPolicy.maxMonthlyAmount) {
    errors.push(
      `Monthly amount must not exceed ₹${demoPolicy.maxMonthlyAmount}.`,
    );
  }

  return errors;
}

export function validateDebitDay(debitDay: number): string[] {
  const errors: string[] = [];

  if (!Number.isFinite(debitDay)) {
    errors.push("Debit day must be a finite number.");
  } else if (!Number.isInteger(debitDay)) {
    errors.push("Debit day must be a whole number.");
  } else if (debitDay < demoPolicy.minDebitDay) {
    errors.push(`Debit day must be at least ${demoPolicy.minDebitDay}.`);
  } else if (debitDay > demoPolicy.maxDebitDay) {
    errors.push(`Debit day must not exceed ${demoPolicy.maxDebitDay}.`);
  }

  return errors;
}

/**
 * Amount and debit-day changes take effect from the next monthly cycle.
 * The cycle month is selected using the current schedule, then the proposed
 * debit day is applied inside that month. This prevents a change requested
 * after this month's debit from creating a second debit in the same month.
 */
export function getModificationEffectiveDate(
  sip: SipAccount,
  asOfDate: string,
  request: SipModificationRequest,
): string {
  const nextCycleDate = getNextScheduledDate(sip.debitDay, asOfDate);

  if (request.debitDay === undefined || request.debitDay === sip.debitDay) {
    return nextCycleDate;
  }

  const nextCycle = parseDateOnly(nextCycleDate);
  const from = parseDateOnly(asOfDate);
  let candidate = new Date(
    Date.UTC(
      nextCycle.getUTCFullYear(),
      nextCycle.getUTCMonth(),
      request.debitDay,
    ),
  );

  if (candidate.getTime() <= from.getTime()) {
    candidate = new Date(
      Date.UTC(
        nextCycle.getUTCFullYear(),
        nextCycle.getUTCMonth() + 1,
        request.debitDay,
      ),
    );
  }

  return toDateOnly(candidate);
}

export function previewSipModification(
  sip: SipAccount,
  request: SipModificationRequest,
  asOfDate: string,
): SipModificationPreview {
  const errors: string[] = [];
  const hasAmount = request.amount !== undefined;
  const hasDebitDay = request.debitDay !== undefined;

  if (!hasAmount && !hasDebitDay) {
    errors.push("Provide a monthly amount or debit day to change.");
  }

  if (hasAmount) {
    errors.push(...validateSipAmount(request.amount as number));
  }

  if (hasDebitDay) {
    errors.push(...validateDebitDay(request.debitDay as number));
  }

  const isValid = errors.length === 0;
  const changes: string[] = [];

  if (isValid) {
    if (hasAmount && request.amount !== sip.monthlyAmount) {
      changes.push(
        `Monthly amount changes from ₹${sip.monthlyAmount} to ₹${request.amount}.`,
      );
    }

    if (hasDebitDay && request.debitDay !== sip.debitDay) {
      changes.push(
        `Debit day changes from ${sip.debitDay} to ${request.debitDay}.`,
      );
    }
  }

  return {
    status: isValid ? "PREVIEWED" : "INVALID_PARAMS",
    currentAmount: sip.monthlyAmount,
    currentDebitDay: sip.debitDay,
    proposedAmount: request.amount ?? null,
    proposedDebitDay: request.debitDay ?? null,
    effectiveDate: isValid
      ? getModificationEffectiveDate(sip, asOfDate, request)
      : null,
    changes,
    errors,
    requiresConfirmation: isValid,
  };
}

/**
 * Applies a previously validated modification without touching existing cycles.
 * Invalid requests return the original SIP unchanged.
 */
export function applySipModification(
  sip: SipAccount,
  request: SipModificationRequest,
  asOfDate: string,
  modifiedOn: string,
): SipModificationApplication {
  const preview = previewSipModification(sip, request, asOfDate);

  if (preview.status !== "PREVIEWED") {
    return {
      applied: false,
      sip,
      effectiveDate: null,
      errors: preview.errors,
    };
  }

  return {
    applied: true,
    sip: {
      ...sip,
      monthlyAmount: request.amount ?? sip.monthlyAmount,
      debitDay: request.debitDay ?? sip.debitDay,
      lastModifiedOn: modifiedOn,
    },
    effectiveDate: preview.effectiveDate,
    errors: [],
  };
}
