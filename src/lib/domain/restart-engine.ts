import {
  addCalendarDays,
  compareDateOnly,
  daysBetween,
} from "./date-utils";
import { demoPolicy } from "./policy";
import type {
  RestartEligibility,
  RestartEligibilityReason,
  SipAccount,
  SipRestartApplication,
  SipRestartPreview,
} from "./types";

function getStopAnchor(sip: SipAccount): string | null {
  if (sip.status === "PAUSED") {
    return sip.pausedOn;
  }

  if (sip.status === "STOPPED") {
    return sip.stoppedOn;
  }

  return null;
}

function restartResult(
  reason: RestartEligibilityReason,
  stoppedOn: string | null,
  asOfDate: string,
  eligible = false,
): RestartEligibility {
  const deadline = stoppedOn
    ? addCalendarDays(stoppedOn, demoPolicy.restartWindowDays)
    : null;

  return {
    eligible,
    reason,
    stoppedOn,
    deadline,
    daysRemaining:
      deadline && stoppedOn
        ? Math.max(0, daysBetween(asOfDate, deadline))
        : null,
  };
}

export function getRestartDeadline(sip: SipAccount): string | null {
  const stoppedOn = getStopAnchor(sip);
  return stoppedOn
    ? addCalendarDays(stoppedOn, demoPolicy.restartWindowDays)
    : null;
}

/**
 * Restart is allowed only for a paused or stopped SIP, and only while the
 * request date is within 90 calendar days inclusive of the pause/stop date.
 */
export function getRestartEligibility(
  sip: SipAccount,
  asOfDate: string,
): RestartEligibility {
  if (sip.status === "ACTIVE") {
    return restartResult("SIP_ALREADY_ACTIVE", null, asOfDate);
  }

  const stoppedOn = getStopAnchor(sip);

  if (!stoppedOn) {
    return restartResult("MISSING_STOP_DATE", null, asOfDate);
  }

  if (compareDateOnly(asOfDate, stoppedOn) < 0) {
    return restartResult("BEFORE_STOP_DATE", stoppedOn, asOfDate);
  }

  const deadline = addCalendarDays(stoppedOn, demoPolicy.restartWindowDays);

  if (compareDateOnly(asOfDate, deadline) > 0) {
    return restartResult("WINDOW_EXPIRED", stoppedOn, asOfDate);
  }

  return restartResult("ELIGIBLE", stoppedOn, asOfDate, true);
}

export function previewSipRestart(
  sip: SipAccount,
  asOfDate: string,
): SipRestartPreview {
  const eligibility = getRestartEligibility(sip, asOfDate);

  return {
    status: eligibility.eligible ? "PREVIEWED" : "NOT_ELIGIBLE",
    eligibility,
    progressPreserved: true,
    requiresConfirmation: eligibility.eligible,
  };
}

/**
 * Restarts the SIP without changing its cycle history, preserving reward
 * progress. Invalid restarts return the original SIP unchanged.
 */
export function applySipRestart(
  sip: SipAccount,
  asOfDate: string,
): SipRestartApplication {
  const eligibility = getRestartEligibility(sip, asOfDate);

  if (!eligibility.eligible) {
    return {
      applied: false,
      sip,
      eligibility,
      errors: ["SIP is not eligible for a simulated restart."],
    };
  }

  return {
    applied: true,
    sip: {
      ...sip,
      status: "ACTIVE",
      pausedOn: null,
      stoppedOn: null,
      restartedOn: asOfDate,
    },
    eligibility,
    errors: [],
  };
}
