import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button-link";
import { Card } from "@/components/ui/card";
import { ArrowUpRightIcon, AssistantIcon } from "@/components/ui/icons";

const previewTopics = ["Failed payment", "Market uncertainty", "Reward progress"];

export function AssistantEntryCard() {
  return (
    <Card className="relative overflow-hidden border-groww/20 bg-gradient-to-br from-[#e9fbf5] via-white to-white p-5 sm:p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full bg-groww/15 blur-3xl"
      />

      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-groww-dark shadow-sm ring-1 ring-groww/15">
            <AssistantIcon className="h-5 w-5" />
          </div>
          <Badge tone="green">Demo assistant</Badge>
        </div>

        <h2 className="mt-4 text-lg font-semibold tracking-tight text-ink">
          SIP Continuity Assistant
        </h2>
        <p className="mt-1.5 text-sm leading-6 text-muted">
          Ask about a failed payment, changing a SIP, a paused SIP or a fictional
          reward milestone.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {previewTopics.map((topic) => (
            <span
              key={topic}
              className="rounded-full border border-line bg-white px-2.5 py-1 text-[11px] font-medium text-muted"
            >
              {topic}
            </span>
          ))}
        </div>

        <ButtonLink href="/assistant" className="mt-5 w-full sm:w-auto">
          Open assistant
          <ArrowUpRightIcon className="h-4 w-4" />
        </ButtonLink>

        <p className="mt-3 text-[11px] leading-5 text-muted">
          The assistant may be unavailable while server-side AI is disabled.
          No real account or transaction is connected.
        </p>
      </div>
    </Card>
  );
}
