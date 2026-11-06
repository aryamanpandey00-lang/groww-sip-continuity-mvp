import { demoPolicy } from "./policy";
import type { RewardProgress, SipCycle } from "./types";

/**
 * A cycle is an eligible reward instalment only when it has been paid.
 * Duplicate records for the same scheduled month are counted once.
 */
export function getEligibleInstalments(cycles: SipCycle[]): SipCycle[] {
  const seenMonthKeys = new Set<string>();
  const eligible: SipCycle[] = [];

  for (const cycle of cycles) {
    if (cycle.status !== "PAID") {
      continue;
    }

    const key = cycle.monthKey || cycle.id;

    if (seenMonthKeys.has(key)) {
      continue;
    }

    seenMonthKeys.add(key);
    eligible.push(cycle);
  }

  return eligible;
}

export function countEligibleInstalments(cycles: SipCycle[]): number {
  return getEligibleInstalments(cycles).length;
}

export function getMissedCycles(cycles: SipCycle[]): SipCycle[] {
  return cycles.filter(
    (cycle) => cycle.status === "FAILED" || cycle.status === "MISSED",
  );
}

/**
 * Reward progress depends only on eligible paid cycles. A missed, failed or
 * window-expired cycle delays progress but never resets prior instalments.
 */
export function getRewardProgress(cycles: SipCycle[]): RewardProgress {
  const eligibleInstalments = countEligibleInstalments(cycles);
  const targetInstalments = demoPolicy.rewardTargetInstalments;
  const isUnlocked = eligibleInstalments >= targetInstalments;

  return {
    eligibleInstalments,
    targetInstalments,
    remainingInstalments: Math.max(
      0,
      targetInstalments - eligibleInstalments,
    ),
    isUnlocked,
    voucherLabel: demoPolicy.rewardVoucherLabel,
    voucherNote: demoPolicy.rewardVoucherNote,
    policyLabel: demoPolicy.label,
    simulated: true,
  };
}
