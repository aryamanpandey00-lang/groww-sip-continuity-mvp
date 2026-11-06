import type { PublicActionPreview } from "@/lib/assistant/action-contracts";
import { formatInr } from "@/lib/utils/format";

export function ActionPreviewCard({
  preview,
  onReview,
  disabled = false,
}: {
  preview: PublicActionPreview;
  onReview?: () => void;
  disabled?: boolean;
}) {
  const eligible = preview.eligibility === "ELIGIBLE" &&
    preview.requiresConfirmation && preview.previewId !== null;
  const additionalEffects = [...new Set(preview.effects)].filter(
    (effect) => effect.trim() !== preview.proposedChange?.trim(),
  );

  return (
    <section
      aria-label="Simulated action preview"
      className="mt-4 min-w-0 rounded-2xl border border-groww/30 bg-groww-soft/40 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-groww-dark">
            {preview.sourceLabel}
          </p>
          <h3 className="mt-1 break-words text-sm font-semibold text-ink">{preview.actionTitle}</h3>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
            eligible
              ? "bg-white text-groww-dark"
              : "bg-amber-100 text-amber-900"
          }`}
        >
          {eligible ? "Eligible in demo" : "Not eligible"}
        </span>
      </div>

      <p className="mt-3 text-xs font-medium text-ink">{preview.sipContext.label}</p>
      <p className="mt-1 break-words text-xs leading-5 text-muted">
        {preview.sipContext.fundName} · {formatInr(preview.sipContext.monthlyAmount)}/month · debit day {preview.sipContext.debitDay} · {preview.sipContext.status.toLowerCase()}
      </p>
      <p className="mt-2 text-xs leading-5 text-muted">
        Scenario: <span className="font-semibold text-ink">{preview.scenario}</span>
      </p>

      {preview.proposedChange ? (
        <p className="mt-3 break-words rounded-xl border border-line bg-white px-3 py-2 text-xs leading-5 text-ink">
          {preview.proposedChange}
        </p>
      ) : null}

      {additionalEffects.length > 0 ? (
        <ul className="mt-3 grid gap-1.5 text-xs leading-5 text-muted">
          {additionalEffects.map((effect) => <li key={effect} className="break-words">{effect}</li>)}
        </ul>
      ) : null}
      {preview.errors.length > 0 ? (
        <ul role="status" className="mt-3 grid gap-1.5 text-xs leading-5 text-amber-900">
          {preview.errors.map((message) => <li key={message} className="break-words">{message}</li>)}
        </ul>
      ) : null}

      {preview.expiresAt ? (
        <p className="mt-3 text-[11px] text-muted">
          Valid until {preview.expiresAt} (UTC). The server checks expiry when you confirm.
        </p>
      ) : null}

      <p className="mt-3 border-t border-groww/20 pt-3 text-[11px] leading-5 text-muted">
        Preview only. No real payment or SIP change will occur. Review the details and explicitly confirm in the next step.
      </p>
      {eligible && onReview ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onReview}
          className="mt-3 inline-flex min-h-11 items-center justify-center rounded-full bg-groww px-4 py-2 text-xs font-semibold text-[#042f25] transition hover:bg-[#00bd8d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-groww-dark focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Review and confirm
        </button>
      ) : null}
    </section>
  );
}
