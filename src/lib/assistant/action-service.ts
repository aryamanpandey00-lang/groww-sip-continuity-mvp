import "server-only";

import { randomUUID } from "node:crypto";
import { demoClock } from "@/lib/domain/clock";
import {
  applyConfirmedAction,
  confirmSimulatedAction,
  previewSimulatedAction,
} from "@/lib/domain/action-engine";
import { demoPolicy } from "@/lib/domain/policy";
import { getRewardProgress } from "@/lib/domain/reward-engine";
import { markActionPreviewConsumed } from "./action-replay-guard";
import type {
  ActionPreview,
  DemoInvestorState,
  SimulatedActionRequest,
} from "@/lib/domain/types";
import type { AssistantProposedAction } from "@/lib/ai/types";
import type {
  ActionOperationResponse,
  ActionPreviewSource,
  PracticeActionInput,
  PublicActionPreview,
  ActionStateSummary,
} from "./action-contracts";
import {
  createActionDemoSession,
  readSignedActionSession,
  signActionDemoSession,
  type ActionDemoSession,
} from "./action-session";
import type { AssistantDemoScenario } from "@/lib/domain/fixtures/assistant-scenarios";

export const ACTION_PREVIEW_TTL_MS = demoPolicy.actionPreviewTtlMinutes * 60 * 1_000;

const ACTION_TITLES: Record<SimulatedActionRequest["type"], string> = {
  RETRY_PAYMENT: "Retry a failed SIP payment",
  MODIFY_AMOUNT: "Change the SIP amount",
  MODIFY_DEBIT_DAY: "Change the SIP debit date",
  RESTART_SIP: "Restart a paused SIP",
};

export function practiceActionToDomainRequest(
  state: DemoInvestorState,
  input: PracticeActionInput,
): SimulatedActionRequest {
  switch (input.type) {
    case "RETRY_PAYMENT": {
      const failedCycle = state.sip.cycles
        .filter((cycle) => cycle.status === "FAILED")
        .sort((left, right) => right.scheduledDate.localeCompare(left.scheduledDate))[0];
      return {
        type: "RETRY_PAYMENT",
        cycleId: failedCycle?.id ?? "__no_failed_demo_cycle__",
      };
    }
    case "MODIFY_AMOUNT":
      return input;
    case "MODIFY_DEBIT_DAY":
      return input;
    case "RESTART_SIP":
      return input;
  }
}

export function assistantActionToDomainRequest(
  proposed: AssistantProposedAction,
): SimulatedActionRequest | null {
  switch (proposed.type) {
    case "NONE":
      return null;
    case "RETRY_PAYMENT":
    case "MODIFY_AMOUNT":
    case "MODIFY_DEBIT_DAY":
    case "RESTART_SIP":
      return proposed;
  }
}

export function stateSummary(
  scenario: AssistantDemoScenario,
  state: DemoInvestorState,
): ActionStateSummary {
  const reward = getRewardProgress(state.sip.cycles);
  return {
    scenario,
    sip: {
      fundName: state.sip.fundName,
      monthlyAmount: state.sip.monthlyAmount,
      debitDay: state.sip.debitDay,
      status: state.sip.status,
    },
    rewardProgress: {
      eligibleInstalments: reward.eligibleInstalments,
      targetInstalments: reward.targetInstalments,
      isUnlocked: reward.isUnlocked,
    },
  };
}

export function toPublicActionPreview(input: {
  domainPreview: ActionPreview;
  source: ActionPreviewSource;
  scenario: AssistantDemoScenario;
  state: DemoInvestorState;
  pendingPreview: ActionDemoSession["pendingPreview"];
}): PublicActionPreview {
  const action = input.domainPreview.action;
  if (!action) throw new Error("The domain preview is missing its action.");

  return {
    previewId: input.pendingPreview?.previewId ?? null,
    source: input.source,
    sourceLabel:
      input.source === "DETERMINISTIC_DEMO_PRACTICE"
        ? "Deterministic demo practice — no AI used"
        : "AI-approved suggestion — deterministic preview",
    scenario: input.scenario,
    actionType: action.type,
    actionTitle: ACTION_TITLES[action.type],
    sipContext: {
      label: "Fictional SIP — Demo only",
      fundName: input.state.sip.fundName,
      monthlyAmount: input.state.sip.monthlyAmount,
      debitDay: input.state.sip.debitDay,
      status: input.state.sip.status,
    },
    proposedChange: input.domainPreview.effects[0] ?? null,
    eligibility: input.domainPreview.eligibility,
    effects: [...input.domainPreview.effects],
    errors: [...input.domainPreview.errors],
    expiresAt: input.pendingPreview?.expiresAt ?? null,
    requiresConfirmation: input.pendingPreview !== null &&
      input.domainPreview.requiresConfirmation,
  };
}

