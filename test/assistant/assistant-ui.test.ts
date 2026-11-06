import fs from "node:fs";
import path from "node:path";
import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantMessage } from "@/components/assistant/assistant-message";
import { requestAssistant, isAssistantApiResponse } from "@/components/assistant/api-client";
import {
  AssistantActionRequestGuard,
  AssistantRequestGuard,
  clearedAssistantConversation,
  createAssistantJourneySelectionState,
  createModifyClarificationContext,
  prepareModifyClarification,
  shouldSubmitAssistantMessage,
} from "@/components/assistant/assistant-logic";
import { ASSISTANT_JOURNEYS, toAssistantRequest } from "@/components/assistant/journeys";
import { safeCitationUrl } from "@/components/assistant/citation-list";
import { AssistantComposer } from "@/components/assistant/assistant-composer";
import { JourneyPicker } from "@/components/assistant/journey-picker";
import { DemoDataNote } from "@/components/dashboard/demo-data-note";
import type { AssistantJourney } from "@/components/assistant/journeys";
import AssistantPage from "@/app/assistant/page";
import type { AssistantApiResponse } from "@/lib/assistant/contracts";

const evidenceCitation = {
  evidenceId: "education.sip-basics",
  title: "SIP basics",
  sourceTier: "general_education" as const,
  sourceLabel: "General investor education",
  sourceName: "Investor education source",
  excerpt: "A SIP invests a chosen amount at regular intervals.",
  verificationStatus: "verified" as const,
  verificationLabel: "Verified educational source",
  sourceUrl: "https://example.org/sip-basics",
  sourceDate: "2026-01-01",
  applicableDemoPolicyVersion: null,
};

const approvedResponse: AssistantApiResponse = {
  requestId: "req_ui_test",
  status: "APPROVED",
  intent: "PAYMENT_FAILED",
  directAnswer: "This is a fictional demo payment status.",
  keyPoints: ["No real payment will be made."],
  followUpQuestion: "Would you like to know about the demo retry window?",
  qualityLabel: "Evidence-backed",
  fallbackUsed: false,
  citations: [evidenceCitation],
  actionPreview: null,
  executionPerformed: false,
};

const unavailableResponse: AssistantApiResponse = {
  ...approvedResponse,
  status: "UNAVAILABLE",
  intent: "GENERAL_SIP_EDUCATION",
  directAnswer: "The assistant is currently disabled. No request was sent to the model.",
  keyPoints: [],
  followUpQuestion: "",
  qualityLabel: "Assistant unavailable",
  fallbackUsed: true,
  citations: [],
};

interface JourneyButtonProps {
  "aria-pressed"?: boolean;
  children?: ReactNode;
  onClick?: () => void;
}

