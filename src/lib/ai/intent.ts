import { normalizeText } from "@/lib/evidence/scoring";
import type { EvidenceIntent } from "@/lib/evidence";
import {
  ASSISTANT_PROBLEM_CATEGORIES,
  type AssistantIntent,
  type AssistantProblemCategory,
} from "./types";

const SAFETY_OVERRIDE_INTENTS = new Set<AssistantIntent>([
  "PROMPT_INJECTION",
  "GUARANTEED_RETURN_REQUEST",
  "FUND_RECOMMENDATION_REQUEST",
  "OUT_OF_SCOPE",
]);

const EVIDENCE_REQUIRED_INTENTS = new Set<AssistantIntent>([
  "INSUFFICIENT_FUNDS",
  "PAYMENT_FAILED",
  "MARKET_UNCERTAINTY",
  "MODIFY_SIP",
  "RESTART_SIP",
  "REWARD_MILESTONE",
  "GENERAL_SIP_EDUCATION",
  "OFFICIAL_GROWW_POLICY",
]);

const ACTION_INTENTS = new Set<AssistantIntent>([
  "PAYMENT_FAILED",
  "INSUFFICIENT_FUNDS",
  "MODIFY_SIP",
  "RESTART_SIP",
]);

const CATEGORY_INTENT: Record<AssistantProblemCategory, AssistantIntent> = {
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  MARKET_UNCERTAINTY: "MARKET_UNCERTAINTY",
  MODIFY_SIP: "MODIFY_SIP",
  RESTART_SIP: "RESTART_SIP",
  REWARD_MILESTONE: "REWARD_MILESTONE",
};

const INJECTION_PATTERNS = [
  /\bignore (all |any |the |your )?(previous|prior|above|earlier) (instructions|rules|directions|prompts?)\b/,
  /\b(disregard|forget|override) (all |any |the |your )?(previous|prior|above|earlier) (instructions|rules|directions|prompts?)\b/,
  /\b(reveal|show|print|repeat|output|tell me) (your|the) (system|developer|hidden|secret) (prompt|instructions|message|rules)\b/,
  /\b(system|developer) prompt\b/,
  /\b(jailbreak|developer mode|dan mode|do anything now|bypass (safety|guardrails?|confirmation))\b/,
  /\byou are now (a|an|the|my) \w+/,
  /\bact as (a|an|the|my) \w+/,
  /\bpretend (that )?you (are|have) (no|without) (rules|restrictions|limits)\b/,
  /\bprompt injection\b/,
  /\bnew instructions?:/,
];

const GUARANTEE_PATTERNS = [
  /\b(guarantee|guaranteed|guarantees|assure|assured|assures) (returns?|profits?|gains?|income)\b/,
  /\b(guarantee|guaranteed|guarantees|assure|assured|assures)\b.{0,20}\b(returns?|profits?|gains?|income)\b/,
  /\b(risk[- ]free|fixed|confirmed|assured) (returns?|profits?|gains?)\b/,
  /\b(promise|promises|promised) .{0,30}\breturns?\b/,
  /\bwill (definitely|certainly|surely) (make|give|earn|return)\b/,
  /\b\d+(\.\d+)?% (guaranteed|assured|risk[- ]free) (returns?|profits?)\b/,
];

const FUND_RECOMMENDATION_PATTERNS = [
  /\b(recommend|suggest|choose|pick|select|shortlist)\b.{0,50}\b(mutual )?funds?\b/,
  /\b(best|top|greatest|ideal)\b.{0,30}\b(mutual )?funds?\b/,
  /\bwhich\b.{0,40}\b(mutual )?funds?\b.{0,30}\b(buy|invest|choose|pick|best)\b/,
  /\bwhich\b.{0,25}\b(mutual )?funds?\b/,
  /\bshould i (invest|put money|buy)\b.{0,40}\b(fund|scheme|stock|crypto)\b/,
  /\bwhere (should|can) i invest\b/,
  /\bfund recommendation\b/,
  /\b(specific|particular) (mutual )?fund\b/,
];

