import type { ReactNode } from "react";

type BadgeTone = "green" | "amber" | "neutral";

const toneClasses: Record<BadgeTone, string> = {
  green: "border-groww/20 bg-groww-soft text-groww-dark",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  neutral: "border-line bg-surface text-muted",
};

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${toneClasses[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
