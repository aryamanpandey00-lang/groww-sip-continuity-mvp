import { describe, expect, it } from "vitest";
import { demoDashboard } from "@/lib/domain/fixtures/demo-dashboard";
import {
  formatDemoDate,
  formatInr,
  formatPercent,
} from "@/lib/utils/format";

describe("demo dashboard fixture", () => {
  it("keeps portfolio values internally consistent", () => {
    const { totalValue, investedAmount, returnsAmount, returnsPercent } =
      demoDashboard.portfolio;

    expect(totalValue - investedAmount).toBe(returnsAmount);
    expect(returnsPercent).toBeCloseTo(
      (returnsAmount / investedAmount) * 100,
      1,
    );
  });

  it("labels the investor, fund and reward as fictional", () => {
    expect(demoDashboard.investor.displayName).toContain("Demo");
    expect(demoDashboard.sip.fundName).toContain("Fictional");
    expect(demoDashboard.sip.fundName).toContain("Demo Only");
    expect(demoDashboard.reward.rewardLabel.toLowerCase()).toContain("fictional");
    expect(demoDashboard.reward.rewardNote.toLowerCase()).toContain(
      "not redeemable",
    );
  });

  it("keeps reward progress within the target and locked for this scenario", () => {
    const { eligibleInstalments, targetInstalments, isUnlocked } =
      demoDashboard.reward;

    expect(eligibleInstalments).toBeGreaterThanOrEqual(0);
    expect(eligibleInstalments).toBeLessThanOrEqual(targetInstalments);
    expect(isUnlocked).toBe(false);
  });

  it("defines unique quick actions with internal hrefs", () => {
    const ids = demoDashboard.quickActions.map((action) => action.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const action of demoDashboard.quickActions) {
      expect(action.href.startsWith("/")).toBe(true);
      expect(action.label.length).toBeGreaterThan(0);
    }
  });

  it("uses valid ISO demo dates", () => {
    const dates = [
      demoDashboard.asOfDate,
      demoDashboard.sip.nextInstalmentDate,
      demoDashboard.sip.lastPayment.attemptedOn,
      demoDashboard.sip.retryBy,
    ];

    for (const date of dates) {
      expect(Number.isNaN(Date.parse(`${date}T00:00:00Z`))).toBe(false);
    }
  });
});

describe("display formatters", () => {
  it("formats INR with Indian digit grouping", () => {
    expect(formatInr(124850)).toContain("1,24,850");
    expect(formatInr(5000)).toContain("₹");
  });

  it("formats demo dates in UTC", () => {
    expect(formatDemoDate("2026-11-12")).toBe("12 Nov 2026");
  });

  it("formats percentages with a sign", () => {
    expect(formatPercent(11.47)).toBe("+11.47%");
    expect(formatPercent(-2)).toBe("-2.00%");
  });
});
