import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ChevronRightIcon } from "@/components/ui/icons";
import type { DemoPortfolio } from "@/lib/domain/types";
import { formatInr, formatPercent } from "@/lib/utils/format";

export function PortfolioSummaryCard({
  portfolio,
}: {
  portfolio: DemoPortfolio;
}) {
  const returnPrefix = portfolio.returnsAmount >= 0 ? "+" : "";

  return (
    <Card className="relative overflow-hidden p-5 sm:p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-groww/10 blur-3xl"
      />

      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted">Total portfolio value</p>
            <p className="mt-2 text-[2.1rem] font-semibold leading-none tracking-[-0.04em] text-ink sm:text-4xl">
              {formatInr(portfolio.totalValue)}
            </p>
            <p className="mt-2 text-xs text-muted">
              Fictional portfolio · Demo Investor 001
            </p>
          </div>
          <Badge tone="green">Simulated</Badge>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
              Invested
            </p>
            <p className="mt-1.5 text-lg font-semibold text-ink">
              {formatInr(portfolio.investedAmount)}
            </p>
          </div>

          <div className="rounded-2xl border border-groww/15 bg-groww-soft p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-groww-dark/80">
              Simulated returns
            </p>
            <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-lg font-semibold text-groww-dark">
              <span>
                {returnPrefix}
                {formatInr(portfolio.returnsAmount)}
              </span>
              <span className="text-xs font-semibold">
                ({formatPercent(portfolio.returnsPercent)})
              </span>
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <p className="text-[11px] leading-5 text-muted">
            Values are fixture data, not live market data.
          </p>
          <Link
            href="/investments"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg text-xs font-semibold text-groww-dark transition hover:text-groww focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-groww/40 focus-visible:ring-offset-2"
          >
            View investments
            <ChevronRightIcon className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </Card>
  );
}
