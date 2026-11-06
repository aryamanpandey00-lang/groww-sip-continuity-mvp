import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionConfirmationDialog } from "@/components/assistant/action-confirmation-dialog";
import { ActionPreviewCard } from "@/components/assistant/action-preview-card";
import { ActionResultCard } from "@/components/assistant/action-result-card";
import { DemoPracticePanel } from "@/components/assistant/demo-practice-panel";
import type {
  ActionOperationResponse,
  PublicActionPreview,
} from "@/lib/assistant/action-contracts";

const preview: PublicActionPreview = {
  previewId: "fefed75e-15cc-42f9-8672-18e13ea3d82b",
  source: "DETERMINISTIC_DEMO_PRACTICE",
  sourceLabel: "Deterministic demo practice — no AI used",
  scenario: "BASE",
  actionType: "MODIFY_AMOUNT",
  actionTitle: "Change the SIP amount",
  sipContext: {
    label: "Fictional SIP — Demo only",
    fundName: "Fictional Flexi Cap Fund — Demo Only",
    monthlyAmount: 5000,
    debitDay: 10,
    status: "ACTIVE",
  },
  proposedChange: "Monthly amount would change from ₹5,000 to ₹6,000.",
  eligibility: "ELIGIBLE",
  effects: ["Monthly amount would change from ₹5,000 to ₹6,000."],
  errors: [],
  expiresAt: "2026-11-12T10:15:00.000Z",
  requiresConfirmation: true,
};

const restartPreview: PublicActionPreview = {
  ...preview,
  scenario: "PAUSED_RESTART",
  actionType: "RESTART_SIP",
  actionTitle: "Restart a paused SIP",
  sipContext: { ...preview.sipContext, status: "PAUSED" },
  proposedChange: "SIP would continue in the demo from 2026-11-12.",
  effects: [
    "SIP would continue in the demo from 2026-11-12.",
    "Restart deadline: 2027-02-10.",
    "Reward progress remains at 11/12 eligible instalments.",
    "No real SIP restart will be made.",
  ],
};

const result: ActionOperationResponse = {
  requestId: "req_action_ui",
  status: "APPLIED_SIMULATED",
  message: "Simulated action applied. No real transaction occurred.",
  stateSummary: {
    scenario: "BASE",
    sip: {
      fundName: "Fictional Flexi Cap Fund — Demo Only",
      monthlyAmount: 6000,
      debitDay: 10,
      status: "ACTIVE",
    },
    rewardProgress: {
      eligibleInstalments: 11,
      targetInstalments: 12,
      isUnlocked: false,
    },
  },
  result: {
    actionType: "MODIFY_AMOUNT",
    description: "Simulated monthly amount change applied from 2026-12-10.",
    simulated: true,
    realPaymentMade: false,
    rewardProgressBefore: 11,
    rewardProgressAfter: 11,
  },
};

describe("simulated action UI", () => {
  it("labels deterministic practice separately and shows a reviewable preview", () => {
    const html = renderToStaticMarkup(createElement(DemoPracticePanel, {
      scenario: "BASE",
      preview,
      result: null,
      pending: false,
      error: null,
      onPreview: () => {},
      onReview: () => {},
      onReset: () => {},
      onDismissResult: () => {},
      onClearPreview: () => {},
    }));

    expect(html).toContain("Deterministic demo practice — no AI used");
    expect(html).toContain("Preview simulated action");
    expect(html).toContain("Review and confirm");
    expect(html).toContain('id="demo-practice-title" tabindex="-1"');
    expect(html).toContain("Fictional SIP — Demo only");
  });

  it("renders plain text preview details and escapes untrusted-looking content", () => {
    const html = renderToStaticMarkup(createElement(ActionPreviewCard, {
      preview: {
        ...preview,
        sipContext: {
          ...preview.sipContext,
          fundName: "<img src=x onerror=alert(1)>",
        },
      },
      onReview: () => {},
    }));

    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("Eligible in demo");
    expect(html).toContain("Valid until 2026-11-12T10:15:00.000Z");
  });

  it("shows the restart summary once while preserving deadline, reward progress, and demo safety effects", () => {
    const html = renderToStaticMarkup(createElement(ActionPreviewCard, {
      preview: restartPreview,
      onReview: () => {},
    }));

    expect(html.match(/SIP would continue in the demo from 2026-11-12\./g)).toHaveLength(1);
    expect(html).toContain("Restart deadline: 2027-02-10.");
    expect(html).toContain("Reward progress remains at 11/12 eligible instalments.");
    expect(html).toContain("No real SIP restart will be made.");
  });

  it("explains an ineligible preview without offering confirmation", () => {
    const html = renderToStaticMarkup(createElement(ActionPreviewCard, {
      preview: {
        ...preview,
        previewId: null,
        eligibility: "NOT_ELIGIBLE",
        requiresConfirmation: false,
        errors: ["The SIP is already active."],
      },
      onReview: () => {},
    }));

    expect(html).toContain("Not eligible");
    expect(html).toContain("The SIP is already active.");
    expect(html).not.toContain("Review and confirm");
  });

  it("requires explicit confirmation and exposes keyboard-friendly confirm and cancel controls", () => {
    const html = renderToStaticMarkup(createElement(ActionConfirmationDialog, {
      open: true,
      preview,
      pending: false,
      error: "The simulated action could not be completed. Please try again.",
      onConfirm: () => {},
      onCancel: () => {},
    }));

    expect(html).toContain('aria-modal');
    expect(html).toContain('aria-labelledby="simulated-action-confirm-title"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("autofocus");
    expect(html).toContain("Confirm simulated action");
    expect(html).toContain("Cancel");
    expect(html).toContain("No real payment, investment, or account change will occur");
    expect(html).not.toContain("<dialog open");
  });

  it("shows simulated results and the static-dashboard limitation", () => {
    const html = renderToStaticMarkup(createElement(ActionResultCard, {
      result,
      onReset: () => {},
      onDismiss: () => {},
    }));

    expect(html).toContain("Simulated update applied");
    expect(html).toContain("No real payment was made");
    expect(html).toContain("dashboard remains an independent static demo snapshot");
    expect(html).toContain("Reset demo scenario");
    expect(html).toContain('role="status"');
  });

  it("keeps client components isolated from server sessions and real execution functions", () => {
    const root = "src/components/assistant";
    const files = fs.readdirSync(root).filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
    const source = files.map((file) => fs.readFileSync(`${root}/${file}`, "utf8")).join("\n");

    expect(source).not.toMatch(/action-session|action-api-handler|server-only/);
    expect(source).not.toMatch(/applyConfirmedAction|confirmSimulatedAction/);
    expect(source).not.toContain("dangerouslySetInnerHTML");
  });
});
