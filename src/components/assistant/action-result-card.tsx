import type { ActionOperationResponse } from "@/lib/assistant/action-contracts";
import { formatInr } from "@/lib/utils/format";

export function ActionResultCard({
  result,
  pending = false,
  onReset,
  onDismiss,
}: {
  result: ActionOperationResponse;
  pending?: boolean;
  onReset: () => void;
  onDismiss: () => void;
}) {
  const applied = result.status === "APPLIED_SIMULATED";
  const cancelled = result.status === "CANCELLED";

  return (
    <section
      role="status"
      aria-live="polite"
      aria-label="Simulated action result"
      className={`mt-4 rounded-2xl border p-4 ${
        applied
          ? "border-groww/30 bg-groww-soft/50"
          : cancelled
            ? "border-line bg-white"
            : "border-amber-200 bg-amber-50"
      }`}
    >
      <h3 className="text-sm font-semibold text-ink">
        {applied
          ? "Simulated update applied"
          : cancelled
            ? "Simulated action cancelled"
            : result.status === "RESET"
              ? "Demo scenario reset"
              : "Simulated action not applied"}
      </h3>
      <p className="mt-1 break-words text-xs leading-5 text-muted">{result.message}</p>
      {result.result ? (
        <p className="mt-3 break-words text-xs leading-5 text-ink">{result.result.description}</p>
      ) : null}
      {result.stateSummary ? (
        <div className="mt-3 rounded-xl border border-line bg-white p-3 text-xs leading-5">
          <p className="break-words font-semibold text-ink">
            {result.stateSummary.sip.fundName} · {result.stateSummary.scenario} demo
          </p>
          <p className="mt-1 text-muted">
            {formatInr(result.stateSummary.sip.monthlyAmount)}/month · debit day {result.stateSummary.sip.debitDay} · {result.stateSummary.sip.status.toLowerCase()}
          </p>
          <p className="mt-1 text-muted">
            Reward progress: {result.stateSummary.rewardProgress.eligibleInstalments}/{result.stateSummary.rewardProgress.targetInstalments} fictional instalments
          </p>
        </div>
      ) : null}
      <p className="mt-3 text-[11px] font-medium leading-5 text-muted">
        No real payment was made. The dashboard remains an independent static demo snapshot and does not reflect this session state.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={onReset}
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-line bg-white px-4 py-2 text-xs font-semibold text-ink transition hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-groww-dark focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Resetting…" : "Reset demo scenario"}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex min-h-11 items-center justify-center rounded-full px-4 py-2 text-xs font-semibold text-muted transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-groww-dark focus-visible:ring-offset-2"
        >
          Continue
        </button>
      </div>
    </section>
  );
}
