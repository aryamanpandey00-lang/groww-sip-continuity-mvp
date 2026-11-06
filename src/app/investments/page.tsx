import { PlaceholderPage } from "@/components/layout/placeholder-page";
import { Card } from "@/components/ui/card";
import { demoDashboard } from "@/lib/domain/fixtures/demo-dashboard";
import { formatInr } from "@/lib/utils/format";

export default function InvestmentsPage() {
  const { portfolio, sip } = demoDashboard;

  return (
    <PlaceholderPage
      eyebrow="Investments"
      title="Your fictional portfolio"
      description="A detailed holdings view is outside Phase 1. These values come from the same typed dashboard fixture used on the home page."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
            Total value
          </p>
          <p className="mt-1.5 text-lg font-semibold text-ink">
            {formatInr(portfolio.totalValue)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
            Invested
          </p>
          <p className="mt-1.5 text-lg font-semibold text-ink">
            {formatInr(portfolio.investedAmount)}
          </p>
        </Card>
        <Card className="border-groww/15 bg-groww-soft p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-groww-dark/80">
            Simulated returns
          </p>
          <p className="mt-1.5 text-lg font-semibold text-groww-dark">
            {formatInr(portfolio.returnsAmount)}
          </p>
        </Card>
      </div>

      <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
        <p className="text-xs font-semibold text-ink">Demo holding</p>
        <p className="mt-1 text-sm text-ink">{sip.fundName}</p>
        <p className="mt-1 text-xs text-muted">
          {sip.fundCategory} · {formatInr(sip.monthlyAmount)} monthly SIP
        </p>
      </div>

      <p className="mt-5 text-[11px] leading-5 text-muted">
        No real mutual fund, brokerage account or live valuation is connected.
      </p>
    </PlaceholderPage>
  );
}
