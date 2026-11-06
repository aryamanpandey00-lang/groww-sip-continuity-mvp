import { demoInvestorState } from "./demo-investor";
import { getRewardProgress } from "../reward-engine";
import { getSipDashboardSummary } from "../sip-engine";
import type { DemoDashboard } from "../types";

const asOfDate = demoInvestorState.asOfDate;
const sipSummary = getSipDashboardSummary(demoInvestorState.sip, asOfDate);
const rewardProgress = getRewardProgress(demoInvestorState.sip.cycles);
const nextInstalmentDate = sipSummary.nextInstalmentDate;
const retryBy = sipSummary.retryBy;

if (!nextInstalmentDate || !retryBy) {
  throw new Error(
    "The demo dashboard fixture requires an active SIP with an actionable failed cycle.",
  );
}

/**
 * Display fixture for the dashboard. SIP, retry and reward values are derived
 * from the deterministic domain fixture and engines; portfolio and navigation
 * values remain presentation-only demo data.
 */
export const demoDashboard: DemoDashboard = {
  asOfDate,
  investor: demoInvestorState.investor,
  portfolio: {
    totalValue: 124850,
    investedAmount: 112000,
    returnsAmount: 12850,
    returnsPercent: 11.47,
  },
  sip: {
    id: demoInvestorState.sip.id,
    fundName: demoInvestorState.sip.fundName,
    fundCategory: demoInvestorState.sip.fundCategory,
    monthlyAmount: demoInvestorState.sip.monthlyAmount,
    debitDay: demoInvestorState.sip.debitDay,
    nextInstalmentDate,
    status: sipSummary.status,
    statusLabel: sipSummary.statusLabel,
    lastPayment: sipSummary.lastPayment,
    retryBy,
  },
  reward: {
    targetInstalments: rewardProgress.targetInstalments,
    eligibleInstalments: rewardProgress.eligibleInstalments,
    rewardLabel: rewardProgress.voucherLabel,
    rewardNote: rewardProgress.voucherNote,
    isUnlocked: rewardProgress.isUnlocked,
  },
  quickActions: [
    {
      id: "mutual-funds",
      label: "Mutual Funds",
      description: "Explore fictional fund categories",
      href: "/investments",
    },
    {
      id: "stocks",
      label: "Stocks",
      description: "Explore the stocks placeholder",
      href: "/explore",
    },
    {
      id: "add-money",
      label: "Add Money",
      description: "View the simulated add-money placeholder",
      href: "/add-money",
    },
    {
      id: "my-sips",
      label: "My SIPs",
      description: "View the demo SIP",
      href: "/sips",
    },
  ],
  disclaimer:
    "Fictional investor, funds and values. Dashboard SIP and reward values come from deterministic demo engines. No real account, market feed, payment, reward or AI integration is connected.",
};
