import type { ConversationMessage } from "./assistant-types";
import { AssistantMessage } from "./assistant-message";
import type { PublicActionPreview } from "@/lib/assistant/action-contracts";

export interface ConversationError {
  message: string;
  retryRequest: (() => void) | null;
}

export function ConversationThread({
  messages,
  pending,
  error,
  activeActionPreview,
  actionPending,
  onReviewAction,
}: {
  messages: ConversationMessage[];
  pending: boolean;
  error: ConversationError | null;
  activeActionPreview: PublicActionPreview | null;
  actionPending: boolean;
  onReviewAction: (preview: PublicActionPreview) => void;
}) {
  return (
    <section
      className="mx-3 my-3 min-w-0 rounded-2xl border border-line bg-surface/60 p-3 sm:mx-4 sm:my-4 sm:p-5"
      aria-label="Conversation"
    >
      {messages.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-white px-4 py-8 text-center">
          <p className="text-sm font-medium text-ink">
            Your conversation will appear here.
          </p>
          <p className="mt-1 text-xs leading-5 text-muted">
            Review the suggested question, edit it if needed, then send it to
            the demo assistant.
          </p>
        </div>
      ) : (
        <div role="log" aria-label="Conversation messages" aria-live="polite" className="grid min-w-0 gap-3">
          {messages.map((message) =>
            message.kind === "user" ? (
              <article
                key={message.id}
                aria-label="Your message"
                className="ml-5 min-w-0 max-w-[92%] justify-self-end rounded-2xl rounded-br-md bg-groww-soft px-4 py-3 text-sm leading-6 text-ink sm:ml-16 sm:max-w-[82%]"
              >
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-groww-dark">
                  You
                </p>
                <p className="break-words whitespace-pre-wrap">{message.text}</p>
              </article>
            ) : (
              <AssistantMessage
                key={message.id}
                response={message.response}
                actionPreviewIsCurrent={
                  message.response.actionPreview?.previewId !== null &&
                  message.response.actionPreview?.previewId === activeActionPreview?.previewId
                }
                actionPending={actionPending}
                onReviewAction={() => {
                  if (message.response.actionPreview) {
                    onReviewAction(message.response.actionPreview);
                  }
                }}
              />
            ),
          )}
        </div>
      )}

      {pending ? (
        <div
          role="status"
          aria-live="polite"
          className="mt-3 flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 text-sm text-muted"
        >
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-groww/30 border-t-groww-dark motion-reduce:animate-none"
          />
          Checking the demo evidence and safety rules…
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-900">Request not completed</p>
          <p className="mt-1 text-xs leading-5 text-red-800">{error.message}</p>
          {error.retryRequest ? (
            <button
              type="button"
              onClick={error.retryRequest}
              className="mt-3 inline-flex min-h-11 items-center justify-center rounded-full border border-red-300 bg-white px-4 py-2 text-xs font-semibold text-red-900 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
            >
              Retry request
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
