import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { GiftIcon, LockIcon } from "@/components/ui/icons";
import type { DemoReward } from "@/lib/domain/types";

export function MilestoneCard({ reward }: { reward: DemoReward }) {
  const progress = Math.min(
    100,
    Math.max(0, (reward.eligibleInstalments / reward.targetInstalments) * 100),
  );

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Reward journey
          </p>
          <h2 className="mt-1 text-base font-semibold text-ink">
            12-month SIP milestone
          </h2>
        </div>
        <Badge tone="neutral">Demo rule</Badge>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <p className="text-3xl font-semibold tracking-tight text-ink">
          {reward.eligibleInstalments}
          <span className="text-base font-medium text-muted">
            {" "}
            / {reward.targetInstalments}
          </span>
        </p>
        <p className="text-xs text-muted">eligible instalments</p>
      </div>

      <div
        role="progressbar"
        aria-label="SIP milestone progress"
        aria-valuemin={0}
        aria-valuemax={reward.targetInstalments}
        aria-valuenow={reward.eligibleInstalments}
        className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface ring-1 ring-inset ring-line"
      >
        <div
          className="h-full rounded-full bg-groww transition-[width] duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-line bg-surface p-3.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-groww-dark ring-1 ring-line">
          <GiftIcon className="h-4 w-4" />
        </span>
        <div>
          <p className="text-xs font-semibold text-ink">{reward.rewardLabel}</p>
          <p className="mt-0.5 text-[11px] leading-5 text-muted">
            {reward.rewardNote}
          </p>
        </div>
        {reward.isUnlocked ? null : (
          <LockIcon className="ml-auto h-4 w-4 shrink-0 text-muted" />
        )}
      </div>

      <p className="mt-4 text-[11px] leading-5 text-muted">
        A missed month delays the milestone but does not erase progress. This is
        a fictional demo rule, not Groww policy.
      </p>
    </Card>
  );
}