const ACCOUNT_SPECIFIC_PATTERNS = [
  /\bmy (?:actual |real |groww ){0,3}(account|folio|portfolio|bank|transaction|holding|balance)\b/,
  /\bmy (personal|real) (account|investment|money|data)\b/,
  /\bwhat is my (?:actual |real |groww ){0,3}(account|folio|portfolio|balance|holding)\b/,
  /\bmy bank (account|balance|details)\b/,
  /\bmy (pan|aadhaar|otp|password|pin|cvv)\b/,
];

const OFFICIAL_POLICY_PATTERNS = [
  /\b(groww|groww s|growws)\b.{0,30}\b(official )?(policy|policies|rules?|terms?|guidelines?)\b/,
  /\bofficial groww\b.{0,30}\b(policy|policies|rules?|terms?|guidelines?|support|documentation)\b/,
  /\b(actual|real) groww\b.{0,30}\b(policy|policies|rules?|terms?|guidelines?)\b/,
  /\bgroww (app|platform) (rule|policy|term|guideline)\b/,
];

const CREDENTIAL_PATTERNS = [
  /\b(share|send|provide|enter|tell|give|type|submit|verify|confirm)\b.{0,60}\b(otp|one[- ]time password|pan|aadhaar|password|pin|cvv|card number|account number|net ?banking|banking credentials|login credentials)\b/,
  /\b(otp|pan|password|pin|cvv)\b.{0,40}\b(share|send|provide|enter|tell|give|type|submit|verify|confirm)\b/,
];

const OUT_OF_SCOPE_PATTERNS = [
  /\b(tax|taxes|taxation|80c|80d|capital gains?|deduction|deductible)\b/,
  /\b(legal|lawyer|lawsuit|sue|court|consumer court|arbitration)\b/,
  /\b(regulation|regulatory|compliance|circular|sebi|amfi|rbi|irdai)\b.{0,40}\b(advice|rule|require|law|penalty|action|compliance)\b/,
  /\b(crypto|bitcoin|ethereum|nft|option trading|f&o|intraday|stock tip|penny stock)\b/,
  /\b(file|draft) (a )?(complaint|legal notice)\b/,
];

const UNSUPPORTED_EVIDENCE_PATTERNS = [
  /\b(expense ratio|expense ratios|exit load|aum|assets under management|prospectus|fact ?sheet|historical nav|tracking error|portfolio turnover)\b/,
];

const INSUFFICIENT_FUNDS_PATTERNS = [
  /\binsufficient (funds?|balance|money)\b/,
  /\b(not enough|no enough|little|low) (money|funds?|balance)\b/,
  /\bbank (balance|account) (is )?(low|empty|insufficient)\b/,
  /\bdebit (failed|declined) .{0,30}\b(balance|funds?|money)\b/,
  /\bfailed .{0,30}\binsufficient (funds?|balance)\b/,
];

const PAYMENT_FAILED_PATTERNS = [
  /\b(payment|debit|autopay|auto pay|mandate|transaction|instalment|installment|cycle)\b.{0,30}\b(fail|fails|failed|failing|failure|declined|rejected|did not go through|didn t go through|not processed)\b/,
  /\b(fail|failed|failing|declined|rejected)\b.{0,30}\b(payment|debit|autopay|auto pay|mandate|transaction|instalment|installment|cycle)\b/,
  /\bwhy (did|has|was) (it|my payment|my debit) (fail|failed|declined)\b/,
];

const MODIFY_PATTERNS = [
  /\b(change|modify|edit|update|increase|decrease|reduce|raise|lower|pause)\b.{0,45}\b(sip|amount|debit|date|day|instalment|installment|monthly)\b/,
  /\b(sip|amount|debit|date|day|instalment|installment)\b.{0,45}\b(change|modify|edit|update|increase|decrease|reduce|raise|lower)\b/,
  /\bchange (it|my sip|the amount|the date|the day)\b/,
];

const RESTART_PATTERNS = [
  /\brestart\b/,
  /\bresume\b/,
  /\breactivate\b/,
  /\bstart (my|the) sip again\b/,
  /\b(paused|stopped|inactive) sip\b/,
];

const REWARD_PATTERNS = [
  /\breward(s|ed)?\b/,
  /\bmilestone\b/,
  /\bvoucher\b/,
  /\b12(th)? (paid )?instal?ments?\b/,
  /\bprogress\b.{0,20}\b(instal|reward|milestone)\b/,
];

