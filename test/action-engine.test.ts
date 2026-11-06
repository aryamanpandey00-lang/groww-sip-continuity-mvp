import { describe, expect, it } from "vitest";
import {
  applyConfirmedAction,
  confirmSimulatedAction,
  previewSimulatedAction,
} from "@/lib/domain/action-engine";
import { addMinutesToIsoTimestamp } from "@/lib/domain/date-utils";
import { demoPolicy } from "@/lib/domain/policy";
import { getRewardProgress } from "@/lib/domain/reward-engine";
import type { SimulatedActionRequest } from "@/lib/domain/types";
import {
  addPaidCycle,
  createDemoState,
  markCyclePaid,
  pauseSip,
  updateCycle,
} from "./helpers/domain-state";

const DEMO_NOW = demoPolicy.demoNow;
const FAILED_CYCLE_ID = "cycle_2026_11";

describe("simulated action engine", () => {
  it("previews a retry without mutating state", () => {
    const state = createDemoState();
    const before = structuredClone(state);
    const preview = previewSimulatedAction(state, {
      type: "RETRY_PAYMENT",
      cycleId: FAILED_CYCLE_ID,
    });

    expect(preview.status).toBe("PREVIEWED");
    expect(preview.eligibility).toBe("ELIGIBLE");
    expect(preview.requiresConfirmation).toBe(true);
    expect(preview.effects.length).toBeGreaterThan(0);
    expect(preview.errors).toHaveLength(0);
    expect(state).toEqual(before);
  });

  it("does not mutate state without explicit confirmation", () => {
    const state = createDemoState();
    const before = structuredClone(state);
    const preview = previewSimulatedAction(state, {
      type: "RETRY_PAYMENT",
      cycleId: FAILED_CYCLE_ID,
    });
    const confirmation = confirmSimulatedAction(preview, state, {
      confirmed: false,
      confirmedAt: DEMO_NOW,
    });

    expect(confirmation.status).toBe("AWAITING_CONFIRMATION");
    expect(confirmation.nextState).toBeNull();
    expect(confirmation.applied).toBe(false);

    const application = applyConfirmedAction(confirmation);

    expect(application.status).toBe("AWAITING_CONFIRMATION");
    expect(application.applied).toBe(false);
    expect(application.state).toBeNull();
    expect(state).toEqual(before);
  });

  it("applies only the confirmed simulated transition", () => {
    const state = createDemoState();
    const before = structuredClone(state);
    const preview = previewSimulatedAction(state, {
      type: "RETRY_PAYMENT",
      cycleId: FAILED_CYCLE_ID,
    });
    const confirmation = confirmSimulatedAction(preview, state, {
      confirmed: true,
      confirmedAt: DEMO_NOW,
    });

    expect(confirmation.status).toBe("CONFIRMED_SIMULATED");
    expect(confirmation.nextState).not.toBeNull();
    expect(state).toEqual(before);

    const application = applyConfirmedAction(confirmation);

    expect(application.status).toBe("APPLIED_SIMULATED");
    expect(application.applied).toBe(true);
    expect(application.event?.simulated).toBe(true);
    expect(application.event?.type).toBe("RETRY_PAYMENT");
    expect(application.event?.rewardProgressBefore).toBe(11);
    expect(application.event?.rewardProgressAfter).toBe(12);
    expect(application.state).not.toBeNull();

    const appliedState = application.state!;
    const retriedCycle = appliedState.sip.cycles.find(
      (cycle) => cycle.id === FAILED_CYCLE_ID,
    );

    expect(retriedCycle).toMatchObject({
      status: "PAID",
      paidOn: "2026-11-12",
      source: "RETRY",
      retryAttempts: 1,
    });
    expect(getRewardProgress(appliedState.sip.cycles).eligibleInstalments).toBe(
      12,
    );
    expect(getRewardProgress(state.sip.cycles).eligibleInstalments).toBe(11);
  });

  it("rejects invalid action parameters", () => {
    const state = createDemoState();
    const invalidRequests: SimulatedActionRequest[] = [
      { type: "MODIFY_AMOUNT", amount: 499 },
      { type: "MODIFY_AMOUNT", amount: 25_001 },
      { type: "MODIFY_AMOUNT", amount: 500.5 },
      { type: "MODIFY_DEBIT_DAY", debitDay: 0 },
      { type: "MODIFY_DEBIT_DAY", debitDay: 29 },
      { type: "MODIFY_DEBIT_DAY", debitDay: 10.5 },
    ];

    for (const request of invalidRequests) {
      const preview = previewSimulatedAction(state, request);
      expect(preview.status).toBe("INVALID_PARAMS");
      expect(preview.eligibility).toBe("INVALID_PARAMS");
      expect(preview.errors.length).toBeGreaterThan(0);
    }
  });

  it("rejects ineligible actions", () => {
    const latePreview = previewSimulatedAction(
      createDemoState(),
      { type: "RETRY_PAYMENT", cycleId: FAILED_CYCLE_ID },
      "2026-11-18T10:00:00.000Z",
    );
    expect(latePreview.status).toBe("NOT_ELIGIBLE");

    const limitedState = createDemoState();
    updateCycle(limitedState, FAILED_CYCLE_ID, { retryAttempts: 3 });
    expect(
      previewSimulatedAction(limitedState, {
        type: "RETRY_PAYMENT",
        cycleId: FAILED_CYCLE_ID,
      }).status,
    ).toBe("NOT_ELIGIBLE");

    const paidState = createDemoState();
    markCyclePaid(paidState, FAILED_CYCLE_ID, "2026-11-12");
    expect(
      previewSimulatedAction(paidState, {
        type: "RETRY_PAYMENT",
        cycleId: FAILED_CYCLE_ID,
      }).status,
    ).toBe("NOT_ELIGIBLE");

    expect(
      previewSimulatedAction(createDemoState(), { type: "RESTART_SIP" }).status,
    ).toBe("NOT_ELIGIBLE");
  });

  it("rejects confirmation after the state has changed", () => {
    const state = createDemoState();
    const preview = previewSimulatedAction(state, {
      type: "RETRY_PAYMENT",
      cycleId: FAILED_CYCLE_ID,
    });
    const changedState = createDemoState();
    addPaidCycle(changedState, "2026-12-10");

    const confirmation = confirmSimulatedAction(preview, changedState, {
      confirmed: true,
      confirmedAt: DEMO_NOW,
    });

    expect(confirmation.status).toBe("STATE_CHANGED");
    expect(confirmation.nextState).toBeNull();
  });

  it("rejects confirmation after preview expiry", () => {
    const state = createDemoState();
    const preview = previewSimulatedAction(state, {
      type: "RETRY_PAYMENT",
      cycleId: FAILED_CYCLE_ID,
    });
    const expiredAt = addMinutesToIsoTimestamp(
      DEMO_NOW,
      demoPolicy.actionPreviewTtlMinutes + 1,
    );

    const confirmation = confirmSimulatedAction(preview, state, {
      confirmed: true,
      confirmedAt: expiredAt,
    });

    expect(confirmation.status).toBe("TOKEN_EXPIRED");
    expect(confirmation.nextState).toBeNull();
  });

  it("applies a confirmed amount change and preserves reward progress", () => {
    const state = createDemoState();
    const preview = previewSimulatedAction(state, {
      type: "MODIFY_AMOUNT",
      amount: 6_000,
    });
    const confirmation = confirmSimulatedAction(preview, state, {
      confirmed: true,
      confirmedAt: DEMO_NOW,
    });
    const application = applyConfirmedAction(confirmation);

    expect(application.status).toBe("APPLIED_SIMULATED");
    expect(application.event?.type).toBe("MODIFY_AMOUNT");
    expect(application.event?.details.effectiveDate).toBe("2026-12-10");
    expect(application.state?.sip.monthlyAmount).toBe(6_000);
    expect(
      getRewardProgress(application.state!.sip.cycles).eligibleInstalments,
    ).toBe(11);
  });

  it("applies a confirmed debit-day change and preserves reward progress", () => {
    const state = createDemoState();
    const preview = previewSimulatedAction(state, {
      type: "MODIFY_DEBIT_DAY",
      debitDay: 15,
    });
    const confirmation = confirmSimulatedAction(preview, state, {
      confirmed: true,
      confirmedAt: DEMO_NOW,
    });
    const application = applyConfirmedAction(confirmation);

    expect(application.status).toBe("APPLIED_SIMULATED");
    expect(application.event?.type).toBe("MODIFY_DEBIT_DAY");
    expect(application.event?.details.effectiveDate).toBe("2026-12-15");
    expect(application.state?.sip.debitDay).toBe(15);
    expect(
      getRewardProgress(application.state!.sip.cycles).eligibleInstalments,
    ).toBe(11);
  });

  it("applies a confirmed restart while preserving reward progress", () => {
    const state = pauseSip(createDemoState(), "2026-09-01");
    const preview = previewSimulatedAction(state, { type: "RESTART_SIP" });
    const confirmation = confirmSimulatedAction(preview, state, {
      confirmed: true,
      confirmedAt: DEMO_NOW,
    });
    const application = applyConfirmedAction(confirmation);

    expect(application.status).toBe("APPLIED_SIMULATED");
    expect(application.event?.type).toBe("RESTART_SIP");
    expect(application.event?.details.progressPreserved).toBe(true);
    expect(application.state?.sip.status).toBe("ACTIVE");
    expect(application.state?.sip.pausedOn).toBeNull();
    expect(
      getRewardProgress(application.state!.sip.cycles).eligibleInstalments,
    ).toBe(11);
  });

  it("prevents a duplicate retry from increasing reward progress again", () => {
    const state = createDemoState();
    const preview = previewSimulatedAction(state, {
      type: "RETRY_PAYMENT",
      cycleId: FAILED_CYCLE_ID,
    });
    const confirmation = confirmSimulatedAction(preview, state, {
      confirmed: true,
      confirmedAt: DEMO_NOW,
    });
    const appliedState = applyConfirmedAction(confirmation).state!;

    const duplicatePreview = previewSimulatedAction(appliedState, {
      type: "RETRY_PAYMENT",
      cycleId: FAILED_CYCLE_ID,
    });

    expect(duplicatePreview.status).toBe("NOT_ELIGIBLE");
    expect(getRewardProgress(appliedState.sip.cycles).eligibleInstalments).toBe(
      12,
    );
  });
});
