import type { AssistantLogEvent, AssistantLogSink } from "./types";

/**
 * Structured server log. The event type deliberately has no fields for API
 * keys, prompts, model output, credentials or personal data.
 */
export function consoleAssistantLogSink(event: AssistantLogEvent): void {
  console.info(
    JSON.stringify({
      event: "sip_assistant_request",
      ...event,
    }),
  );
}

export function emitAssistantLog(
  sink: AssistantLogSink | undefined,
  event: AssistantLogEvent,
): void {
  const logger = sink ?? consoleAssistantLogSink;

  try {
    logger(event);
  } catch {
    // Logging must never change the user-facing safety outcome.
  }
}