export function prepareActionPreview(input: {
  session: ActionDemoSession;
  action: SimulatedActionRequest;
  source: ActionPreviewSource;
  secret: string;
  nowMs: number;
}): {
  session: ActionDemoSession;
  token: string;
  preview: PublicActionPreview;
  status: ActionPreview["status"];
} {
  const domainPreview = previewSimulatedAction(
    input.session.state,
    input.action,
    demoClock.now(),
  );
  const pendingPreview =
    domainPreview.status === "PREVIEWED" && domainPreview.requiresConfirmation
      ? {
          previewId: randomUUID(),
          source: input.source,
          scenario: input.session.scenario,
          stateVersion: input.session.stateVersion,
          action: input.action,
          expiresAt: new Date(input.nowMs + ACTION_PREVIEW_TTL_MS).toISOString(),
        }
      : null;
  if (
    input.session.pendingPreview &&
    input.session.pendingPreview.previewId !== pendingPreview?.previewId
  ) {
    markActionPreviewConsumed(
      input.session.pendingPreview.previewId,
      Date.parse(input.session.pendingPreview.expiresAt),
      input.nowMs,
    );
  }
  const session: ActionDemoSession = {
    ...input.session,
    pendingPreview,
  };
  const token = signActionDemoSession(session, input.secret);
  return {
    session,
    token,
    status: domainPreview.status,
    preview: toPublicActionPreview({
      domainPreview,
      source: input.source,
      scenario: session.scenario,
      state: session.state,
      pendingPreview,
    }),
  };
}

export function resolveActionSession(input: {
  cookieHeader: string | null;
  scenario: AssistantDemoScenario;
  secret: string;
  nowMs: number;
}): { session: ActionDemoSession; replacedForScenario: boolean } | "INVALID" | "EXPIRED" {
  const stored = readSignedActionSession(
    input.cookieHeader,
    input.secret,
    input.nowMs,
  );
  if (stored.status === "INVALID") return "INVALID";
  if (stored.status === "EXPIRED") return "EXPIRED";
  if (stored.status === "MISSING") {
    return {
      session: createActionDemoSession(input.scenario, input.nowMs),
      replacedForScenario: false,
    };
  }
  if (stored.session.scenario !== input.scenario) {
    if (stored.session.pendingPreview) {
      markActionPreviewConsumed(
        stored.session.pendingPreview.previewId,
        Date.parse(stored.session.pendingPreview.expiresAt),
        input.nowMs,
      );
    }
    return {
      session: createActionDemoSession(input.scenario, input.nowMs),
      replacedForScenario: true,
    };
  }
  return { session: stored.session, replacedForScenario: false };
}

export function assistantStateFromSignedSession(input: {
  cookieHeader: string | null;
  scenario: AssistantDemoScenario;
  secret: string | undefined;
  nowMs: number;
}): ActionDemoSession | null {
  const stored = readSignedActionSession(
    input.cookieHeader,
    input.secret,
    input.nowMs,
  );
  if (stored.status !== "VALID" || stored.session.scenario !== input.scenario) {
    return null;
  }
  return stored.session;
}

export function createAiApprovedActionPreview(input: {
  cookieHeader: string | null;
  scenario: AssistantDemoScenario;
  state: DemoInvestorState;
  proposedAction: AssistantProposedAction;
  secret: string | undefined;
  nowMs: number;
}): { preview: PublicActionPreview; token: string; session: ActionDemoSession } | null {
  if (!input.secret) return null;
  const action = assistantActionToDomainRequest(input.proposedAction);
  if (!action) return null;

  const stored = readSignedActionSession(
    input.cookieHeader,
    input.secret,
    input.nowMs,
  );
  if (stored.status === "INVALID" || stored.status === "EXPIRED") return null;

  if (
    stored.status === "VALID" &&
    stored.session.scenario !== input.scenario &&
    stored.session.pendingPreview
  ) {
    markActionPreviewConsumed(
      stored.session.pendingPreview.previewId,
      Date.parse(stored.session.pendingPreview.expiresAt),
      input.nowMs,
    );
  }

  const session =
    stored.status === "VALID" && stored.session.scenario === input.scenario
      ? stored.session
      : {
          ...createActionDemoSession(input.scenario, input.nowMs),
          state: structuredClone(input.state),
        };
  const prepared = prepareActionPreview({
    session,
    action,
    source: "AI_APPROVED",
    secret: input.secret,
    nowMs: input.nowMs,
  });
  if (prepared.status !== "PREVIEWED" || !prepared.preview.requiresConfirmation) {
    return null;
  }
  return {
    preview: prepared.preview,
    token: prepared.token,
    session: prepared.session,
  };
}

