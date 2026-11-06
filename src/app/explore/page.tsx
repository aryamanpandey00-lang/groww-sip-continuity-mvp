import { PlaceholderPage } from "@/components/layout/placeholder-page";
import { Card } from "@/components/ui/card";
import { CompassIcon, MutualFundsIcon, StocksIcon } from "@/components/ui/icons";

const exploreItems = [
  {
    title: "Mutual fund categories",
    description:
      "A future education space for fictional categories. No real fund recommendations.",
    icon: MutualFundsIcon,
  },
  {
    title: "Stocks",
    description:
      "A placeholder for market discovery. No live prices or real securities.",
    icon: StocksIcon,
  },
  {
    title: "Learning collections",
    description:
      "Short explainers on SIP continuity, volatility and goal-based investing.",
    icon: CompassIcon,
  },
];

export default function ExplorePage() {
  return (
    <PlaceholderPage
      eyebrow="Explore"
      title="Explore, without real products"
      description="This Phase 1 placeholder shows where discovery will live. It does not contain real mutual funds, stocks, prices or recommendations."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {exploreItems.map((item) => {
          const Icon = item.icon;

          return (
            <Card key={item.title} className="p-4">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-groww-soft text-groww-dark">
                <Icon className="h-5 w-5" />
              </span>
              <h2 className="mt-4 text-sm font-semibold text-ink">
                {item.title}
              </h2>
              <p className="mt-1 text-xs leading-5 text-muted">
                {item.description}
              </p>
            </Card>
          );
        })}
      </div>

      <p className="mt-5 text-[11px] leading-5 text-muted">
        Explore is a placeholder in Phase 1. No discovery engine or real market
        data is connected.
      </p>
    </PlaceholderPage>
  );
}
