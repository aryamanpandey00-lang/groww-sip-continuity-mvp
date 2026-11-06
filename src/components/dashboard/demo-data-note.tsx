import { Card } from "@/components/ui/card";
import { ShieldIcon } from "@/components/ui/icons";

export function DemoDataNote() {
  return (
    <Card className="p-5">
      <div className="flex gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-groww-soft text-groww-dark">
          <ShieldIcon className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-ink">What is simulated?</h2>
          <p className="mt-1 text-xs leading-5 text-muted">
            Portfolio values, SIP dates and reward progress come from a
            fictional snapshot. Assistant demo-session changes do not update
            this dashboard. No real account, market feed, payment or redeemable
            reward is connected.
          </p>
        </div>
      </div>
    </Card>
  );
}
