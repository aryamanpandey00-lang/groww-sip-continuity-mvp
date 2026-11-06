import { cloneDemoInvestorState } from "@/lib/domain/fixtures/demo-investor";
import { addCalendarDays } from "@/lib/domain/date-utils";
import { demoPolicy } from "@/lib/domain/policy";
import type { DemoInvestorState, SipCycle } from "@/lib/domain/types";
import type { GoldenDemoStateVariant } from "./types";

const CURRENT_FAILED_CYCLE_ID = "cycle_2026_11";
const MISSED_CYCLE_ID = "cycle_2026_09";

function requireCycle(state: DemoInvestorState, cycleId: string): SipCycle {
  const cycle = state.sip.cycles.find((item) => item.id === cycleId);

  if (!cycle) {
    throw new Error(`Demo state variant is missing cycle ${cycleId}.`);
  }

  return cycle;
}

function markCurrentCyclePaid(state: DemoInvestorState): void {
  const cycle = requireCycle(state, CURRENT_FAILED_CYCLE_ID);
  cycle.status = "PAID";
  cycle.paidOn = demoPolicy.demoToday;
  cycle.failedOn = null;
  cycle.failureReason = null;
  cycle.retryAttempts = 1;
  cycle.source = "RETRY";
}

/**
 * Builds deterministic domain states for golden cases. Dates and limits are
 * derived from the authoritative demo fixture and policy where the boundary is
 * a policy boundary; scenario-specific offsets remain explicit.
 */
export function buildDemoStateVariant(
  variant: GoldenDemoStateVariant,
): DemoInvestorState {
  const state = cloneDemoInvestorState();
  state.asOfDate = demoPolicy.demoToday;

  switch (variant) {
    case "base":
      return state;

    case "retry_window_expired": {
      const cycle = requireCycle(state, CURRENT_FAILED_CYCLE_ID);
      state.asOfDate = addCalendarDays(
        cycle.failedOn ?? demoPolicy.demoToday,
        demoPolicy.retryWindowDays + 1,
      );
      return state;
    }

    case "retry_attempts_exhausted": {
      const cycle = requireCycle(state, CURRENT_FAILED_CYCLE_ID);
      cycle.retryAttempts = demoPolicy.maxRetryAttempts;
      return state;
    }

    case "restart_eligible": {
      const pausedOn = addCalendarDays(demoPolicy.demoToday, -30);
      state.sip.status = "PAUSED";
      state.sip.pausedOn = pausedOn;
      state.sip.cycles = state.sip.cycles.filter(
        (cycle) => cycle.scheduledDate <= pausedOn,
      );
      return state;
    }

    case "restart_expired": {
      const pausedOn = addCalendarDays(
        demoPolicy.demoToday,
        -(demoPolicy.restartWindowDays + 1),
      );
      state.sip.status = "PAUSED";
      state.sip.pausedOn = pausedOn;
      state.sip.cycles = state.sip.cycles.filter(
        (cycle) => cycle.scheduledDate <= pausedOn,
      );
      return state;
    }

    case "reward_unlocked": {
      markCurrentCyclePaid(state);
      return state;
    }

    case "missed_cycle": {
      const cycle = requireCycle(state, MISSED_CYCLE_ID);
      cycle.status = "MISSED";
      cycle.paidOn = null;
      cycle.failedOn = cycle.scheduledDate;
      cycle.failureReason = "Simulated missed cycle";
      cycle.source = null;
      return state;
    }

    case "duplicate_retry": {
      markCurrentCyclePaid(state);
      const cycle = requireCycle(state, CURRENT_FAILED_CYCLE_ID);
      state.sip.cycles.push({
        ...cycle,
        id: "cycle_2026_11_duplicate_retry",
        paidOn: demoPolicy.demoToday,
        retryAttempts: 1,
        source: "RETRY",
      });
      return state;
    }
  }
}
