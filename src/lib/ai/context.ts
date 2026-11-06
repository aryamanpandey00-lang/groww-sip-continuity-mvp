import { getLatestFailedCycle, getLatestPaymentCycle, getNextInstalmentDate } from "@/lib/domain/sip-engine";
import { getRewardProgress } from "@/lib/domain/reward-engine";
import { demoPolicy } from "@/lib/domain/policy";
import type { DemoInvestorState, SipCycle } from "@/lib/domain/types";
import { getDeterministicFinancialFacts } from "@/lib/evaluation/facts";
import type { RetrievalResult } from "@/lib/evidence";
import {
  isActionIntent,
  isEvidenceRequiredIntent,
} from "./intent";
import {
  hasRequestedAmountValue,
  hasRequestedDebitDayValue,
} from "./missing-info";
import type {
  AssistantActionType,
  AssistantContextPacket,
  AssistantEvidenceContext,
  AssistantIntent,
  AssistantProblemCategory,
  VerifiedSipFacts,
} from "./types";

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toDateOnly(year: number, month: number, day: number): string | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1900 ||
    year > 2200 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}-${pad(month)}-${pad(day)}`;
}

function extractDateLiterals(value: string): string[] {
  const dates = new Set<string>();
  const isoPattern = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

  for (const match of value.matchAll(isoPattern)) {
    const date = toDateOnly(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    );

    if (date) {
      dates.add(date);
    }
  }

  const dayMonthPattern =
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec),?\s+(\d{4})\b/gi;

  for (const match of value.matchAll(dayMonthPattern)) {
    const month = MONTHS[match[2]?.toLowerCase() ?? ""];
    const date = toDateOnly(
      Number(match[3]),
      month,
      Number(match[1]),
    );

    if (date) {
      dates.add(date);
    }
  }

  const monthDayPattern =
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi;

  for (const match of value.matchAll(monthDayPattern)) {
    const month = MONTHS[match[1]?.toLowerCase() ?? ""];
    const date = toDateOnly(
      Number(match[3]),
      month,
      Number(match[2]),
    );

    if (date) {
      dates.add(date);
    }
  }

  return [...dates];
}

function extractCurrencyAmounts(value: string): number[] {
  const amounts = new Set<number>();
  const pattern = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/gi;

  for (const match of value.matchAll(pattern)) {
    const parsed = Number(match[1]?.replace(/,/g, ""));

    if (Number.isFinite(parsed) && parsed >= 0) {
      amounts.add(parsed);
    }
  }

  return [...amounts];
}

function extractRequestedAmounts(value: string): number[] {
  const amounts = new Set<number>();
  const pattern =
    /\b(?:amount|monthly|instalment|installment|sip|to|by)\b[^\d]{0,15}(\d{3,6})\b/gi;

  for (const match of value.matchAll(pattern)) {
    const parsed = Number(match[1]);

    if (Number.isFinite(parsed) && parsed >= 0) {
      amounts.add(parsed);
    }
  }

  return [...amounts];
}

function extractRequestedDebitDays(value: string): number[] {
  const days = new Set<number>();
  const patterns = [
    /\b(?:day|date)\b\D{0,20}(\d{1,2})(?:st|nd|rd|th)?\b/gi,
    /\b(\d{1,2})(?:st|nd|rd|th)?\b\D{0,20}\b(?:day|date)\b/gi,
    /\bon (?:the )?(\d{1,2})(?:st|nd|rd|th)\b/gi,
  ];

  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const parsed = Number(match[1]);

      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 31) {
        days.add(parsed);
      }
    }
  }

  return [...days];
}

function addAmounts(target: Set<number>, values: number[]): void {
  for (const value of values) {
    target.add(value);
  }
}

function addDates(target: Set<string>, values: Array<string | null | undefined>): void {
  for (const value of values) {
    if (value) {
      target.add(value);
    }
  }
}

function cycleDates(cycles: SipCycle[]): string[] {
  const dates: string[] = [];

  for (const cycle of cycles) {
    if (cycle.scheduledDate) {
      dates.push(cycle.scheduledDate);
    }
    if (cycle.paidOn) {
      dates.push(cycle.paidOn);
    }
    if (cycle.failedOn) {
      dates.push(cycle.failedOn);
    }
  }

  return dates;
}

function buildVerifiedFacts(state: DemoInvestorState): VerifiedSipFacts {
  const base = getDeterministicFinancialFacts(state);
  const failedCycle = getLatestFailedCycle(state.sip);
  const latestPayment = getLatestPaymentCycle(state.sip);
  const reward = getRewardProgress(state.sip.cycles);
  const nextInstalmentDate = getNextInstalmentDate(state.sip, state.asOfDate);
  const latestPaymentStatus =
    latestPayment?.status === "PAID"
      ? "SUCCESS"
      : latestPayment?.status === "FAILED"
        ? "FAILED"
        : null;
  const latestPaymentDate =
    latestPayment?.paidOn ??
    latestPayment?.failedOn ??
    latestPayment?.scheduledDate ??
    null;

  return Object.freeze({
    ...base,
    asOfDate: state.asOfDate,
    nextInstalmentDate,
    failedCycleId: failedCycle?.id ?? null,
    failedOn: failedCycle?.failedOn ?? null,
    failureReason: failedCycle?.failureReason ?? null,
    latestPaymentStatus,
    latestPaymentDate,
    rewardRemainingInstalments: reward.remainingInstalments,
    voucherLabel: reward.voucherLabel,
    voucherNote: reward.voucherNote,
    policyVersion: demoPolicy.version,
    policyLabel: demoPolicy.label,
  });
}

function buildEvidenceContext(retrieval: RetrievalResult): AssistantEvidenceContext {
  const items = retrieval.matches.map((match) => ({
    evidenceId: match.evidenceId,
    title: match.title,
    sourceTier: match.sourceTier,
    sourceLabel: match.sourceLabel,
    sourceName: match.sourceName,
    excerpt: match.excerpt,
    score: match.score,
    matchedTerms: [...match.matchedTerms],
    verificationStatus: match.verificationStatus,
    verificationLabel: match.verificationLabel,
    sourceUrl: match.sourceUrl,
    sourceDate: match.sourceDate,
    applicableDemoPolicyVersion: match.applicableDemoPolicyVersion,
  }));

  return {
    retrievalStatus: retrieval.status,
    effectiveSourceTier: retrieval.effectiveSourceTier,
    noEvidenceReason: retrieval.noEvidenceReason,
    evidenceIds: [...retrieval.evidenceIds],
    items,
    message: retrieval.message,
  };
}

function allowedActionTypes(
  intent: AssistantIntent,
  facts: VerifiedSipFacts,
  question: string,
): AssistantActionType[] {
  const actions = new Set<AssistantActionType>(["NONE"]);

  if (!isActionIntent(intent)) {
    return [...actions];
  }

  if (
    (intent === "PAYMENT_FAILED" || intent === "INSUFFICIENT_FUNDS") &&
    facts.failedCycleId &&
    facts.retryEligible === true
  ) {
    actions.add("RETRY_PAYMENT");
  }

  if (intent === "MODIFY_SIP") {
    if (hasRequestedAmountValue(question)) {
      actions.add("MODIFY_AMOUNT");
    }
    if (hasRequestedDebitDayValue(question)) {
      actions.add("MODIFY_DEBIT_DAY");
    }

    if (actions.size === 1) {
      actions.add("MODIFY_AMOUNT");
      actions.add("MODIFY_DEBIT_DAY");
    }
  }

  if (intent === "RESTART_SIP" && facts.restartEligible === true) {
    actions.add("RESTART_SIP");
  }

  return [...actions];
}

/**
 * Builds the read-only packet passed to the model and runtime gate. No full
 * investor state, secrets, credentials or personal data are included.
 */
export function buildAssistantContextPacket(input: {
  question: string;
  selectedCategory: AssistantProblemCategory | null;
  intent: AssistantIntent;
  evidenceIntent: string | null;
  retrieval: RetrievalResult;
  state: DemoInvestorState;
}): AssistantContextPacket {
  const facts = buildVerifiedFacts(input.state);
  const evidence = buildEvidenceContext(input.retrieval);
  const allowedAmounts = new Set<number>();
  const allowedDates = new Set<string>();
  const requestedAmounts = new Set<number>([
    ...extractCurrencyAmounts(input.question),
    ...extractRequestedAmounts(input.question),
  ]);
  const requestedDebitDays = new Set(
    extractRequestedDebitDays(input.question),
  );

  addAmounts(allowedAmounts, [
    facts.monthlyAmount,
    demoPolicy.minMonthlyAmount,
    demoPolicy.maxMonthlyAmount,
  ]);

  for (const cycle of input.state.sip.cycles) {
    allowedAmounts.add(cycle.amount);
  }

  const voucherAmount = Number(
    facts.voucherLabel.match(/\d[\d,]*/)?.[0]?.replace(/,/g, "") ?? "",
  );

  if (Number.isFinite(voucherAmount) && voucherAmount > 0) {
    allowedAmounts.add(voucherAmount);
  }

  addAmounts(allowedAmounts, [...requestedAmounts]);

  for (const item of evidence.items) {
    addAmounts(allowedAmounts, extractCurrencyAmounts(item.excerpt));
  }

  addDates(allowedDates, [
    facts.asOfDate,
    facts.retryDeadline,
    facts.restartDeadline,
    facts.nextInstalmentDate,
    facts.failedOn,
    demoPolicy.demoToday,
    ...cycleDates(input.state.sip.cycles),
    ...extractDateLiterals(input.question),
  ]);

  for (const item of evidence.items) {
    addDates(allowedDates, extractDateLiterals(item.excerpt));
  }

  const packet: AssistantContextPacket = {
    question: input.question,
    selectedCategory: input.selectedCategory,
    intent: input.intent,
    evidenceIntent: input.evidenceIntent,
    facts,
    evidence,
    allowedAmounts: [...allowedAmounts].sort((left, right) => left - right),
    allowedDates: [...allowedDates].sort(),
    requestedAmounts: [...requestedAmounts].sort((left, right) => left - right),
    requestedDebitDays: [...requestedDebitDays].sort((left, right) => left - right),
    allowedActionTypes: allowedActionTypes(
      input.intent,
      facts,
      input.question,
    ),
    requiresCitations: isEvidenceRequiredIntent(input.intent),
    demoTierAvailable: evidence.items.some(
      (item) => item.sourceTier === "demo_policy",
    ),
    createdAt: `${input.state.asOfDate}T10:00:00.000Z`,
  };

  return {
    ...packet,
    facts,
    evidence,
    allowedAmounts: packet.allowedAmounts,
    allowedDates: packet.allowedDates,
    allowedActionTypes: packet.allowedActionTypes,
  };
}

export { extractDateLiterals, extractCurrencyAmounts };
