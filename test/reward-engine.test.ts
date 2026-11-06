import { describe, expect, it } from "vitest";
import { applySipModification } from "@/lib/domain/modification-engine";
import {
  countEligibleInstalments,
  getMissedCycles,
  getRewardProgress,
} from "@/lib/domain/reward-engine";
import {
  addPaidCycle,
  createDemoState,
  getCycleOrThrow,
  markCyclePaid,
} from "./helpers/domain-state";

const DEMO_DATE = "2026-11-12";
const FAILED_CYCLE_ID = "cycle_2026_11";

describe("reward engine", () => {
  it("keeps the voucher locked at 11 eligible instalments", () => {
    const state = createDemoState();
    const reward = getRewardProgress(state.sip.cycles);

    expect(reward.eligibleInstalments).toBe(11);
    expect(reward.targetInstalments).toBe(12);
    expect(reward.remainingInstalments).toBe(1);
    expect(reward.isUnlocked).toBe(false);
  });

  it("unlocks the simulated voucher at 12 eligible instalments", () => {
    const state = createDemoState();
    addPaidCycle(state, "2026-12-10");
    const reward = getRewardProgress(state.sip.cycles);

    expect(reward.eligibleInstalments).toBe(12);
    expect(reward.isUnlocked).toBe(true);
    expect(reward.simulated).toBe(true);
    expect(reward.voucherNote).toContain("Not redeemable");
  });

  it("does not reset progress when a cycle is missed", () => {
    const state = createDemoState();

    expect(countEligibleInstalments(state.sip.cycles)).toBe(11);
    expect(getMissedCycles(state.sip.cycles)).toHaveLength(1);
    expect(getRewardProgress(state.sip.cycles).eligibleInstalments).toBe(11);
  });

  it("advances progress by exactly one after a successful retry", () => {
    const state = createDemoState();
    markCyclePaid(state, FAILED_CYCLE_ID, DEMO_DATE, "RETRY");

    expect(getRewardProgress(state.sip.cycles).eligibleInstalments).toBe(12);
  });

  it("counts duplicate paid records for the same cycle only once", () => {
    const state = createDemoState();
    markCyclePaid(state, FAILED_CYCLE_ID, DEMO_DATE, "RETRY");
    const original = getCycleOrThrow(state, FAILED_CYCLE_ID);
    state.sip.cycles.push({
      ...original,
      id: "duplicate_retry_2026_11",
      paidOn: "2026-11-12",
    });

    expect(getRewardProgress(state.sip.cycles).eligibleInstalments).toBe(12);
  });

  it("allows non-consecutive eligible months", () => {
    const state = createDemoState();
    state.sip.cycles = ["2026-01-10", "2026-03-10", "2026-05-10"].map(
      (scheduledDate) => ({
        id: `non_consecutive_${scheduledDate}`,
        monthKey: scheduledDate.slice(0, 7),
        scheduledDate,
        amount: 5_000,
        status: "PAID" as const,
        paidOn: scheduledDate,
        failedOn: null,
        failureReason: null,
        retryAttempts: 0,
        source: "SCHEDULED" as const,
      }),
    );

    const reward = getRewardProgress(state.sip.cycles);

    expect(reward.eligibleInstalments).toBe(3);
    expect(reward.isUnlocked).toBe(false);
  });

  it("preserves progress when the SIP amount changes", () => {
    const state = createDemoState();
    const result = applySipModification(
      state.sip,
      { amount: 6_000 },
      DEMO_DATE,
      DEMO_DATE,
    );

    expect(result.applied).toBe(true);
    expect(getRewardProgress(result.sip.cycles).eligibleInstalments).toBe(11);
  });

  it("preserves progress when the debit day changes", () => {
    const state = createDemoState();
    const result = applySipModification(
      state.sip,
      { debitDay: 15 },
      DEMO_DATE,
      DEMO_DATE,
    );

    expect(result.applied).toBe(true);
    expect(getRewardProgress(result.sip.cycles).eligibleInstalments).toBe(11);
  });
});
