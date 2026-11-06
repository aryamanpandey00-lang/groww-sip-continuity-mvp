import type {
  DemoInvestor,
  DemoInvestorState,
  SipAccount,
  SipCycle,
} from "../types";

const paidCycles: SipCycle[] = [
  "2025-12-10",
  "2026-01-10",
  "2026-02-10",
  "2026-03-10",
  "2026-04-10",
  "2026-05-10",
  "2026-06-10",
  "2026-07-10",
  "2026-08-10",
  "2026-09-10",
  "2026-10-10",
].map((scheduledDate) => ({
  id: `cycle_${scheduledDate.slice(0, 7).replace("-", "_")}`,
  monthKey: scheduledDate.slice(0, 7),
  scheduledDate,
  amount: 5_000,
  status: "PAID",
  paidOn: scheduledDate,
  failedOn: null,
  failureReason: null,
  retryAttempts: 0,
  source: "SCHEDULED",
}));

const failedNovemberCycle: SipCycle = {
  id: "cycle_2026_11",
  monthKey: "2026-11",
  scheduledDate: "2026-11-10",
  amount: 5_000,
  status: "FAILED",
  paidOn: null,
  failedOn: "2026-11-10",
  failureReason: "Simulated insufficient balance",
  retryAttempts: 0,
  source: null,
};

export const demoInvestor: DemoInvestor = {
  id: "demo_investor_001",
  displayName: "Demo Investor 001",
  initials: "DI",
};

export const demoSip: SipAccount = {
  id: "sip_demo_001",
  investorId: demoInvestor.id,
  fundName: "Fictional Flexi Cap Fund — Demo Only",
  fundCategory: "Flexi cap · Fictional scheme",
  monthlyAmount: 5_000,
  debitDay: 10,
  startDate: "2025-12-10",
  status: "ACTIVE",
  pausedOn: null,
  stoppedOn: null,
  restartedOn: null,
  lastModifiedOn: null,
  cycles: [...paidCycles, failedNovemberCycle],
};

/**
 * Single source of truth for the deterministic demo domain state.
 * All values are fictional.
 */
export const demoInvestorState: DemoInvestorState = {
  asOfDate: "2026-11-12",
  investor: demoInvestor,
  sip: demoSip,
};

export function cloneDemoInvestorState(): DemoInvestorState {
  return {
    ...demoInvestorState,
    investor: { ...demoInvestorState.investor },
    sip: {
      ...demoInvestorState.sip,
      cycles: demoInvestorState.sip.cycles.map((cycle) => ({ ...cycle })),
    },
  };
}
