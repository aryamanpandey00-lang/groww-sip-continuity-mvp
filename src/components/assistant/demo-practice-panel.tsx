"use client";

import { useState, type FormEvent } from "react";
import type {
  ActionOperationResponse,
  PracticeActionInput,
  PublicActionPreview,
} from "@/lib/assistant/action-contracts";
import type { AssistantDemoScenario } from "@/lib/domain/fixtures/assistant-scenarios";
import { ActionPreviewCard } from "./action-preview-card";
import { ActionResultCard } from "./action-result-card";

type PracticeActionType = PracticeActionInput["type"];

export function DemoPracticePanel({
  scenario,
  preview,
  result,
  pending,
  error,
  onPreview,
  onReview,
  onReset,
  onDismissResult,
  onClearPreview,
}: {
  scenario: AssistantDemoScenario;
  preview: PublicActionPreview | null;
  result: ActionOperationResponse | null;
  pending: boolean;
  error: string | null;
  onPreview: (action: PracticeActionInput) => void;
  onReview: (preview: PublicActionPreview) => void;
  onReset: (scenario: AssistantDemoScenario) => void;
  onDismissResult: () => void;
  onClearPreview: () => void;
}) {
  const [actionType, setActionType] = useState<PracticeActionType>("RETRY_PAYMENT");
  const [amount, setAmount] = useState("6000");
  const [debitDay, setDebitDay] = useState("15");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let action: PracticeActionInput;

    switch (actionType) {
      case "RETRY_PAYMENT":
      case "RESTART_SIP":
        action = { type: actionType };
        break;
      case "MODIFY_AMOUNT":
        action = { type: actionType, amount: Number(amount) };
        break;
      case "MODIFY_DEBIT_DAY":
        action = { type: actionType, debitDay: Number(debitDay) };
        break;
    }
    onPreview(action);
  }

  const deterministicPreview =
    preview?.source === "DETERMINISTIC_DEMO_PRACTICE" ? preview : null;

  return (
    <section
      aria-labelledby="demo-practice-title"
      className="min-w-0 rounded-2xl border border-line bg-white p-4 shadow-card sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-groww-dark">
            Deterministic demo practice — no AI used
          </p>
          <h2 id="demo-practice-title" tabIndex={-1} className="mt-1 text-base font-semibold text-ink">
            Practice a simulated action
          </h2>
          <p className="mt-1 max-w-2xl break-words text-xs leading-5 text-muted">
            This path uses the existing rules engine and fictional {scenario} scenario. It works independently of assistant availability.
          </p>
        </div>
        <span className="rounded-full bg-groww-soft px-2.5 py-1 text-[10px] font-semibold text-groww-dark">
          Demo only
        </span>
      </div>

      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="practice-action-type" className="mb-1 block text-xs font-medium text-ink">
              Action to preview
            </label>
            <select
              id="practice-action-type"
              value={actionType}
              disabled={pending}
              onChange={(event) => {
                setActionType(event.target.value as PracticeActionType);
                onClearPreview();
              }}
              className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus-visible:border-groww-dark focus-visible:ring-2 focus-visible:ring-groww/20 disabled:opacity-60"
            >
              <option value="RETRY_PAYMENT">Retry failed payment</option>
              <option value="MODIFY_AMOUNT">Change monthly amount</option>
              <option value="MODIFY_DEBIT_DAY">Change debit day</option>
              <option value="RESTART_SIP">Restart paused SIP</option>
            </select>
          </div>
          {actionType === "MODIFY_AMOUNT" ? (
            <div>
              <label htmlFor="practice-amount" className="mb-1 block text-xs font-medium text-ink">
                Proposed monthly amount (₹)
              </label>
              <input
                id="practice-amount"
                type="number"
                value={amount}
                disabled={pending}
                onChange={(event) => {
                  setAmount(event.target.value);
                  onClearPreview();
                }}
                className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus-visible:border-groww-dark focus-visible:ring-2 focus-visible:ring-groww/20 disabled:opacity-60"
              />
            </div>
          ) : null}
          {actionType === "MODIFY_DEBIT_DAY" ? (
            <div>
              <label htmlFor="practice-debit-day" className="mb-1 block text-xs font-medium text-ink">
                Proposed debit day
              </label>
              <input
                id="practice-debit-day"
                type="number"
                value={debitDay}
                disabled={pending}
                onChange={(event) => {
                  setDebitDay(event.target.value);
                  onClearPreview();
                }}
                className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus-visible:border-groww-dark focus-visible:ring-2 focus-visible:ring-groww/20 disabled:opacity-60"
              />
            </div>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-groww px-4 py-2 text-xs font-semibold text-[#042f25] transition hover:bg-[#00bd8d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-groww-dark focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Checking…" : "Preview simulated action"}
        </button>
      </form>

      {error ? (
        <p role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          {error}
        </p>
      ) : null}

      {deterministicPreview ? (
        <ActionPreviewCard
          preview={deterministicPreview}
          onReview={() => onReview(deterministicPreview)}
          disabled={pending}
        />
      ) : null}

      {result ? (
        <ActionResultCard
          result={result}
          pending={pending}
          onReset={() => onReset(result.stateSummary.scenario)}
          onDismiss={onDismissResult}
        />
      ) : null}
    </section>
  );
}
