import Link from "next/link";
import { DesktopNav } from "@/components/layout/desktop-nav";
import { demoDashboard } from "@/lib/domain/fixtures/demo-dashboard";
import { formatDemoDate } from "@/lib/utils/format";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            aria-label="Groww SIP Continuity demo home"
            className="flex items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-groww/40 focus-visible:ring-offset-2"
          >
            <span className="text-[1.65rem] font-semibold leading-none tracking-[-0.06em] text-ink">
              groww<span className="text-groww">.</span>
            </span>
          </Link>
          <span className="rounded-full border border-groww/20 bg-groww-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-groww-dark">
            Demo
          </span>
        </div>

        <DesktopNav />

        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted sm:block">
            As of {formatDemoDate(demoDashboard.asOfDate)}
          </span>
          <Link
            href="/profile"
            aria-label="Open demo profile"
            className="grid h-9 w-9 place-items-center rounded-full bg-groww-soft text-xs font-bold text-groww-dark ring-1 ring-groww/20 transition hover:bg-groww/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-groww/40 focus-visible:ring-offset-2"
          >
            {demoDashboard.investor.initials}
          </Link>
        </div>
      </div>
    </header>
  );
}
