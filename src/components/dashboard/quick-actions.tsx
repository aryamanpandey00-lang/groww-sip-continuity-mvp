import Link from "next/link";
import type { ComponentType } from "react";
import { Card } from "@/components/ui/card";
import {
  AddMoneyIcon,
  MutualFundsIcon,
  SipIcon,
  StocksIcon,
  type IconProps,
} from "@/components/ui/icons";
import type { QuickAction } from "@/lib/domain/types";

const actionIcons: Record<QuickAction["id"], ComponentType<IconProps>> = {
  "mutual-funds": MutualFundsIcon,
  stocks: StocksIcon,
  "add-money": AddMoneyIcon,
  "my-sips": SipIcon,
};

export function QuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">Quick actions</h2>
        <span className="text-[11px] text-muted">Demo shortcuts</span>
      </div>

      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        {actions.map((action) => {
          const Icon = actionIcons[action.id];

          return (
            <Link
              key={action.id}
              href={action.href}
              aria-label={`${action.label} — ${action.description}`}
              className="group flex flex-col items-center gap-2 rounded-2xl p-2 text-center transition hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-groww/40 focus-visible:ring-offset-2"
            >
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-groww-soft text-groww-dark transition group-hover:bg-groww/15">
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-[11px] font-medium leading-4 text-ink sm:text-xs">
                {action.label}
              </span>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
