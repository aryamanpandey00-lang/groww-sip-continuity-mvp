"use client";

import { useEffect, useRef, useState } from "react";
import { AssistantComposer } from "./assistant-composer";
import { AssistantApiClientError, requestAssistant } from "./api-client";
import {
  AssistantActionRequestGuard,
  AssistantRequestGuard,
  clearedAssistantConversation,
  createAssistantJourneySelectionState,
  createModifyClarificationContext,
  prepareModifyClarification,
} from "./assistant-logic";
import { ConversationThread } from "./conversation-thread";
import { JourneyPicker } from "./journey-picker";
import { toAssistantRequest, type AssistantJourney } from "./journeys";
import type {
  ConversationMessage,
  ModifyClarificationContext,
} from "./assistant-types";
import type { AssistantApiRequest } from "@/lib/assistant/contracts";
import type {
  ActionOperationResponse,
  PracticeActionInput,
  PublicActionPreview,
} from "@/lib/assistant/action-contracts";
import { InfoIcon } from "@/components/ui/icons";
import {
  ActionApiClientError,
  confirmActionPreviewRequest,
  requestActionPreview,
  resetActionDemo,
} from "./action-api-client";
import { ActionConfirmationDialog } from "./action-confirmation-dialog";
import { DemoPracticePanel } from "./demo-practice-panel";

interface RetryPayload {
  request: AssistantApiRequest;
  modifyContext: ModifyClarificationContext | null;
}

interface RequestErrorState {
  message: string;
  retry: RetryPayload;
}

function messageId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `message-${Date.now()}-${Math.random()}`;
}

function userFacingRequestError(error: unknown): string {
  if (error instanceof AssistantApiClientError) return error.message;
  return "The assistant could not be reached. Check your connection and try again.";
}

function userFacingActionError(error: unknown): string {
  if (error instanceof ActionApiClientError) return error.message;
  return "The simulated action could not be completed. Please try again.";
}

