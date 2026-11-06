import { PlaceholderPage } from "@/components/layout/placeholder-page";
import { Card } from "@/components/ui/card";
import { AddMoneyIcon, InfoIcon } from "@/components/ui/icons";

export default function AddMoneyPage() {
  return (
    <PlaceholderPage
      eyebrow="Add Money"
      title="Simulated top-up only"
      description="No payment gateway, bank account or real money movement is connected. This page exists to complete the dashboard shortcut journey."
    >
      <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          <span className="font-semibold">Not a payment screen.</span> Do not
          enter real bank, card or UPI details anywhere in this demo.
        </p>
      </div>

      <Card className="mt-4 p-5">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-groww-soft text-groww-dark">
          <AddMoneyIcon className="h-5 w-5" />
        </span>
        <h2 className="mt-4 text-sm font-semibold text-ink">
          Add-money flow deferred
        </h2>
        <p className="mt-1 text-xs leading-5 text-muted">
          A future simulated amount-entry flow could live here, but it is not
          required for the Phase 1 dashboard and no real transaction will be
          implemented.
        </p>
      </Card>
    </PlaceholderPage>
  );
}
