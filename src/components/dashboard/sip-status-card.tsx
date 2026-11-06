import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button-link";
import { Card } from "@/components/ui/card";
import { AlertIcon, ChevronRightIcon } from "@/components/ui/icons";
import type { DemoSip } from "@/lib/domain/types";
import { formatDemoDate, formatInr } from "@/lib/utils/format";

export function SipStatusCard({ sip }: { sip: DemoSip }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            My SIP
          </p>
          <h2 className="mt-1 text-base font-semibold text-ink">SIP status</h2>
        </div>
        <Badge tone="amber">{sip.statusLabel}</Badge>
      </div>

      <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">{sip.fundName}</p>
            <p className="mt-1 text-xs text-muted">{sip.fundCategory}</p>
          </div>
          <p className="text-sm font-semibold text-ink">
            {formatInr(sip.monthlyAmount)}
            <span className="text-xs font-normal text-muted"> / month</span>
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-muted">Next instalment</p>
            <p className="mt-1 font-semibold text-ink">
              {formatDemoDate(sip.nextInstalmentDate)}
            </p>
          </div>
          <div>
            <p className="text-muted">Debit day</p>
            <p className="mt-1 font-semibold text-ink">
              {sip.debitDay}th of each month
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
        <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div>
          <p className="text-xs font-semibold text-amber-800">
            Last simulated debit failed on{" "}
            {formatDemoDate(sip.lastPayment.attemptedOn)}
          </p>
          <p className="mt-1 text-xs leading-5 text-amber-800/80">
            {sip.lastPayment.reason}. Retry by {formatDemoDate(sip.retryBy)} in
            this demo scenario.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ButtonLink href="/assistant">
          Review in Assistant
          <ChevronRightIcon className="h-4 w-4" />
        </ButtonLink>
        <Link
          href="/sips"
          className="rounded-lg text-xs font-semibold text-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-groww/40 focus-visible:ring-offset-2"
        >
          View SIP details
        </Link>
      </div>

      <p className="mt-3 text-[11px] text-muted">
        Simulated SIP. No real debit or payment integration.
      </p>
    </Card>
  );
}
