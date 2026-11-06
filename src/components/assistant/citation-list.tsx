import type { AssistantApiCitation } from "@/lib/assistant/contracts";

export function safeCitationUrl(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null;

  try {
    const parsed = new URL(sourceUrl);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username.length > 0 ||
      parsed.password.length > 0
    ) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function tierLabel(tier: AssistantApiCitation["sourceTier"]): string {
  switch (tier) {
    case "demo_policy":
      return "Demo policy — not Groww policy";
    case "general_education":
      return "General investor education";
    case "official_groww":
      return "Official Groww evidence";
  }
}

export function CitationList({
  citations,
}: {
  citations: AssistantApiCitation[];
}) {
  if (citations.length === 0) return null;

  return (
    <section className="mt-4 border-t border-line pt-4" aria-label="Evidence">
      <h4 className="text-xs font-semibold text-ink">Evidence used</h4>
      <ul className="mt-2 grid gap-2">
        {citations.map((citation) => {
          const safeUrl = safeCitationUrl(citation.sourceUrl);

          return (
            <li
              key={citation.evidenceId}
              className="min-w-0 rounded-xl border border-line bg-surface/70 p-3"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="break-words text-[10px] font-semibold uppercase tracking-wide text-groww-dark">
                  {tierLabel(citation.sourceTier)}
                </span>
                <span className="break-words text-[10px] text-muted">
                  {citation.verificationLabel}
                </span>
              </div>
              <p className="mt-1.5 break-words text-xs font-semibold text-ink">
                {citation.sourceName}: {citation.title}
              </p>
              {citation.excerpt.trim() ? (
                <p className="mt-1 break-words whitespace-pre-line text-xs leading-5 text-muted">
                  {citation.excerpt}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
                <span className="break-words">{citation.evidenceId}</span>
                {citation.sourceDate ? <span>{citation.sourceDate}</span> : null}
                {citation.applicableDemoPolicyVersion ? (
                  <span>Policy version {citation.applicableDemoPolicyVersion}</span>
                ) : null}
              </div>
              {safeUrl ? (
                <a
                  href={safeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className="mt-2 inline-flex min-h-8 items-center rounded-lg text-xs font-semibold text-groww-dark underline decoration-groww/50 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-groww/50"
                >
                  View source
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
