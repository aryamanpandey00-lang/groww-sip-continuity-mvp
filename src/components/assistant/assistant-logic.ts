import type {
  ConversationMessage,
  IncompleteModifyRequest,
  ModifyClarificationContext,
  ModifyRequestPreparation,
  ModifyTarget,
} from "./assistant-types";
import type { AssistantJourney } from "./journeys";

export interface ClearedAssistantConversation {
  messages: ConversationMessage[];
  composerText: string;
  pending: false;
  error: null;
  localNotice: null;
  modifyContext: null;
}

export function clearedAssistantConversation(): ClearedAssistantConversation {
  return {
    messages: [],
    composerText: "",
    pending: false,
    error: null,
    localNotice: null,
    modifyContext: null,
  };
}

export interface AssistantJourneySelectionState {
  journey: AssistantJourney;
  journeyPickerOpen: true;
  messages: [];
  composerText: string;
  pending: false;
  localNotice: null;
  modifyContext: null;
  actionPreview: null;
  actionResult: null;
  actionError: null;
  confirmationOpen: false;
}

export function createAssistantJourneySelectionState(
  journey: AssistantJourney,
): AssistantJourneySelectionState {
  return {
    journey,
    journeyPickerOpen: true,
    messages: [],
    composerText: journey.starterQuestion,
    pending: false,
    localNotice: null,
    modifyContext: null,
    actionPreview: null,
    actionResult: null,
    actionError: null,
    confirmationOpen: false,
  };
}

const AMOUNT_PATTERN = /(?:₹|rs\.?\s*|inr\s*)(\d[\d,]*)\b/i;
const NAMED_AMOUNT_PATTERN =
  /\b(?:amount|monthly)(?:\s+(?:sip\s+)?)?(?:\s*(?:to|of|is|=)\s*)?(\d[\d,]*)\b/i;
const DAY_PATTERN =
  /\b(?:day|date)(?:\s*(?:is|to|:|#)?\s*)([1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\b/i;
const ORDINAL_DAY_PATTERN =
  /\b([1-9]|[12]\d|3[01])(?:st|nd|rd|th)\s+(?:debit\s+)?(?:day|date)\b/i;

function amountIn(question: string): number | null {
  const match =
    AMOUNT_PATTERN.exec(question) ?? NAMED_AMOUNT_PATTERN.exec(question);
  const raw = match?.[1] ?? (/^\s*[\d,]{3,8}\s*$/.test(question) ? question : null);

  if (!raw) {
    return null;
  }

  const amount = Number(raw.replaceAll(",", ""));
  return Number.isSafeInteger(amount) && amount >= 100 && amount <= 9_999_999
    ? amount
    : null;
}

function debitDayIn(question: string): number | null {
  const match = DAY_PATTERN.exec(question) ?? ORDINAL_DAY_PATTERN.exec(question);
  return match ? Number(match[1]) : null;
}

function targetIn(question: string): ModifyTarget | null {
  const amountTarget = /\b(amount|monthly|instalment|installment)\b/i.test(
    question,
  );
  const dayTarget = /\b(debit|day|date)\b/i.test(question);

  if (amountTarget && dayTarget) return "both";
  if (amountTarget) return "amount";
  if (dayTarget) return "debitDay";
  return null;
}

export function createModifyClarificationContext(
  question: string,
): ModifyClarificationContext {
  return {
    target: targetIn(question) ?? "unknown",
    amount: amountIn(question),
    debitDay: debitDayIn(question),
  };
}

function incomplete(
  context: ModifyClarificationContext,
  message: string,
): IncompleteModifyRequest {
  return { ok: false, context, message };
}

/**
 * Rebuilds only a standalone SIP-change question from explicitly parsed user
 * values. The displayed conversation is never sent as API context.
 */
export function prepareModifyClarification(
  answer: string,
  previous: ModifyClarificationContext,
): ModifyRequestPreparation {
  const parsedTarget = targetIn(answer);
  const explicitlyNarrowsTarget = /\b(only|just)\b/i.test(answer);
  const target =
    parsedTarget === null
      ? previous.target
      : previous.target === "unknown"
        ? parsedTarget
        : previous.target === parsedTarget || parsedTarget === "both"
          ? parsedTarget
          : previous.target === "both" && !explicitlyNarrowsTarget
            ? "both"
            : explicitlyNarrowsTarget
              ? parsedTarget
              : "both";
  const amount = amountIn(answer) ?? previous.amount;
  let debitDay = debitDayIn(answer) ?? previous.debitDay;
  const bareNumber = /^\s*(\d{1,2})\s*$/.exec(answer);

  if (bareNumber && target === "debitDay") {
    const candidate = Number(bareNumber[1]);
    if (candidate >= 1 && candidate <= 31) debitDay = candidate;
  } else if (bareNumber && target === "both" && amount !== null) {
    const candidate = Number(bareNumber[1]);
    if (candidate >= 1 && candidate <= 31) debitDay = candidate;
  }

  const context: ModifyClarificationContext = { target, amount, debitDay };

  if (target === "amount") {
    if (amount === null) {
      return incomplete(
        context,
        "Please include the new monthly amount in a complete question. Earlier chat messages are not sent to the assistant.",
      );
    }

    return {
      ok: true,
      context,
      question: `I want to change my SIP monthly amount to ₹${amount}. Explain the fictional demo rules.`,
    };
  }

  if (target === "debitDay") {
    if (debitDay === null) {
      return incomplete(
        context,
        "Please include the new debit day in a complete question. Earlier chat messages are not sent to the assistant.",
      );
    }

    return {
      ok: true,
      context,
      question: `I want to change my SIP debit day to day ${debitDay}. Explain the fictional demo rules.`,
    };
  }

  if (target === "both") {
    if (amount === null || debitDay === null) {
      return incomplete(
        context,
        "Please include both the new monthly amount and debit day in one complete request. Earlier chat messages are not sent as conversation history.",
      );
    }

    return {
      ok: true,
      context,
      question: `I want to change my SIP monthly amount to ₹${amount} and debit day to ${debitDay}. Explain the fictional demo rules.`,
    };
  }

  return incomplete(
    context,
    "Please ask a complete standalone question and name whether you want to change the monthly amount or debit day. Earlier chat messages are not sent to the assistant.",
  );
}

export function shouldSubmitAssistantMessage(input: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
}): boolean {
  return input.key === "Enter" && !input.shiftKey && !input.isComposing;
}

export class AssistantRequestGuard {
  private generation = 0;
  private activeToken: number | null = null;

  begin(): number | null {
    if (this.activeToken !== null) return null;
    const token = ++this.generation;
    this.activeToken = token;
    return token;
  }

  isCurrent(token: number): boolean {
    return this.activeToken === token && this.generation === token;
  }

  finish(token: number): boolean {
    if (!this.isCurrent(token)) return false;
    this.activeToken = null;
    return true;
  }

  invalidate(): void {
    this.generation += 1;
    this.activeToken = null;
  }
}

export class AssistantActionRequestGuard {
  private generation = 0;

  begin(): number {
    return ++this.generation;
  }

  isCurrent(token: number): boolean {
    return this.generation === token;
  }

  invalidate(): void {
    this.generation += 1;
  }
}
