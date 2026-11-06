import { AssistantEntryCard } from "@/components/dashboard/assistant-entry-card";
import { DemoDataNote } from "@/components/dashboard/demo-data-note";
import { MilestoneCard } from "@/components/dashboard/milestone-card";
import { PortfolioSummaryCard } from "@/components/dashboard/portfolio-summary-card";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { SipStatusCard } from "@/components/dashboard/sip-status-card";
import { InfoIcon } from "@/components/ui/icons";
import { demoDashboard } from "@/lib/domain/fixtures/demo-dashboard";

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 sm:px-6 lg:py-8">
      <div className="animate-rise mb-5 flex items-start gap-2 rounded-2xl border border-groww/20 bg-groww-soft px-4 py-3 text-xs leading-relaxed text-groww-dark">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          <span className="font-semibold">Demo mode.</span>{" "}
          {demoDashboard.disclaimer}
        </p>
      </div>

      <section className="animate-rise mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-groww-dark">
          Your dashboard
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Good morning, {demoDashboard.investor.displayName}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          A fictional portfolio view for the SIP Continuity Assistant graduation
          project.
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,1fr)]">
        <div className="animate-rise space-y-5">
          <PortfolioSummaryCard portfolio={demoDashboard.portfolio} />
          <QuickActions actions={demoDashboard.quickActions} />
          <SipStatusCard sip={demoDashboard.sip} />
        </div>

        <aside className="animate-rise space-y-5">
          <AssistantEntryCard />
          <MilestoneCard reward={demoDashboard.reward} />
          <DemoDataNote />
        </aside>
      </div>
    </main>
  );
}