const MARKET_PATTERNS = [
  /\bmarket\b/,
  /\bvolatil(e|ity)\b/,
  /\bnav\b/,
  /\bcorrection\b/,
  /\bdownturn\b/,
  /\bcrash\b/,
  /\bfluctuat(e|ion|ing)\b/,
  /\bfund value (fell|dropped|down)\b/,
  /\bportfolios? (fell|dropped|down)\b/,
];

const GENERAL_EDUCATION_PATTERNS = [
  /\bwhat is (a )?sip\b/,
  /\bhow (does|do|to) (a )?sip\b/,
  /\bsip basics\b/,
  /\bmutual funds?\b/,
  /\binvest(ing|ment|or)?\b/,
  /\bcompound(ing)?\b/,
  /\bdiversif(y|ication)\b/,
  /\brisk\b/,
  /\blong[- ]term\b/,
  /\bdiscipline\b/,
  /\blump ?sum\b/,
  /\binvestor (support|grievance|complaint|helpline)\b/,
  /\bcomplaint\b/,
  /\bgrievance\b/,
  /\bsip vs\b/,
];

const FINANCE_CONTEXT_PATTERN =
  /\b(sip|mutual fund|groww|investment|invest|payment|debit|autopay|instalment|installment|retry|reward|portfolio|nav|market)\b/;

const VAGUE_QUESTIONS = new Set([
  "help",
  "hi",
  "hello",
  "hey",
  "help me",
  "i need help",
  "can you help",
  "can you help me",
  "what can you do",
  "what can i do",
  "tell me more",
  "something is wrong",
  "problem",
  "issue",
]);

