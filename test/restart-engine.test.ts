import { describe, expect, it } from "vitest";
import {
  applySipRestart,
  getRestartDeadline,
  getRestartEligibility,
  previewSipRestart,
} from "@/lib/domain/restart-engine";
import { countEligibleInstalments } from "@/lib/domain/reward-engine";
import {
  createDemoState,
  pauseSip,
  stopSip,
} from "./helpers/domain-state";

const DEMO_DATE = "2026-11-12";

describe("SIP restart engine", () => {
  it("allows restart within 90 days", () => {
    const state = pauseSip(createDemoState(), "2026-09-01");
    const result = getRestartEligibility(state.sip, DEMO_DATE);

    expect(result.eligible).toBe(true);
    expect(result.reason).toBe("ELIGIBLE");
    expect(result.deadline).toBe("2026-11-30");
  });

  it("allows restart exactly on the 90-day boundary", () => {
    const state = pauseSip(createDemoState(), "2026-08-14");

    expect(getRestartDeadline(state.sip)).toBe("2026-11-12");
    expect(getRestartEligibility(state.sip, "2026-11-12").eligible).toBe(true);
  });

  it("rejects restart after the 90-day boundary", () => {
    const state = stopSip(createDemoState(), "2026-08-14");
    const result = getRestartEligibility(state.sip, "2026-11-13");

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("WINDOW_EXPIRED");
  });

  it("rejects restart for active SIPs or missing stop dates", () => {
    const activeState = createDemoState();
    expect(getRestartEligibility(activeState.sip, DEMO_DATE)).toMatchObject({
      eligible: false,
      reason: "SIP_ALREADY_ACTIVE",
    });

    const missingDateState = createDemoState();
    missingDateState.sip.status = "PAUSED";
    expect(getRestartEligibility(missingDateState.sip, DEMO_DATE)).toMatchObject({
      eligible: false,
      reason: "MISSING_STOP_DATE",
    });
  });

  it("previews restart without mutating state or erasing progress", () => {
    const state = pauseSip(createDemoState(), "2026-09-01");
    const before = structuredClone(state);
    const progressBefore = countEligibleInstalments(state.sip.cycles);
    const preview = previewSipRestart(state.sip, DEMO_DATE);

    expect(preview.status).toBe("PREVIEWED");
    expect(preview.progressPreserved).toBe(true);
    expect(preview.requiresConfirmation).toBe(true);
    expect(countEligibleInstalments(state.sip.cycles)).toBe(progressBefore);
    expect(state).toEqual(before);
  });

  it("restarts the SIP while preserving cycle history and reward progress", () => {
    const state = pauseSip(createDemoState(), "2026-09-01");
    const cyclesBefore = structuredClone(state.sip.cycles);
    const progressBefore = countEligibleInstalments(state.sip.cycles);
    const result = applySipRestart(state.sip, DEMO_DATE);

    expect(result.applied).toBe(true);
    expect(result.sip.status).toBe("ACTIVE");
    expect(result.sip.pausedOn).toBeNull();
    expect(result.sip.stoppedOn).toBeNull();
    expect(result.sip.restartedOn).toBe(DEMO_DATE);
    expect(result.sip.cycles).toEqual(cyclesBefore);
    expect(countEligibleInstalments(result.sip.cycles)).toBe(progressBefore);
  });

  it("returns the original SIP when restart is ineligible", () => {
    const state = stopSip(createDemoState(), "2026-08-14");
    const result = applySipRestart(state.sip, "2026-11-13");

    expect(result.applied).toBe(false);
    expect(result.sip).toBe(state.sip);
  });
});