function findJourneyButtons(node: ReactNode): ReactElement<JourneyButtonProps>[] {
  if (Array.isArray(node)) return node.flatMap(findJourneyButtons);
  if (!isValidElement(node)) return [];

  const element = node as ReactElement<JourneyButtonProps>;
  const descendants = findJourneyButtons(element.props.children);
  return element.type === "button" ? [element, ...descendants] : descendants;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("assistant page and journey selection", () => {
  it("renders the assistant page with six selectable journeys", () => {
    const html = renderToStaticMarkup(createElement(AssistantPage));

    expect(html).toContain("SIP continuity");
    expect(html).toContain("What would you like help with?");
    expect(html).toContain("Demo account only");
    expect(html).toContain("max-w-6xl");
    expect(html).toContain("min-w-0");
    expect(html).toContain("sm:grid-cols-2");
    expect(ASSISTANT_JOURNEYS).toHaveLength(6);
    for (const journey of ASSISTANT_JOURNEYS) {
      expect(html).toContain(journey.title);
    }
  });

  it("maps all six journeys to the exact API category and server scenario", () => {
    expect(
      ASSISTANT_JOURNEYS.map(({ id, demoScenario }) => [id, demoScenario]),
    ).toEqual([
      ["INSUFFICIENT_FUNDS", "BASE"],
      ["PAYMENT_FAILED", "BASE"],
      ["MARKET_UNCERTAINTY", "BASE"],
      ["MODIFY_SIP", "BASE"],
      ["RESTART_SIP", "PAUSED_RESTART"],
      ["REWARD_MILESTONE", "BASE"],
    ]);
    expect(
      ASSISTANT_JOURNEYS.find((journey) => journey.id === "RESTART_SIP")?.scenarioNote,
    ).toContain("PAUSED_RESTART");
    expect(
      ASSISTANT_JOURNEYS.find((journey) => journey.id === "PAYMENT_FAILED")?.scenarioNote,
    ).toContain("failed cycle");
    expect(
      ASSISTANT_JOURNEYS.find((journey) => journey.id === "REWARD_MILESTONE")?.scenarioNote,
    ).toContain("not redeemable");
  });

  it("invokes each journey card click handler and produces persistent selected state", () => {
    const onSelect = vi.fn<(journey: AssistantJourney) => void>();
    const initialButtons = findJourneyButtons(
      JourneyPicker({ selectedCategory: null, onSelect }),
    );

    expect(initialButtons).toHaveLength(6);

    for (let index = 0; index < ASSISTANT_JOURNEYS.length; index += 1) {
      const journey = ASSISTANT_JOURNEYS[index]!;
      const button = initialButtons[index]!;
      expect(button.props["aria-pressed"]).toBe(false);
      expect(button.props.onClick).toBeTypeOf("function");

      button.props.onClick?.();
      const selectedJourney = onSelect.mock.lastCall?.[0];
      expect(selectedJourney).toEqual(journey);

      const selection = createAssistantJourneySelectionState(selectedJourney!);
      expect(selection).toMatchObject({
        journey: {
          id: journey.id,
          demoScenario: journey.demoScenario,
        },
        journeyPickerOpen: true,
        composerText: journey.starterQuestion,
      });
      expect(toAssistantRequest(selection.composerText, selection.journey)).toMatchObject({
        selectedCategory: journey.id,
        demoScenario: journey.demoScenario,
      });

      const selectedButtons = findJourneyButtons(
        JourneyPicker({ selectedCategory: selection.journey.id, onSelect }),
      );
      expect(selectedButtons.filter((item) => item.props["aria-pressed"])).toHaveLength(1);
      expect(selectedButtons[index]?.props["aria-pressed"]).toBe(true);

      if (journey.id === "RESTART_SIP") {
        const restartCard = selectedButtons[index]?.props.children as ReactElement<{
          className?: string;
        }>;
        expect(restartCard.props.className).toContain("border-groww/50");
        expect(journey.scenarioNote).toContain("PAUSED_RESTART");
        const composer = renderToStaticMarkup(
          createElement(AssistantComposer, {
            value: selection.composerText,
            disabled: false,
            onChange: () => {},
            onSubmit: () => {},
          }),
        );
        expect(composer).toContain(journey.starterQuestion);
      }
    }
  });

  it("clears action previews and results when a new journey is selected", () => {
    const selection = createAssistantJourneySelectionState(ASSISTANT_JOURNEYS[4]!);

    expect(selection).toMatchObject({
      journey: { id: "RESTART_SIP", demoScenario: "PAUSED_RESTART" },
      actionPreview: null,
      actionResult: null,
      actionError: null,
      confirmationOpen: false,
    });
  });

  it("invalidates action responses after the selected journey changes", () => {
    const guard = new AssistantActionRequestGuard();
    const requestToken = guard.begin();

    guard.invalidate();

    expect(guard.isCurrent(requestToken)).toBe(false);
    expect(guard.isCurrent(guard.begin())).toBe(true);
  });

  it("builds a request with only the current question, category, and scenario", () => {
    const restart = ASSISTANT_JOURNEYS.find(
      (journey) => journey.id === "RESTART_SIP",
    );
    expect(restart).toBeDefined();
    const request = toAssistantRequest("  Can I restart it?  ", restart!);

    expect(request).toEqual({
      question: "Can I restart it?",
      selectedCategory: "RESTART_SIP",
      demoScenario: "PAUSED_RESTART",
    });
    expect(Object.keys(request).sort()).toEqual([
      "demoScenario",
      "question",
      "selectedCategory",
    ]);
  });
});

describe("assistant message rendering and citations", () => {
  it("renders approved answers, key points, follow-up, quality, and evidence", () => {
    const html = renderToStaticMarkup(
      createElement(AssistantMessage, { response: approvedResponse }),
    );

    expect(html).toContain("This is a fictional demo payment status.");
    expect(html).toContain("No real payment will be made.");
    expect(html).toContain("Follow-up question");
    expect(html).toContain("Would you like to know about the demo retry window?");
    expect(html).toContain("Evidence-backed");
    expect(html).toContain("General investor education");
    expect(html).toContain("SIP basics");
    expect(html).toContain("Investor education source");
    expect(html).toContain("No action has been taken.");
    expect(html).toContain('href="https://example.org/sip-basics"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("renders unavailable and fallback states without presenting them as verified", () => {
    const html = renderToStaticMarkup(
      createElement(AssistantMessage, { response: unavailableResponse }),
    );

    expect(html).toContain("Assistant unavailable");
    expect(html.match(/>Assistant unavailable<\/span>/g)).toHaveLength(1);
    expect(html).toContain("No verified answer was generated");
    expect(html).toContain("fallback response from the demo assistant");
    expect(html).toContain("Do not treat it as a verified Groww policy statement");
  });

  it("keeps status and quality labels when they communicate different information", () => {
    const html = renderToStaticMarkup(
      createElement(AssistantMessage, { response: approvedResponse }),
    );

    expect(html).toContain("Evidence-backed");
    expect(html).toContain("Passed automated safety checks");
  });

  it("shows a synonymous needs-information status only once", () => {
    const response: AssistantApiResponse = {
      ...approvedResponse,
      status: "NEEDS_MORE_INFORMATION",
      qualityLabel: "Need more information",
    };
    const html = renderToStaticMarkup(
      createElement(AssistantMessage, { response }),
    );

    expect(html).toContain("Need more information");
    expect(html).not.toContain("More information needed");
  });

  it("renders AI content as escaped text and does not link unsafe citation URLs", () => {
    const unsafeResponse: AssistantApiResponse = {
      ...approvedResponse,
      directAnswer: "<script>alert('x')</script>",
      citations: [
        { ...evidenceCitation, sourceUrl: "javascript:alert(1)" },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(AssistantMessage, { response: unsafeResponse }),
    );

    expect(html).toContain("&lt;script&gt;alert(&#x27;x&#x27;)&lt;/script&gt;");
    expect(html).toContain("break-words whitespace-pre-wrap");
    expect(html).not.toContain("href=\"javascript:");
    expect(safeCitationUrl("data:text/html,hello")).toBeNull();
    expect(safeCitationUrl("https://user:pass@example.org")).toBeNull();
    expect(safeCitationUrl("https://example.org/source")).toBe(
      "https://example.org/source",
    );
  });
});

describe("dashboard demo snapshot notice", () => {
  it("explains that assistant-session changes do not update the dashboard", () => {
    const html = renderToStaticMarkup(createElement(DemoDataNote));

    expect(html).toContain("Assistant demo-session changes do not update this dashboard.");
    expect(html).toContain("No real account, market feed, payment or redeemable reward is connected.");
  });
});

describe("assistant API client and clarification behavior", () => {
  it("sends only the Phase 6B request contract and parses the public response DTO", async () => {
    const fetchMock = vi.fn(
      async (...args: Parameters<typeof fetch>) => {
        void args;
        return new Response(JSON.stringify(approvedResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const journey = ASSISTANT_JOURNEYS[1];

    const response = await requestAssistant(
      toAssistantRequest(journey.starterQuestion, journey),
    );

    expect(response).toEqual(approvedResponse);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/assistant",
      expect.objectContaining({ method: "POST" }),
    );
    const init = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({
      question: journey.starterQuestion,
      selectedCategory: "PAYMENT_FAILED",
      demoScenario: "BASE",
    });
    expect(isAssistantApiResponse({ ...approvedResponse, actionPreview: {} })).toBe(
      false,
    );
    expect(isAssistantApiResponse({ ...approvedResponse, executionPerformed: true })).toBe(
      false,
    );
  });

  it("posts the allowlisted category and scenario for every journey", async () => {
    const sentBodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        sentBodies.push(JSON.parse(String(init?.body)) as unknown);
        return new Response(JSON.stringify(approvedResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    for (const journey of ASSISTANT_JOURNEYS) {
      await requestAssistant(toAssistantRequest(journey.starterQuestion, journey));
    }

    expect(sentBodies).toEqual(
      ASSISTANT_JOURNEYS.map((journey) => ({
        question: journey.starterQuestion,
        selectedCategory: journey.id,
        demoScenario: journey.demoScenario,
      })),
    );
    for (const body of sentBodies) {
      expect(Object.keys(body as Record<string, unknown>).sort()).toEqual([
        "demoScenario",
        "question",
        "selectedCategory",
      ]);
      expect(JSON.stringify(body)).not.toMatch(/balance|evidence|policy|permission|history|api.?key/i);
    }
  });

  it("handles API error DTOs with a bounded client-safe message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            requestId: "req_error",
            error: {
              code: "RATE_LIMITED",
              message: "Too many assistant requests. Please try again shortly.",
            },
          }),
          { status: 429 },
        ),
      ),
    );
    const journey = ASSISTANT_JOURNEYS[0];

    await expect(
      requestAssistant(toAssistantRequest("Please help", journey)),
    ).rejects.toMatchObject({
      name: "AssistantApiClientError",
      code: "RATE_LIMITED",
      message: "Too many assistant requests. Please try again shortly.",
    });
  });

  it("reconstructs only explicitly supplied SIP amount and debit-day values", () => {
    const initial = createModifyClarificationContext(
      "I want to change my monthly SIP amount and debit day.",
    );
    const amountOnly = prepareModifyClarification("₹6,000", initial);
    expect(amountOnly.ok).toBe(false);
    if (amountOnly.ok) return;

    const both = prepareModifyClarification("day 15", amountOnly.context);
    expect(both).toMatchObject({
      ok: true,
      question:
        "I want to change my SIP monthly amount to ₹6000 and debit day to 15. Explain the fictional demo rules.",
    });
    expect(prepareModifyClarification("yes", initial).ok).toBe(false);
  });

  it("sends a bounded standalone modify clarification without transcript history", async () => {
    const sentBodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        sentBodies.push(JSON.parse(String(init?.body)) as unknown);
        return new Response(JSON.stringify(approvedResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    const journey = ASSISTANT_JOURNEYS.find((item) => item.id === "MODIFY_SIP")!;
    const context = createModifyClarificationContext(
      "I want to change my monthly SIP amount and debit day.",
    );
    const amountAnswer = prepareModifyClarification("₹6,000", context);
    expect(amountAnswer.ok).toBe(false);
    if (amountAnswer.ok) return;
    const complete = prepareModifyClarification("day 15", amountAnswer.context);
    expect(complete.ok).toBe(true);
    if (!complete.ok) return;

    await requestAssistant(toAssistantRequest(complete.question, journey));

    expect(sentBodies).toEqual([{
      question: "I want to change my SIP monthly amount to ₹6000 and debit day to 15. Explain the fictional demo rules.",
      selectedCategory: "MODIFY_SIP",
      demoScenario: "BASE",
    }]);
    expect(JSON.stringify(sentBodies)).not.toContain("monthly SIP amount and debit day.");
  });

  it("handles Enter, Shift+Enter, and IME composition deliberately", () => {
    expect(
      shouldSubmitAssistantMessage({ key: "Enter", shiftKey: false, isComposing: false }),
    ).toBe(true);
    expect(
      shouldSubmitAssistantMessage({ key: "Enter", shiftKey: true, isComposing: false }),
    ).toBe(false);
    expect(
      shouldSubmitAssistantMessage({ key: "Enter", shiftKey: false, isComposing: true }),
    ).toBe(false);
  });

  it("prevents duplicate in-flight submissions and ignores stale requests", () => {
    const guard = new AssistantRequestGuard();
    const first = guard.begin();
    expect(first).not.toBeNull();
    expect(guard.begin()).toBeNull();

    guard.invalidate();
    const current = guard.begin();
    expect(current).not.toBeNull();
    expect(guard.isCurrent(first!)).toBe(false);
    expect(guard.isCurrent(current!)).toBe(true);
    expect(guard.finish(first!)).toBe(false);
    expect(guard.finish(current!)).toBe(true);
  });

  it("clears transcript, pending notice, and clarification data", () => {
    expect(clearedAssistantConversation()).toEqual({
      messages: [],
      composerText: "",
      pending: false,
      error: null,
      localNotice: null,
      modifyContext: null,
    });
  });

  it("keeps client components away from server-only AI and action execution modules", () => {
    const root = "src/components/assistant";
    const files = fs
      .readdirSync(root)
      .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
    const source = files
      .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
      .join("\n");

    expect(source).not.toMatch(/lib\/ai|lib\\ai|server-only/);
    expect(source).not.toContain("dangerouslySetInnerHTML");
    expect(source).not.toMatch(/confirmSimulatedAction|applyConfirmedAction/);
  });
});