export function confirmActionPreview(input: {
  session: ActionDemoSession;
  previewId: string;
  confirmed: boolean;
  nowMs: number;
}): {
  session: ActionDemoSession;
  response: ActionOperationResponse;
  consumed: boolean;
} {
  const session = input.session;
  const pending = session.pendingPreview;
  if (!pending || pending.previewId !== input.previewId) {
    return {
      session,
      response: {
        requestId: "",
        status: "PREVIEW_NOT_FOUND",
        message: "This preview is no longer active. Create a new preview.",
        stateSummary: stateSummary(session.scenario, session.state),
        result: null,
      },
      consumed: false,
    };
  }

  if (!input.confirmed) {
    const cancelled = { ...session, pendingPreview: null };
    return {
      session: cancelled,
      response: {
        requestId: "",
        status: "CANCELLED",
        message: "The simulated action was cancelled. No demo state changed.",
        stateSummary: stateSummary(cancelled.scenario, cancelled.state),
        result: null,
      },
      consumed: true,
    };
  }

  if (Date.parse(pending.expiresAt) <= input.nowMs) {
    const expired = { ...session, pendingPreview: null };
    return {
      session: expired,
      response: {
        requestId: "",
        status: "PREVIEW_EXPIRED",
        message: "This preview expired. Request a fresh simulated preview.",
        stateSummary: stateSummary(expired.scenario, expired.state),
        result: null,
      },
      consumed: true,
    };
  }

  if (
    pending.scenario !== session.scenario ||
    pending.stateVersion !== session.stateVersion
  ) {
    const stale = { ...session, pendingPreview: null };
    return {
      session: stale,
      response: {
        requestId: "",
        status: "STATE_CHANGED",
        message: "The demo state changed after preview. Create a new preview.",
        stateSummary: stateSummary(stale.scenario, stale.state),
        result: null,
      },
      consumed: true,
    };
  }

  const domainPreview = previewSimulatedAction(
    session.state,
    pending.action,
    demoClock.now(),
  );
  if (domainPreview.status !== "PREVIEWED") {
    const rejected = { ...session, pendingPreview: null };
    return {
      session: rejected,
      response: {
        requestId: "",
        status: domainPreview.status,
        message:
          domainPreview.errors[0] ??
          "The simulated action is no longer eligible for this demo state.",
        stateSummary: stateSummary(rejected.scenario, rejected.state),
        result: null,
      },
      consumed: true,
    };
  }

  const confirmation = confirmSimulatedAction(domainPreview, session.state, {
    confirmed: true,
    // Domain rules use the fixed demo clock; real preview expiry is checked above.
    confirmedAt: demoClock.now(),
  });
  const application = applyConfirmedAction(confirmation);

  if (!application.applied || !application.state || !application.event) {
    const rejected = { ...session, pendingPreview: null };
    const status: ActionOperationResponse["status"] =
      application.status === "TOKEN_EXPIRED"
        ? "PREVIEW_EXPIRED"
        : application.status === "STATE_CHANGED"
          ? "STATE_CHANGED"
          : application.status === "INVALID_PARAMS"
            ? "INVALID_PARAMS"
            : "NOT_ELIGIBLE";
    return {
      session: rejected,
      response: {
        requestId: "",
        status,
        message: application.message,
        stateSummary: stateSummary(rejected.scenario, rejected.state),
        result: null,
      },
      consumed: true,
    };
  }

  const updated: ActionDemoSession = {
    ...session,
    state: application.state,
    stateVersion: session.stateVersion + 1,
    pendingPreview: null,
  };
  return {
    session: updated,
    response: {
      requestId: "",
      status: "APPLIED_SIMULATED",
      message: application.message,
      stateSummary: stateSummary(updated.scenario, updated.state),
      result: {
        actionType: application.event.type,
        description: application.event.description,
        simulated: true,
        realPaymentMade: false,
        rewardProgressBefore: application.event.rewardProgressBefore,
        rewardProgressAfter: application.event.rewardProgressAfter,
      },
    },
    consumed: true,
  };
}

export function resetActionSession(
  scenario: AssistantDemoScenario,
  nowMs: number,
): ActionDemoSession {
  return createActionDemoSession(scenario, nowMs);
}

export function toOperationResponse(
  response: ActionOperationResponse,
  requestId: string,
): ActionOperationResponse {
  return { ...response, requestId };
}
