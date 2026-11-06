import { AssistantClient } from "@/components/assistant/assistant-client";
import { Badge } from "@/components/ui/badge";

export default function AssistantPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-32 pt-6 sm:px-6 lg:pb-12 lg:pt-9">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-groww-dark">
            SIP continuity
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Assistant
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Ask about a fictional SIP journey. When evidence is available, the
            assistant shows its sources and the limits of its answer.
          </p>
        </div>
        <Badge tone="green" className="mt-1 shrink-0">
          Demo account only
        </Badge>
      </div>

      <AssistantClient />
    </main>
  );
}
