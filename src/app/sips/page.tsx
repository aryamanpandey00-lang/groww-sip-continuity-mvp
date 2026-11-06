import { PlaceholderPage } from "@/components/layout/placeholder-page";
import { Badge } from "@/components/ui/badge";
import { demoDashboard } from "@/lib/domain/fixtures/demo-dashboard";
import { formatDemoDate, formatInr } from "@/lib/utils/format";

export default function SipsPage() {
  const { sip, reward } = demoDashboard;

  return (
    <PlaceholderPage
      eyebrow="My SIPs"
      title="Demo SIP details"
      description="This read-only view derives its SIP, retry and reward values from deterministic demo engines. All amounts and outcomes are simulated."
    >
      <div className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">{sip.fundName}</p>
            <p className="mt-1 text-xs text-muted">{sip.fundCategory}</p>
          </div>
          <Badge tone="amber">{sip.statusLabel}</Badge>
        </div>

        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted">Monthly amount</dt>
            <dd className="mt-1 font-semibold text-ink">
              {formatInr(sip.monthlyAmount)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Next instalment</dt>
            <dd className="mt-1 font-semibold text-ink">
              {formatDemoDate(sip.nextInstalmentDate)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Last simulated attempt</dt>
            <dd className="mt-1 font-semibold text-ink">
              {formatDemoDate(sip.lastPayment.attemptedOn)} ·{" "}
              {sip.lastPayment.status}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Demo retry deadline</dt>
            <dd className="mt-1 font-semibold text-ink">
              {formatDemoDate(sip.retryBy)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-4 rounded-2xl border border-groww/15 bg-groww-soft p-4">
        <p className="text-xs font-semibold text-groww-dark">
          Milestone progress: {reward.eligibleInstalments} /{" "}
          {reward.targetInstalments} eligible instalments
        </p>
        <p className="mt-1 text-xs leading-5 text-groww-dark/80">
          A missed month delays the milestone but does not erase progress. This
          is a fictional demo rule, not Groww policy.
        </p>
      </div>

      <p className="mt-5 text-[11px] leading-5 text-muted">
        No real SIP, debit mandate, payment or reward redemption exists.
      </p>
    </PlaceholderPage>
  );
}
