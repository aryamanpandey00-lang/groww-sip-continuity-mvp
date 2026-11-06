import { addCalendarDays } from "../date-utils";
import { cloneDemoInvestorState } from "./demo-investor";
import { demoPolicy } from "../policy";
import type { DemoInvestorState } from "../types";

export const ASSISTANT_DEMO_SCENARIOS = [
  "BASE",
  "PAUSED_RESTART",
] as const;

export type AssistantDemoScenario =
  (typeof ASSISTANT_DEMO_SCENARIOS)[number];

/** Returns a fresh server-owned fictional scenario for assistant requests. */
export function getAssistantDemoState(
  scenario: AssistantDemoScenario = "BASE",
): DemoInvestorState {
  const state = cloneDemoInvestorState();

  if (scenario === "BASE") {
    return state;
  }

  const pausedOn = addCalendarDays(demoPolicy.demoToday, -30);
  state.asOfDate = demoPolicy.demoToday;
  state.sip.status = "PAUSED";
  state.sip.pausedOn = pausedOn;
  state.sip.cycles = state.sip.cycles.filter(
    (cycle) => cycle.scheduledDate <= pausedOn,
  );

  return state;
}
