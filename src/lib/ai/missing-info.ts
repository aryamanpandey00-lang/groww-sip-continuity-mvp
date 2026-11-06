import {
  isVagueQuestion,
  mentionsModifyAmount,
  mentionsModifyDay,
} from "./intent";
import type {
  AssistantIntent,
  AssistantProblemCategory,
  MissingInformationDecision,
} from "./types";

const NONE: MissingInformationDecision = {
  required: false,
  question: null,
  code: "NONE",
};

function hasCurrencyOrAmount(question: string): boolean {
  return (
    /(?:₹|rs\.?|inr)\s*[\d,]+/i.test(question) ||
    /\b\d{3,6}\b/.test(question)
  );
}

function hasDebitDayValue(question: string): boolean {
  const dayWords = /\b(day|date)\b/i;
  const dayContext =
    /(?:debit|sip|monthly|instalment|installment)[\s\S]{0,30}\b(?:day|date)\b/i;
  const valueNearDay =
    /\b(day|date)\b[\s\S]{0,30}\b(?:[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\b/i;
  const valueBeforeDay =
    /\b(?:[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\b[\s\S]{0,20}\b(day|date)\b/i;

  return (
    (dayWords.test(question) && valueNearDay.test(question)) ||
    (dayContext.test(question) && valueBeforeDay.test(question))
  );
}

export { hasCurrencyOrAmount as hasRequestedAmountValue };
export { hasDebitDayValue as hasRequestedDebitDayValue };

function vagueQuestionForCategory(
  category: AssistantProblemCategory | null,
): string {
  switch (category) {
    case "INSUFFICIENT_FUNDS":
      return "What would you like help with regarding the failed debit and insufficient balance?";
    case "PAYMENT_FAILED":
      return "What would you like help with regarding the failed SIP payment?";
    case "MARKET_UNCERTAINTY":
      return "What would you like to understand about market movements and your SIP?";
    case "MODIFY_SIP":
      return "Would you like to change the monthly amount or the debit day?";
    case "RESTART_SIP":
      return "Would you like to check whether the SIP can be restarted?";
    case "REWARD_MILESTONE":
      return "Would you like to check progress toward the fictional reward milestone?";
    default:
      return "What would you like help with - a failed payment, changing the SIP, restarting it, reward progress, or a general SIP question?";
  }
}

/**
 * Deterministic clarification checks run before any model call. Only one
 * question is returned so the assistant never stacks follow-ups.
 */
export function detectMissingInformation(
  question: string,
  intent: AssistantIntent,
  selectedCategory: AssistantProblemCategory | null = null,
): MissingInformationDecision {
  const trimmed = question.trim();

  if (trimmed.length === 0) {
    return {
      required: true,
      question: vagueQuestionForCategory(selectedCategory),
      code: "EMPTY_QUESTION",
    };
  }

  if (isVagueQuestion(trimmed)) {
    return {
      required: true,
      question: vagueQuestionForCategory(selectedCategory),
      code: "TOO_VAGUE",
    };
  }

  if (intent !== "MODIFY_SIP") {
    return NONE;
  }

  const amountTarget = mentionsModifyAmount(trimmed);
  const dayTarget = mentionsModifyDay(trimmed);
  const amountProvided = hasCurrencyOrAmount(trimmed);
  const dayProvided = hasDebitDayValue(trimmed);

  if (amountTarget && !dayTarget) {
    if (amountProvided) {
      return NONE;
    }

    return {
      required: true,
      question:
        "What monthly SIP amount would you like? The fictional demo range is ₹500 to ₹25,000.",
      code: "MODIFY_AMOUNT",
    };
  }

  if (dayTarget && !amountTarget) {
    if (dayProvided) {
      return NONE;
    }

    return {
      required: true,
      question:
        "Which debit day would you like? The fictional demo range is day 1 to 28.",
      code: "MODIFY_DAY",
    };
  }

  if (amountTarget && dayTarget) {
    if (amountProvided && dayProvided) {
      return NONE;
    }

    return {
      required: true,
      question:
        "Please include the new monthly amount and debit day in one request, for example ₹6,000 on day 15.",
      code: "MODIFY_TARGET",
    };
  }

  if (!amountProvided && !dayProvided) {
    return {
      required: true,
      question:
        "Would you like to change the monthly amount or the debit day? Please include the new value.",
      code: "MODIFY_TARGET",
    };
  }

  return NONE;
}
