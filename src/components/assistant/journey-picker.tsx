import { Card } from "@/components/ui/card";
import type { AssistantJourney } from "./journeys";
import { ASSISTANT_JOURNEYS } from "./journeys";

export function JourneyPicker({
  selectedCategory,
  onSelect,
  disabled = false,
}: {
  selectedCategory: AssistantJourney["id"] | null;
  onSelect: (journey: AssistantJourney) => void;
  disabled?: boolean;
}) {
  return (
    <section aria-labelledby="journey-picker-title">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="journey-picker-title" className="text-sm font-semibold text-ink">
            What would you like help with?
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted">
            Choose a journey to load a suggested question. You can edit it
            before sending.
          </p>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          6 demo journeys
        </span>
      </div>

      <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {ASSISTANT_JOURNEYS.map((journey) => {
          const Icon = journey.icon;
          const selected = selectedCategory === journey.id;

          return (
            <button
              key={journey.id}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onSelect(journey)}
              className="min-h-28 min-w-0 rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-groww-dark focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Card
                className={`h-full p-3.5 transition hover:border-groww/40 hover:shadow-card sm:p-4 ${
                  selected
                    ? "border-groww/50 bg-groww-soft/40 ring-2 ring-groww/20"
                    : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-groww-soft text-groww-dark">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold leading-5 text-ink">
                      {journey.title}
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-muted">
                      {journey.description}
                    </p>
                    <p className="mt-2 text-[10px] font-medium text-groww-dark">
                      {journey.scenarioNote}
                    </p>
                  </div>
                </div>
              </Card>
            </button>
          );
        })}
      </div>
    </section>
  );
}