function matches(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function isAssistantProblemCategory(
  value: unknown,
): value is AssistantProblemCategory {
  return (
    typeof value === "string" &&
    (ASSISTANT_PROBLEM_CATEGORIES as readonly string[]).includes(value)
  );
}

export function isSafetyOverrideIntent(intent: AssistantIntent): boolean {
  return SAFETY_OVERRIDE_INTENTS.has(intent);
}

export function isEvidenceRequiredIntent(intent: AssistantIntent): boolean {
  return EVIDENCE_REQUIRED_INTENTS.has(intent);
}

export function isActionIntent(intent: AssistantIntent): boolean {
  return ACTION_INTENTS.has(intent);
}

export function isPromptInjectionQuestion(question: string): boolean {
  return matches(normalizeText(question), INJECTION_PATTERNS);
}

export function isGuaranteedReturnQuestion(question: string): boolean {
  return matches(normalizeText(question), GUARANTEE_PATTERNS);
}

export function isFundRecommendationQuestion(question: string): boolean {
  return matches(normalizeText(question), FUND_RECOMMENDATION_PATTERNS);
}

export function isCredentialRequestQuestion(question: string): boolean {
  return matches(normalizeText(question), CREDENTIAL_PATTERNS);
}

export function isAccountSpecificQuestion(question: string): boolean {
  return matches(normalizeText(question), ACCOUNT_SPECIFIC_PATTERNS);
}

export function isVagueQuestion(question: string): boolean {
  return VAGUE_QUESTIONS.has(normalizeText(question));
}

function educationEvidenceIntent(text: string): EvidenceIntent {
  if (/\b(volatil|market|nav|correction|crash|downturn|fluctuat)\b/.test(text)) {
    return "market_volatility";
  }

  if (/\b(risk|safe|loss|protect)\b/.test(text)) {
    return "investment_risk";
  }

  if (/\b(long term|longterm|compound|retirement|10 years?|15 years?)\b/.test(text)) {
    return "long_term_investing";
  }

  if (/\b(discipline|timing|consistency|every month)\b/.test(text)) {
    return "sip_discipline";
  }

  if (/\b(lump ?sum|one time)\b/.test(text)) {
    return "sip_vs_lumpsum";
  }

  if (/\b(support|grievance|complaint|helpline|contact)\b/.test(text)) {
    return "investor_support";
  }

  return "sip_basics";
}

/**
 * Deterministic intent classifier. Safety-critical and scope classifications
 * always win. A category selected in the UI is only used as fallback context
 * when the question does not contain a stronger intent signal.
 */
export function classifyIntent(
  question: string,
  selectedCategory: AssistantProblemCategory | null = null,
): AssistantIntent {
  const text = normalizeText(question);
  const categoryIntent = selectedCategory
    ? CATEGORY_INTENT[selectedCategory]
    : null;

  if (isPromptInjectionQuestion(question)) {
    return "PROMPT_INJECTION";
  }

  if (isGuaranteedReturnQuestion(question)) {
    return "GUARANTEED_RETURN_REQUEST";
  }

  if (isFundRecommendationQuestion(question)) {
    return "FUND_RECOMMENDATION_REQUEST";
  }

  if (isCredentialRequestQuestion(question)) {
    return "OUT_OF_SCOPE";
  }

  if (matches(text, OUT_OF_SCOPE_PATTERNS)) {
    return "OUT_OF_SCOPE";
  }

  if (matches(text, OFFICIAL_POLICY_PATTERNS)) {
    return "OFFICIAL_GROWW_POLICY";
  }

  if (matches(text, UNSUPPORTED_EVIDENCE_PATTERNS)) {
    return "INSUFFICIENT_EVIDENCE";
  }

  if (matches(text, MODIFY_PATTERNS)) {
    return "MODIFY_SIP";
  }

  if (matches(text, RESTART_PATTERNS)) {
    return "RESTART_SIP";
  }

  if (matches(text, INSUFFICIENT_FUNDS_PATTERNS)) {
    return "INSUFFICIENT_FUNDS";
  }

  if (matches(text, PAYMENT_FAILED_PATTERNS)) {
    return "PAYMENT_FAILED";
  }

  if (matches(text, REWARD_PATTERNS)) {
    return "REWARD_MILESTONE";
  }

  if (matches(text, MARKET_PATTERNS)) {
    return "MARKET_UNCERTAINTY";
  }

  if (isAccountSpecificQuestion(question)) {
    return "ACCOUNT_SPECIFIC";
  }

  if (matches(text, GENERAL_EDUCATION_PATTERNS)) {
    return "GENERAL_SIP_EDUCATION";
  }

  if (categoryIntent) {
    return categoryIntent;
  }

  if (FINANCE_CONTEXT_PATTERN.test(text)) {
    return "GENERAL_SIP_EDUCATION";
  }

  return "OUT_OF_SCOPE";
}

/**
 * Maps a user-facing assistant intent to the narrower Phase 3 evidence intent.
 * Returning null means there is no evidence retrieval appropriate for the
 * request; the pipeline will use a deterministic safety or scope fallback.
 */
export function evidenceIntentForAssistantIntent(
  intent: AssistantIntent,
  question: string,
): EvidenceIntent | null {
  const text = normalizeText(question);

  switch (intent) {
    case "INSUFFICIENT_FUNDS":
      return "insufficient_funds";
    case "PAYMENT_FAILED":
      return "retry_payment";
    case "MARKET_UNCERTAINTY":
      return "market_volatility";
    case "MODIFY_SIP":
      if (/\b(day|date)\b/.test(text)) {
        return "modify_debit_day";
      }
      return "modify_sip_amount";
    case "RESTART_SIP":
      return "restart_sip";
    case "REWARD_MILESTONE":
      return "reward_progress";
    case "GENERAL_SIP_EDUCATION":
      return educationEvidenceIntent(text);
    case "OFFICIAL_GROWW_POLICY":
      return "official_groww_policy";
    case "ACCOUNT_SPECIFIC":
      return "account_specific";
    case "GUARANTEED_RETURN_REQUEST":
      return "guaranteed_returns";
    case "FUND_RECOMMENDATION_REQUEST":
    case "OUT_OF_SCOPE":
    case "PROMPT_INJECTION":
    case "INSUFFICIENT_EVIDENCE":
      return null;
    default:
      return null;
  }
}

export function mentionsModifyAmount(question: string): boolean {
  return /\b(amount|monthly|instalment|installment)\b/.test(
    normalizeText(question),
  );
}

export function mentionsModifyDay(question: string): boolean {
  return /\b(day|date|debit)\b/.test(normalizeText(question));
}
