import { cloneDemoInvestorState } from "@/lib/domain/fixtures/demo-investor";
import type {
  DemoInvestorState,
  InstalmentSource,
  SipCycle,
} from "@/lib/domain/types";

export function createDemoState(): DemoInvestorState {
  return cloneDemoInvestorState();
}

export function getCycleOrThrow(
  state: DemoInvestorState,
  cycleId: string,
): SipCycle {
  const cycle = state.sip.cycles.find((item) => item.id === cycleId);

  if (!cycle) {
    throw new Error(`Missing test cycle: ${cycleId}`);
  }

  return cycle;
}

export function updateCycle(
  state: DemoInvestorState,
  cycleId: string,
  patch: Partial<SipCycle>,
): SipCycle {
  const index = state.sip.cycles.findIndex((item) => item.id === cycleId);

  if (index === -1) {
    throw new Error(`Missing test cycle: ${cycleId}`);
  }

  const updated = { ...state.sip.cycles[index], ...patch };
  state.sip.cycles[index] = updated;
  return updated;
}

export function markCyclePaid(
  state: DemoInvestorState,
  cycleId: string,
  paidOn: string,
  source: InstalmentSource = "RETRY",
): SipCycle {
  return updateCycle(state, cycleId, {
    status: "PAID",
    paidOn,
    failureReason: null,
    source,
  });
}

export function addPaidCycle(
  state: DemoInvestorState,
  scheduledDate: string,
  amount = 5_000,
): SipCycle {
  const cycle: SipCycle = {
    id: `test_cycle_${scheduledDate}`,
    monthKey: scheduledDate.slice(0, 7),
    scheduledDate,
    amount,
    status: "PAID",
    paidOn: scheduledDate,
    failedOn: null,
    failureReason: null,
    retryAttempts: 0,
    source: "SCHEDULED",
  };

  state.sip.cycles.push(cycle);
  return cycle;
}

export function pauseSip(
  state: DemoInvestorState,
  pausedOn: string,
): DemoInvestorState {
  state.sip.status = "PAUSED";
  state.sip.pausedOn = pausedOn;
  state.sip.stoppedOn = null;
  return state;
}

export function stopSip(
  state: DemoInvestorState,
  stoppedOn: string,
): DemoInvestorState {
  state.sip.status = "STOPPED";
  state.sip.pausedOn = null;
  state.sip.stoppedOn = stoppedOn;
  return state;
}
