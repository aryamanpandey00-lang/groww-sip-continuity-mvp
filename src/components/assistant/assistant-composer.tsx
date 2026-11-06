import type { FormEvent, KeyboardEvent } from "react";
import { ArrowUpRightIcon } from "@/components/ui/icons";
import { shouldSubmitAssistantMessage } from "./assistant-logic";

export function AssistantComposer({
  value,
  disabled,
  onChange,
  onSubmit,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      shouldSubmitAssistantMessage({
        key: event.key,
        shiftKey: event.shiftKey,
        isComposing: event.nativeEvent.isComposing,
      })
    ) {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <form onSubmit={submit} className="border-t border-line bg-white p-3 sm:p-4">
      <label htmlFor="assistant-question" className="sr-only">
        Your question
      </label>
      <textarea
        id="assistant-question"
        name="question"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={keyDown}
        disabled={disabled}
        maxLength={2_000}
        rows={3}
        aria-describedby="assistant-composer-help assistant-character-count"
        placeholder="Ask about your selected demo journey…"
        className="block w-full resize-y rounded-xl border border-line bg-surface px-3.5 py-3 text-sm leading-6 text-ink outline-none transition placeholder:text-muted/80 focus-visible:border-groww-dark focus-visible:ring-2 focus-visible:ring-groww/20 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p id="assistant-composer-help" className="text-[10px] leading-4 text-muted">
          Enter to send · Shift+Enter for a new line. Each request is sent
          without earlier chat messages.
        </p>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <span id="assistant-character-count" className="text-[10px] tabular-nums text-muted">
            {value.length}/2,000
          </span>
          <button
            type="submit"
            disabled={disabled || value.trim().length === 0}
            className="inline-flex min-h-11 min-w-28 items-center justify-center gap-2 rounded-full bg-groww px-4 py-2.5 text-sm font-semibold text-[#042f25] shadow-sm transition hover:bg-[#00bd8d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-groww-dark focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {disabled ? "Sending…" : "Send question"}
            <ArrowUpRightIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </form>
  );
}
