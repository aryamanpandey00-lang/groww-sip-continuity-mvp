import { describe, expect, it } from "vitest";
import {
  getLatestFailedCycle,
  getNextInstalmentDate,
  getPaymentState,
  getRetryAttemptsRemaining,
  getRetryDeadline,
  getSipDashboardSummary,
  isRetryEligible,
} from "@/lib/domain/sip-engine";
import { createDemoState, getCycleOrThrow, updateCycle } from "./helpers/domain-state";

const DEMO_DATE = "2026-11-12";
const FAILED_CYCLE_ID = "cycle_2026_11";

describe("SIP schedule and retry engine", () => {
  it("calculates the demo next instalment and retry deadline", () => {
    const state = createDemoState();

    expect(getNextInstalmentDate(state.sip, DEMO_DATE)).toBe("2026-12-10");
    expect(getRetryDeadline("2026-11-10")).toBe("2026-11-17");
    expect(getRetryDeadline("2028-02-22")).toBe("2028-02-29");
  });

  it("returns no next instalment for paused or stopped SIPs", () => {
    const state = createDemoState();
    state.sip.status = "PAUSED";
    state.sip.pausedOn = "2026-11-01";

    expect(getNextInstalmentDate(state.sip, DEMO_DATE)).toBeNull();
  });

  it("derives the dashboard summary from the failed cycle", () => {
    const state = createDemoState();
    const summary = getSipDashboardSummary(state.sip, DEMO_DATE);

    expect(summary.status).toBe("PAYMENT_FAILED");
    expect(summary.statusLabel).toBe("Payment needs attention");
    expect(summary.retryBy).toBe("2026-11-17");
    expect(summary.nextInstalmentDate).toBe("2026-12-10");
    expect(summary.lastPayment).toEqual({
      attemptedOn: "2026-11-10",
      status: "FAILED",
      reason: "Simulated insufficient balance",
    });
  });

  it.each([
    ["the failure date", "2026-11-10", true, "ELIGIBLE"],
    ["the seventh calendar day", "2026-11-17", true, "ELIGIBLE"],
    ["the day after the window", "2026-11-18", false, "WINDOW_EXPIRED"],
    ["before the failure date", "2026-11-09", false, "BEFORE_FAILED_DATE"],
  ])("validates retry on %s", (_label, asOfDate, eligible, reason) => {
    const state = createDemoState();
    const result = isRetryEligible(state.sip, FAILED_CYCLE_ID, asOfDate);

    expect(result.eligible).toBe(eligible);
    expect(result.reason).toBe(reason);
    expect(result.deadline).toBe("2026-11-17");
  });

  it("rejects a retry once the attempt limit is reached", () => {
    const state = createDemoState();
    updateCycle(state, FAILED_CYCLE_ID, { retryAttempts: 3 });

    const result = isRetryEligible(state.sip, FAILED_CYCLE_ID, DEMO_DATE);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("ATTEMPT_LIMIT_REACHED");
    expect(result.attemptsRemaining).toBe(0);
    expect(getRetryAttemptsRemaining(getCycleOrThrow(state, FAILED_CYCLE_ID))).toBe(0);
  });

  it("allows the final retry attempt when two have been used", () => {
    const state = createDemoState();
    updateCycle(state, FAILED_CYCLE_ID, { retryAttempts: 2 });

    const result = isRetryEligible(state.sip, FAILED_CYCLE_ID, DEMO_DATE);

    expect(result.eligible).toBe(true);
    expect(result.attemptsRemaining).toBe(1);
  });

  it("rejects retries for paid cycles and inactive SIPs", () => {
    const paidState = createDemoState();
    const paidCycle = paidState.sip.cycles[0];
    expect(
      isRetryEligible(paidState.sip, paidCycle.id, DEMO_DATE),
    ).toMatchObject({ eligible: false, reason: "CYCLE_NOT_FAILED" });

    const pausedState = createDemoState();
    pausedState.sip.status = "PAUSED";
    pausedState.sip.pausedOn = "2026-11-01";
    expect(
      isRetryEligible(pausedState.sip, FAILED_CYCLE_ID, DEMO_DATE),
    ).toMatchObject({ eligible: false, reason: "SIP_NOT_ACTIVE" });
  });

  it("validates the payment state for retry and settled cycles", () => {
    const state = createDemoState();

    expect(getPaymentState(state.sip, FAILED_CYCLE_ID, DEMO_DATE)).toBe(
      "FAILED_RETRY_AVAILABLE",
    );
    expect(getLatestFailedCycle(state.sip)?.id).toBe(FAILED_CYCLE_ID);

    updateCycle(state, FAILED_CYCLE_ID, { retryAttempts: 3 });
    expect(getPaymentState(state.sip, FAILED_CYCLE_ID, DEMO_DATE)).toBe(
      "FAILED_RETRY_EXHAUSTED",
    );

    const paidState = createDemoState();
    expect(getPaymentState(paidState.sip, "cycle_2026_10", DEMO_DATE)).toBe(
      "PAID",
    );
  });
});
