import { Badge } from "@/components/ui/badge";
import { AssistantIcon, ShieldIcon } from "@/components/ui/icons";
import type { AssistantApiResponse } from "@/lib/assistant/contracts";
import { CitationList } from "./citation-list";
import { QualityLabel } from "./quality-label";
import { ActionPreviewCard } from "./action-preview-card";

const statusLabel: Record<AssistantApiResponse["status"], string> = {
  APPROVED: "Passed automated safety checks",
  NEEDS_MORE_INFORMATION: "More information needed",
  SAFE_FALLBACK: "Safe fallback",
  UNAVAILABLE: "Assistant unavailable",
};

const statusQualityEquivalents: Partial<
  Record<AssistantApiResponse["status"], AssistantApiResponse["qualityLabel"]>
> = {
  NEEDS_MORE_INFORMATION: "Need more information",
  SAFE_FALLBACK: "Safe fallback",
  UNAVAILABLE: "Assistant unavailable",
};

export function AssistantMessage({
  response,
  onReviewAction,
  actionPreviewIsCurrent = false,
  actionPending = false,
}: {
  response: AssistantApiResponse;
  onReviewAction?: () => void;
  actionPreviewIsCurrent?: boolean;
  actionPending?: boolean;
}) {
  const responseStatusLabel = statusLabel[response.status];
  const equivalentQuality = statusQualityEquivalents[response.status];
  const showSeparateStatusLabel = equivalentQuality
    ? response.qualityLabel !== equivalentQuality
    : responseStatusLabel.trim().toLowerCase() !==
      response.qualityLabel.trim().toLowerCase();
  const sameAsFollowUp =
    response.followUpQuestion.trim().length > 0 &&
    response.followUpQuestion.trim() === response.directAnswer.trim();

  return (
    <article
      aria-label="Assistant response"
      className="rounded-2xl border border-line bg-white p-4 shadow-sm sm:p-5"
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-groww-soft text-groww-dark">
          <AssistantIcon className="h-4 w-4" />
        </span>
        <QualityLabel label={response.qualityLabel} />
        {showSeparateStatusLabel ? (
          <Badge tone={response.status === "APPROVED" ? "green" : "neutral"}>
            {responseStatusLabel}
          </Badge>
        ) : null}
      </header>

      {response.status === "UNAVAILABLE" ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          The assistant is unavailable. No verified answer was generated.
        </p>
      ) : null}
      {response.fallbackUsed ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          This is a fallback response from the demo assistant. Do not treat it
          as a verified Groww policy statement.
        </p>
      ) : null}

      {!sameAsFollowUp ? (
        <p className="mt-4 break-words whitespace-pre-wrap text-sm leading-6 text-ink">
          {response.directAnswer}
        </p>
      ) : null}

      {response.keyPoints.length > 0 ? (
        <ul className="mt-3 grid gap-2">
          {response.keyPoints.map((point, index) => (
            <li key={`${index}-${point}`} className="flex gap-2 text-sm leading-6 text-ink">
              <span
                aria-hidden="true"
                className="mt-[0.62rem] h-1.5 w-1.5 shrink-0 rounded-full bg-groww-dark"
              />
              <span className="break-words whitespace-pre-wrap">{point}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {response.followUpQuestion.trim() ? (
        <div className="mt-4 rounded-xl border border-groww/20 bg-groww-soft/70 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-groww-dark">
            {sameAsFollowUp ? "Please clarify" : "Follow-up question"}
          </p>
          <p className="mt-1 break-words text-sm leading-6 text-ink">
            {response.followUpQuestion}
          </p>
        </div>
      ) : null}

      <CitationList citations={response.citations} />

      {response.actionPreview ? (
        <ActionPreviewCard
          preview={response.actionPreview}
          onReview={
            actionPreviewIsCurrent && !actionPending
              ? onReviewAction
              : undefined
          }
          disabled={actionPending || !actionPreviewIsCurrent}
        />
      ) : null}

      <p className="mt-4 flex items-start gap-2 border-t border-line pt-3 text-[11px] leading-5 text-muted">
        <ShieldIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-groww-dark" />
        No action has been taken. This chat cannot make a real payment or change
        the simulated SIP.
      </p>
    </article>
  );
}
