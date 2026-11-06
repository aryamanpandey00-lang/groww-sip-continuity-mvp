import type { AssistantApiResponse } from "@/lib/assistant/contracts";

const qualityTone: Record<
  AssistantApiResponse["qualityLabel"],
  string
> = {
  "Evidence-backed": "border-groww/25 bg-groww-soft text-groww-dark",
  "Limited evidence": "border-sky-200 bg-sky-50 text-sky-800",
  "Safety guidance": "border-amber-200 bg-amber-50 text-amber-800",
  "Need more information": "border-violet-200 bg-violet-50 text-violet-800",
  "Safe fallback": "border-amber-200 bg-amber-50 text-amber-800",
  "Assistant unavailable": "border-line bg-surface text-muted",
};

export function QualityLabel({
  label,
}: {
  label: AssistantApiResponse["qualityLabel"];
}) {
  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${qualityTone[label]}`}
      aria-label={`Answer quality: ${label}`}
    >
      {label}
    </span>
  );
}
