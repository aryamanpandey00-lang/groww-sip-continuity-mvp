import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeftIcon } from "@/components/ui/icons";

export function PlaceholderPage({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-6 sm:px-6 lg:py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold text-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-groww/40 focus-visible:ring-offset-2"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to dashboard
      </Link>

      <section className="mt-6 rounded-card border border-line bg-white p-6 shadow-card sm:p-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-groww-dark">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {title}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
          {description}
        </p>
        {children ? <div className="mt-6">{children}</div> : null}
      </section>

      <p className="mt-5 text-center text-[11px] text-muted">
        Phase 1 scaffold · Demo data only · No real account connected
      </p>
    </main>
  );
}