export function AssistantClient() {
  const [journey, setJourney] = useState<AssistantJourney | null>(null);
  const [journeyPickerOpen, setJourneyPickerOpen] = useState(true);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [composerText, setComposerText] = useState("");
  const [pending, setPending] = useState(false);
  const [requestError, setRequestError] = useState<RequestErrorState | null>(null);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const [modifyContext, setModifyContext] =
    useState<ModifyClarificationContext | null>(null);
  const [actionPreview, setActionPreview] =
    useState<PublicActionPreview | null>(null);
  const [actionResult, setActionResult] =
    useState<ActionOperationResponse | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const actionInFlight = useRef(false);
  const actionRequestGuard = useRef<AssistantActionRequestGuard | null>(null);
  const requestGuard = useRef<AssistantRequestGuard | null>(null);
  const activeController = useRef<AbortController | null>(null);

  if (requestGuard.current === null) {
    requestGuard.current = new AssistantRequestGuard();
  }
  if (actionRequestGuard.current === null) {
    actionRequestGuard.current = new AssistantActionRequestGuard();
  }

  useEffect(
    () => () => {
      requestGuard.current?.invalidate();
      activeController.current?.abort();
    },
    [],
  );

  function selectJourney(nextJourney: AssistantJourney) {
    requestGuard.current?.invalidate();
    actionRequestGuard.current?.invalidate();
    activeController.current?.abort();
    activeController.current = null;
    const selection = createAssistantJourneySelectionState(nextJourney);
    setPending(selection.pending);
    setJourney(selection.journey);
    setJourneyPickerOpen(selection.journeyPickerOpen);
    setMessages(selection.messages);
    setRequestError(null);
    setLocalNotice(selection.localNotice);
    setModifyContext(selection.modifyContext);
    setComposerText(selection.composerText);
    setActionPreview(selection.actionPreview);
    setActionResult(selection.actionResult);
    setActionError(selection.actionError);
    setConfirmationOpen(selection.confirmationOpen);
  }

  function clearConversation() {
    requestGuard.current?.invalidate();
    activeController.current?.abort();
    activeController.current = null;
    const cleared = clearedAssistantConversation();
    setPending(cleared.pending);
    setMessages(cleared.messages);
    setComposerText(cleared.composerText);
    setRequestError(cleared.error);
    setLocalNotice(cleared.localNotice);
    setModifyContext(cleared.modifyContext);
  }

  async function performRequest(
    retryPayload: RetryPayload,
    appendUserMessage: string | null,
  ) {
    const guard = requestGuard.current;
    const token = guard?.begin();

    if (token === undefined || token === null) return;

    const controller = new AbortController();
    activeController.current = controller;
    setPending(true);
    setRequestError(null);
    setLocalNotice(null);

    if (appendUserMessage !== null) {
      setMessages((current) => [
        ...current,
        { id: messageId(), kind: "user", text: appendUserMessage },
      ]);
    }

    try {
      const response = await requestAssistant(retryPayload.request, controller.signal);

      if (!guard?.isCurrent(token)) return;

      setMessages((current) => [
        ...current,
        { id: response.requestId || messageId(), kind: "assistant", response },
      ]);
      if (response.actionPreview) {
        setActionPreview(response.actionPreview);
        setActionResult(null);
        setActionError(null);
        setConfirmationOpen(false);
      }

      if (
        journey?.id === "MODIFY_SIP" &&
        response.status === "NEEDS_MORE_INFORMATION"
      ) {
        setModifyContext(
          retryPayload.modifyContext ??
            createModifyClarificationContext(retryPayload.request.question),
        );
      } else {
        setModifyContext(null);
      }
    } catch (error) {
      if (!guard?.isCurrent(token) || controller.signal.aborted) return;
      setRequestError({
        message: userFacingRequestError(error),
        retry: retryPayload,
      });
    } finally {
      if (guard?.finish(token)) {
        activeController.current = null;
        setPending(false);
      }
    }
  }

  function submitQuestion() {
    if (
      !journey ||
      pending ||
      actionInFlight.current ||
      composerText.trim().length === 0
    ) return;

    const visibleQuestion = composerText.trim();
    let apiQuestion = visibleQuestion;
    let nextModifyContext: ModifyClarificationContext | null = null;

    if (journey.id === "MODIFY_SIP") {
      if (modifyContext) {
        const prepared = prepareModifyClarification(visibleQuestion, modifyContext);
        nextModifyContext = prepared.context;

        if (!prepared.ok) {
          setMessages((current) => [
            ...current,
            { id: messageId(), kind: "user", text: visibleQuestion },
          ]);
          setLocalNotice(prepared.message);
          setComposerText("");
          setModifyContext(prepared.context);
          return;
        }

        apiQuestion = prepared.question;
        nextModifyContext = prepared.context;
      } else {
        nextModifyContext = createModifyClarificationContext(visibleQuestion);
      }
    }

    const request = toAssistantRequest(apiQuestion, journey);
    setComposerText("");
    void performRequest(
      { request, modifyContext: nextModifyContext },
      visibleQuestion,
    );
  }

  function retryFailedRequest() {
    if (!requestError || pending) return;
    void performRequest(requestError.retry, null);
  }

  async function requestPracticeAction(action: PracticeActionInput) {
    if (actionInFlight.current || pending) return;
    const actionToken = actionRequestGuard.current?.begin();
    if (actionToken === undefined) return;
    actionInFlight.current = true;
    setActionPending(true);
    setActionError(null);
    setActionResult(null);
    setConfirmationOpen(false);
    try {
      const response = await requestActionPreview({
        scenario: journey?.demoScenario ?? "BASE",
        action,
      });
      if (actionRequestGuard.current?.isCurrent(actionToken)) {
        setActionPreview(response.preview);
      }
    } catch (error) {
      if (actionRequestGuard.current?.isCurrent(actionToken)) {
        setActionError(userFacingActionError(error));
      }
    } finally {
      actionInFlight.current = false;
      setActionPending(false);
    }
  }

  function reviewActionPreview(preview: PublicActionPreview) {
    if (
      actionInFlight.current ||
      !actionPreview?.previewId ||
      preview.previewId !== actionPreview.previewId ||
      !preview.requiresConfirmation
    ) return;
    setActionError(null);
    setConfirmationOpen(true);
  }

  async function confirmActiveAction(confirmed: boolean) {
    const previewId = actionPreview?.previewId;
    if (!previewId || actionInFlight.current) return;
    const actionToken = actionRequestGuard.current?.begin();
    if (actionToken === undefined) return;
    actionInFlight.current = true;
    setActionPending(true);
    setActionError(null);
    try {
      const response = await confirmActionPreviewRequest({ previewId, confirmed });
      if (!actionRequestGuard.current?.isCurrent(actionToken)) return;
      setActionPreview(null);
      setActionResult(response);
      setConfirmationOpen(false);
    } catch (error) {
      if (!actionRequestGuard.current?.isCurrent(actionToken)) return;
      setActionError(userFacingActionError(error));
      if (error instanceof ActionApiClientError &&
        ["INVALID_SESSION", "SESSION_EXPIRED", "PREVIEW_NOT_FOUND"].includes(String(error.code))) {
        setActionPreview(null);
        setConfirmationOpen(false);
      }
    } finally {
      actionInFlight.current = false;
      setActionPending(false);
    }
  }

  async function resetActionScenario(scenario: "BASE" | "PAUSED_RESTART") {
    if (actionInFlight.current) return;
    const actionToken = actionRequestGuard.current?.begin();
    if (actionToken === undefined) return;
    actionInFlight.current = true;
    setActionPending(true);
    setActionError(null);
    setConfirmationOpen(false);
    try {
      const response = await resetActionDemo({ scenario });
      if (!actionRequestGuard.current?.isCurrent(actionToken)) return;
      setActionPreview(null);
      setActionResult(response);
    } catch (error) {
      if (actionRequestGuard.current?.isCurrent(actionToken)) {
        setActionError(userFacingActionError(error));
      }
    } finally {
      actionInFlight.current = false;
      setActionPending(false);
    }
  }

  function clearPracticePreview() {
    setActionPreview((current) =>
      current?.source === "DETERMINISTIC_DEMO_PRACTICE" ? null : current,
    );
    setActionError(null);
  }

  const threadError = requestError
    ? { message: requestError.message, retryRequest: retryFailedRequest }
    : localNotice
      ? { message: localNotice, retryRequest: null }
      : null;

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
      <section className="min-w-0 overflow-hidden rounded-2xl border border-line bg-white shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-4 sm:p-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-groww-dark">
              Demo account · Simulated SIP
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-ink">
              SIP continuity help
            </h2>
            {journey ? (
              <p className="mt-1 text-xs leading-5 text-muted">
                {journey.title} · {journey.scenarioNote}
              </p>
            ) : (
              <p className="mt-1 text-xs leading-5 text-muted">
                Select a journey to begin.
              </p>
            )}
          </div>
          {journey ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setJourneyPickerOpen((open) => !open)}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-line bg-white px-3.5 py-2 text-xs font-semibold text-ink transition hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-groww-dark focus-visible:ring-offset-2"
                aria-expanded={journeyPickerOpen}
                aria-controls={journeyPickerOpen ? "assistant-journeys" : undefined}
              >
                {journeyPickerOpen ? "Hide journeys" : "Change journey"}
              </button>
              <button
                type="button"
                onClick={clearConversation}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-line bg-white px-3.5 py-2 text-xs font-semibold text-muted transition hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-groww-dark focus-visible:ring-offset-2"
              >
                Clear conversation
              </button>
            </div>
          ) : null}
        </div>

        {journeyPickerOpen ? (
          <div id="assistant-journeys" className="border-b border-line p-3 sm:p-4">
            <JourneyPicker
              selectedCategory={journey?.id ?? null}
              onSelect={selectJourney}
              disabled={actionPending}
            />
          </div>
        ) : null}

        {journey ? (
          <>
            <ConversationThread
              messages={messages}
              pending={pending}
              error={threadError}
              activeActionPreview={actionPreview}
              actionPending={actionPending}
              onReviewAction={reviewActionPreview}
            />
            <AssistantComposer
              value={composerText}
              disabled={pending || actionPending}
              onChange={(value) => {
                setComposerText(value);
                setLocalNotice(null);
              }}
              onSubmit={submitQuestion}
            />
            <div className="mx-3 mb-4 sm:mx-4">
              <DemoPracticePanel
                scenario={journey.demoScenario}
                preview={actionPreview}
                result={actionResult}
                pending={actionPending}
                error={confirmationOpen ? null : actionError}
                onPreview={requestPracticeAction}
                onReview={reviewActionPreview}
                onReset={resetActionScenario}
                onDismissResult={() => setActionResult(null)}
                onClearPreview={clearPracticePreview}
              />
            </div>
          </>
        ) : (
          <div className="p-4 text-xs leading-5 text-muted">
            Choose one of the six journeys above to load a suggested question.
          </div>
        )}
      </section>

      <aside className="grid min-w-0 gap-3">
        <div className="rounded-2xl border border-groww/20 bg-groww-soft/70 p-4">
          <div className="flex items-start gap-2.5">
            <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-groww-dark" />
            <div>
              <h3 className="text-xs font-semibold text-ink">Demo only</h3>
              <p className="mt-1 text-xs leading-5 text-muted">
                All account details and policy examples are fictional. No real
                payment will be made. A fictional reward is not redeemable.
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-white p-4">
          <h3 className="text-xs font-semibold text-ink">How this chat works</h3>
          <p className="mt-1 text-xs leading-5 text-muted">
            Only your current question and the selected demo journey are sent.
            Earlier chat messages are not included. Repeat relevant context in
            a follow-up; SIP-change clarifications reuse only the amount or day
            values you provide to form a standalone question.
          </p>
        </div>
      </aside>
      <ActionConfirmationDialog
        open={confirmationOpen}
        preview={actionPreview}
        pending={actionPending}
        error={actionError}
        onConfirm={() => void confirmActiveAction(true)}
        onCancel={() => void confirmActiveAction(false)}
      />
    </div>
  );
}
