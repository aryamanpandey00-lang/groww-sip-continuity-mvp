import { previewSimulatedAction } from "@/lib/domain/action-engine";
import type { DemoInvestorState, SimulatedActionRequest } from "@/lib/domain/types";
import { validateCitationIds } from "@/lib/evidence/citation";
import type { CitationPacket, EvidenceIntent } from "@/lib/evidence";
import { extractCurrencyAmounts, extractDateLiterals } from "./context";
import { parseAssistantModelOutput } from "./schemas";
import type {
  AssistantContextPacket,
  AssistantModelOutput,
  AssistantProposedAction,
  RuntimeGateEvaluation,
  RuntimeGateFailure,
  RuntimeGateFailureCode,
  RuntimeGateResult,
  AssistantQualityLabel,
} from "./types";

const NEGATION_PREFIX =
  /\b(no|not|never|cannot|can not|can t|won t|will not|do not|don t|does not|doesn t|is not|isn t|are not|aren t|was not|wasn t|were not|weren t|without|unable|not able|none)\b/;

const GUARANTEE_PATTERNS = [
  /\b(guarantee|guaranteed|guarantees|assure|assured|assures) (returns?|profits?|gains?|income)\b/,
  /\b(guarantee|guaranteed|guarantees|assure|assured|assures)\b.{0,20}\b(returns?|profits?|gains?|income)\b/,
  /\b(risk[- ]free|fixed|confirmed|assured) (returns?|profits?|gains?)\b/,
  /\b(promise|promises|promised) .{0,30}\breturns?\b/,
  /\bwill (definitely|certainly|surely) (make|give|earn|return)\b/,
];

const FUND_RECOMMENDATION_PATTERNS = [
  /\b(recommend|recommends|suggest|suggests|choose|pick|select|advise)\b.{0,50}\b(mutual )?(funds?|schemes?)\b/,
  /\b(best|top|ideal)\b.{0,30}\b(mutual )?(funds?|schemes?)\b/,
  /\bshould i (invest|put money|buy)\b.{0,40}\b(fund|scheme|stock|crypto)\b/,
  /\byou should (invest|put money|buy|choose|pick)\b.{0,40}\b(fund|scheme|stock|crypto)\b/,
  /\b(put|invest) (your )?money (in|into)\b/,
  /\bwhere (should|can) i invest\b/,
  /\b(specific|particular) (mutual )?fund\b/,
];

const CREDENTIAL_PATTERNS = [
  /\b(share|send|provide|enter|tell|give|type|submit|verify|confirm)\b.{0,60}\b(otp|one time password|pan|aadhaar|password|pin|cvv|card number|account number|net banking|banking credentials|login credentials)\b/,
  /\b(otp|pan|password|pin|cvv)\b.{0,40}\b(share|send|provide|enter|tell|give|type|submit|verify|confirm)\b/,
];

const OFFICIAL_GROWW_PATTERNS = [
  /\bofficial groww\b/,
  /\b(actual|real) groww\b/,
  /\bgroww policy\b/,
  /\bgroww s policy\b/,
  /\bgroww rules?\b/,
];

const EXECUTION_PATTERNS = [
  /\b(payment|debit|instalment|installment|retry|transaction)\b.{0,45}\b(has been|have been|was|is now)\b.{0,25}\b(paid|debited|processed|completed|succeeded|successful|retried)\b/,
  /\b(paid|debited|processed|retried) successfully\b/,
  /\b(your|the) sip\b.{0,35}\b(has been|have been|was|is now)\b.{0,25}\b(modified|changed|updated|restarted|resumed|paused|stopped|cancelled)\b/,
  /\b(i|we) (have )?(modified|changed|restarted|resumed|paused|stopped|cancelled) (your|the) sip\b/,
  /\b(reward|voucher)\b.{0,35}\b(has been|have been|was|is now)\b.{0,25}\b(issued|credited|redeemed|unlocked|paid)\b/,
  /\b(action|request)\b.{0,35}\b(has been|have been|was|is now)\b.{0,25}\b(applied|completed|confirmed|executed|submitted)\b/,
];

const ACCOUNT_CLAIM_PATTERNS = [
  /\byour (actual |real |current )?(account|folio) (balance|value|is|has|shows)\b/,
  /\byou have \d+/,
  /\byour (payment|debit|sip|instalment|installment) (is|was|has|will|has been|was been)\b/,
  /\byour reward (is|was|has|will)\b/,
];

const SYSTEM_PROMPT_DISCLOSURE_PATTERNS = [
  /\b(system|developer) prompt\b/,
  /\b(hidden|secret) instructions\b/,
  /\bmy instructions are\b/,
  /\bthe instructions say\b/,
];

const CHAIN_OF_THOUGHT_PATTERNS = [
  /\bchain[- ]of[- ]thought\b/,
  /\b(hidden|internal|private) (reasoning|thought process)\b/,
  /\b(show|reveal|print|share) (your|the) (reasoning|thought process|scratchpad)\b/,
  /\b(reasoning|analysis|thought process|scratchpad)\s*:/,
  /\bhere is (my|the) (reasoning|thought process)\b/,
];

const INJECTION_OVERRIDE_PATTERNS = [
  /\bignore (all |any |the |your )?(previous|prior|above|earlier) (instructions|rules|directions|prompts?)\b/,
  /\b(disregard|forget|override) (all |any |the |your )?(previous|prior|above|earlier) (instructions|rules|directions|prompts?)\b/,
  /\bsafety (rules|guardrails|limits) (are|have been) (disabled|off|removed)\b/,
  /\b(no|without) (safety )?(rules|restrictions|limits)\b/,
];

const REGULATED_ADVICE_PATTERN =
  /\b(80c|80d|tax|taxes|taxation|deduction|deductible|legal advice|lawyer|lawsuit|sue|court|sebi|amfi|rbi|irdai|regulation|regulatory|compliance|penalty)\b/;

function addUnique(
  failures: Map<RuntimeGateFailureCode, RuntimeGateFailure>,
  code: RuntimeGateFailureCode,
  message: string,
): void {
  if (!failures.has(code)) {
    failures.set(code, { code, message, repairable: true });
  }
}

function allMatches(text: string, pattern: RegExp): RegExpExecArray[] {
  const flags = pattern.flags.includes("g")
    ? pattern.flags
    : `${pattern.flags}g`;
  return [...text.matchAll(new RegExp(pattern.source, flags))];
}

function isNegated(output: string, index: number, window = 45): boolean {
  const prefix = output.slice(Math.max(0, index - window), index);
  return NEGATION_PREFIX.test(prefix);
}

function containsNonNegated(
  output: string,
  patterns: RegExp[],
  window = 45,
): boolean {
  for (const pattern of patterns) {
    for (const match of allMatches(output, pattern)) {
      if (!isNegated(output, match.index ?? 0, window)) {
        return true;
      }
    }
  }

  return false;
}

function combineOutputText(output: AssistantModelOutput): string {
  return [output.directAnswer, ...output.keyPoints, output.followUpQuestion]
    .filter((part) => part.trim().length > 0)
    .join("\n");
}

function extractClaimedAmounts(rawText: string): number[] {
  const amounts = new Set<number>(extractCurrencyAmounts(rawText));
  const plainNumberPattern = /(?<![\d,])\d{3,6}(?![\d,])/g;

  for (const match of rawText.matchAll(plainNumberPattern)) {
    const parsed = Number(match[0]);

    // Calendar years appear in allowed dates and are not money claims.
    if (parsed >= 1900 && parsed <= 2200) {
      continue;
    }

    if (Number.isFinite(parsed)) {
      amounts.add(parsed);
    }
  }

  return [...amounts];
}

function buildCitationPacket(packet: AssistantContextPacket): CitationPacket {
  return {
    query: {
      question: packet.question,
      intent: (packet.evidenceIntent ?? "sip_basics") as EvidenceIntent,
    },
    results: packet.evidence.items,
    evidenceIds: packet.evidence.evidenceIds,
  };
}

function toSimulatedAction(
  action: AssistantProposedAction,
): SimulatedActionRequest | null {
  switch (action.type) {
    case "NONE":
      return null;
    case "RETRY_PAYMENT":
      return { type: "RETRY_PAYMENT", cycleId: action.cycleId };
    case "MODIFY_AMOUNT":
      return { type: "MODIFY_AMOUNT", amount: action.amount };
    case "MODIFY_DEBIT_DAY":
      return { type: "MODIFY_DEBIT_DAY", debitDay: action.debitDay };
    case "RESTART_SIP":
      return { type: "RESTART_SIP" };
  }
}

function actionAllowedForIntent(
  action: AssistantProposedAction,
  packet: AssistantContextPacket,
): boolean {
  if (action.type === "NONE") {
    return true;
  }

  switch (action.type) {
    case "RETRY_PAYMENT":
      return (
        packet.intent === "PAYMENT_FAILED" ||
        packet.intent === "INSUFFICIENT_FUNDS"
      );
    case "MODIFY_AMOUNT":
    case "MODIFY_DEBIT_DAY":
      return packet.intent === "MODIFY_SIP";
    case "RESTART_SIP":
      return packet.intent === "RESTART_SIP";
  }
}

function requiredCitationTier(
  packet: AssistantContextPacket,
): "demo_policy" | "general_education" | "official_groww" | null {
  switch (packet.intent) {
    case "INSUFFICIENT_FUNDS":
    case "PAYMENT_FAILED":
    case "MODIFY_SIP":
    case "RESTART_SIP":
    case "REWARD_MILESTONE":
      return "demo_policy";
    case "MARKET_UNCERTAINTY":
    case "GENERAL_SIP_EDUCATION":
      return "general_education";
    case "OFFICIAL_GROWW_POLICY":
      return "official_groww";
    default:
      return null;
  }
}

function qualityLabelFor(
  output: AssistantModelOutput,
  packet: AssistantContextPacket,
): AssistantQualityLabel {
  if (output.refusal) {
    return "Safety guidance";
  }

  const tiers = new Set(
    packet.evidence.items
      .filter((item) => output.citedEvidenceIds.includes(item.evidenceId))
      .map((item) => item.sourceTier),
  );

  if (tiers.has("general_education") || tiers.has("official_groww")) {
    return "Evidence-backed";
  }

  return "Limited evidence";
}

function checkStatusAndExecutionClaims(
  output: AssistantModelOutput,
  packet: AssistantContextPacket,
  state: DemoInvestorState,
  text: string,
  failures: Map<RuntimeGateFailureCode, RuntimeGateFailure>,
): void {
  const statusMatch = text.match(
    /\b(?:your|the) sip (?:is|remains|is currently|will remain) (active|paused|stopped)\b/,
  );

  if (statusMatch) {
    const claimed = statusMatch[1].toUpperCase();
    const actual = String(packet.facts.sipStatus);
    const activeWithFailedPayment =
      claimed === "ACTIVE" &&
      (actual === "ACTIVE" || actual === "PAYMENT_FAILED");

    if (!activeWithFailedPayment && claimed !== actual) {
      addUnique(
        failures,
        "PAYMENT_STATE_CONTRADICTION",
        "The response contradicts the deterministic SIP lifecycle status.",
      );
    }
  }

  if (
    packet.facts.retryEligible === false &&
    /\b(retry window is (open|still open)|you can retry|you may retry|eligible (to|for) (a )?retry|retry is available)\b/.test(
      text,
    )
  ) {
    addUnique(
      failures,
      "PAYMENT_STATE_CONTRADICTION",
      "The response claims retry availability that the deterministic facts do not support.",
    );
  }

  if (
    packet.facts.latestPaymentStatus === "FAILED" &&
    /\b(no|not any) (failed|due) (payment|debit|cycle)\b/.test(text)
  ) {
    addUnique(
      failures,
      "PAYMENT_STATE_CONTRADICTION",
      "The response denies a failed payment that exists in deterministic facts.",
    );
  }

  if (
    packet.facts.restartEligible === false &&
    /\b(you can restart|you may restart|eligible to restart|restart (is|window is) (available|open)|restart is allowed)\b/.test(
      text,
    )
  ) {
    addUnique(
      failures,
      "PAYMENT_STATE_CONTRADICTION",
      "The response claims restart availability that the deterministic facts do not support.",
    );
  }

  const monthlyAmountClaim = text.match(
    /\byour (?:current |fictional )?monthly (?:sip )?amount is (?:₹|rs\.?|inr)?\s*([\d,]+)/i,
  );

  if (monthlyAmountClaim) {
    const claimedAmount = Number(monthlyAmountClaim[1]?.replace(/,/g, ""));

    if (claimedAmount !== packet.facts.monthlyAmount) {
      addUnique(
        failures,
        "INVENTED_AMOUNT",
        "The response states a monthly amount that contradicts deterministic facts.",
      );
    }
  }

  const debitDayClaim = text.match(
    /\b(?:your|the) (?:sip )?debit day is (?:the )?(\d{1,2})(?:st|nd|rd|th)?\b/,
  );

  if (debitDayClaim) {
    const claimedDay = Number(debitDayClaim[1]);

    if (claimedDay !== packet.facts.debitDay) {
      addUnique(
        failures,
        "PAYMENT_STATE_CONTRADICTION",
        "The response states a debit day that contradicts deterministic facts.",
      );
    }
  }

  const rewardProgressClaim = text.match(/\byou have (\d{1,2}) of (\d{1,2})\b/);

  if (rewardProgressClaim) {
    const claimedEligible = Number(rewardProgressClaim[1]);
    const claimedTarget = Number(rewardProgressClaim[2]);

    if (
      claimedEligible !== packet.facts.rewardEligibleInstalments ||
      claimedTarget !== packet.facts.rewardTargetInstalments
    ) {
      addUnique(
        failures,
        "PAYMENT_STATE_CONTRADICTION",
        "The response states reward progress that contradicts deterministic facts.",
      );
    }
  }

  if (
    packet.facts.rewardUnlocked === false &&
    /\b(reward|voucher) (is|has been) (unlocked|issued|credited|available)\b/.test(
      text,
    )
  ) {
    addUnique(
      failures,
      "PAYMENT_STATE_CONTRADICTION",
      "The response claims the reward milestone is complete when it is not.",
    );
  }

  for (const pattern of EXECUTION_PATTERNS) {
    for (const match of allMatches(text, pattern)) {
      const phrase = match[0];

      if (/\b(not|never|cannot|can t)\b/.test(phrase)) {
        continue;
      }

      addUnique(
        failures,
        "EXECUTION_CLAIM",
        "The response claims a simulated action, payment or reward was executed.",
      );
      break;
    }
  }

  if (output.proposedAction.type !== "NONE") {
    const action = output.proposedAction;

    if (!actionAllowedForIntent(action, packet)) {
      addUnique(
        failures,
        "ACTION_NOT_ALLOWED_FOR_INTENT",
        "The proposed action is not valid for the deterministic intent.",
      );
    }

    if (!packet.allowedActionTypes.includes(action.type)) {
      addUnique(
        failures,
        "ACTION_INVALID",
        "The proposed action is not in the allowed action list for this request.",
      );
    }

    if (action.type === "MODIFY_AMOUNT") {
      if (!packet.allowedAmounts.includes(action.amount)) {
        addUnique(
          failures,
          "INVENTED_AMOUNT",
          "The proposed action amount was not supplied by the user or authoritative context.",
        );
      }

      if (!packet.requestedAmounts.includes(action.amount)) {
        addUnique(
          failures,
          "INVENTED_AMOUNT",
          "The proposed action amount was not explicitly requested by the user.",
        );
      }
    }

    if (action.type === "MODIFY_DEBIT_DAY") {
      if (!packet.requestedDebitDays.includes(action.debitDay)) {
        addUnique(
          failures,
          "ACTION_INVALID",
          "The proposed debit day was not explicitly requested by the user.",
        );
      }
    }

    if (
      action.type === "RETRY_PAYMENT" &&
      action.cycleId !== packet.facts.failedCycleId
    ) {
      addUnique(
        failures,
        "ACTION_INVALID",
        "The proposed retry does not target the verified failed cycle.",
      );
    }
  }

  if (output.refusal && output.proposedAction.type !== "NONE") {
    addUnique(
      failures,
      "ACTION_WITH_REFUSAL",
      "A refusal must not propose an action.",
    );
  }

  // Execution is deliberately limited to a deterministic preview. No apply
  // function is imported or called by the runtime gate.
  if (output.proposedAction.type !== "NONE") {
    const request = toSimulatedAction(output.proposedAction);

    if (request) {
      try {
        const preview = previewSimulatedAction(
          state,
          request,
          packet.createdAt,
        );

        if (preview.status !== "PREVIEWED" || !preview.requiresConfirmation) {
          addUnique(
            failures,
            "ACTION_INVALID",
            "The proposed action failed deterministic domain preview validation.",
          );
        }
      } catch {
        addUnique(
          failures,
          "ACTION_INVALID",
          "The proposed action could not be previewed safely.",
        );
      }
    }
  }
}

export function evaluateRuntimeGate(input: {
  rawOutput: string | unknown;
  packet: AssistantContextPacket;
  state: DemoInvestorState;
  checkedAt?: string;
}): RuntimeGateEvaluation {
  const checkedAt = input.checkedAt ?? input.packet.createdAt;
  const parsed = parseAssistantModelOutput(input.rawOutput);

  if (!parsed.success) {
    return {
      output: null,
      result: {
        passed: false,
        criticalFailures: [
          {
            code: "SCHEMA_INVALID",
            message: parsed.issues.join(" "),
            repairable: true,
          },
        ],
        checkedAt,
        qualityLabel: null,
      },
    };
  }

  const output = parsed.output;
  const packet = input.packet;
  const failures = new Map<RuntimeGateFailureCode, RuntimeGateFailure>();
  const rawText = combineOutputText(output);
  const text = rawText
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s%.,:/-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (output.intent !== packet.intent) {
    addUnique(
      failures,
      "INTENT_MISMATCH",
      "The model intent does not match the deterministic intent.",
    );
  }

  const citationPacket = buildCitationPacket(packet);
  const citationValidation = validateCitationIds(
    output.citedEvidenceIds,
    citationPacket,
  );

  if (!citationValidation.valid) {
    addUnique(
      failures,
      "CITATION_SCOPE_VIOLATION",
      `Citations are outside the retrieved evidence packet: ${citationValidation.invalidIds.join(", ")}.`,
    );
  }

  if (new Set(output.citedEvidenceIds).size !== output.citedEvidenceIds.length) {
    addUnique(
      failures,
      "DUPLICATE_CITATION",
      "The response contains duplicate evidence citations.",
    );
  }

  const citedItems = packet.evidence.items.filter((item) =>
    output.citedEvidenceIds.includes(item.evidenceId),
  );
  const citedTiers = new Set(citedItems.map((item) => item.sourceTier));

  if (!output.refusal && packet.requiresCitations) {
    if (output.citedEvidenceIds.length === 0) {
      addUnique(
        failures,
        "MISSING_CITATIONS",
        "Factual guidance requires at least one valid evidence citation.",
      );
    }

    const tier = requiredCitationTier(packet);

    if (tier && !citedTiers.has(tier)) {
      addUnique(
        failures,
        "MISSING_REQUIRED_CITATION_TIER",
        `The response does not cite the required ${tier} evidence tier.`,
      );
    }
  }

  if (citedTiers.has("demo_policy") && !/\b(demo|fictional)\b/.test(text)) {
    addUnique(
      failures,
      "DEMO_POLICY_MISATTRIBUTION",
      "Demo-policy guidance must be labelled as fictional/demo policy.",
    );
  }

  for (const pattern of OFFICIAL_GROWW_PATTERNS) {
    for (const match of allMatches(text, pattern)) {
      if (!isNegated(text, match.index ?? 0)) {
        addUnique(
          failures,
          "DEMO_POLICY_MISATTRIBUTION",
          "The response attributes fictional demo policy to Groww.",
        );
        break;
      }
    }
  }

  if (packet.intent === "ACCOUNT_SPECIFIC" && !output.refusal) {
    addUnique(
      failures,
      "ACCOUNT_SPECIFIC_UNSUPPORTED",
      "Account-specific evidence is unavailable for this request.",
    );
  }

  if (citedTiers.size === 1 && citedTiers.has("general_education")) {
    for (const pattern of ACCOUNT_CLAIM_PATTERNS) {
      if (pattern.test(text)) {
        addUnique(
          failures,
          "ACCOUNT_SPECIFIC_UNSUPPORTED",
          "General education evidence cannot support an account-specific claim.",
        );
        break;
      }
    }
  }

  for (const amount of extractClaimedAmounts(rawText)) {
    if (!packet.allowedAmounts.includes(amount)) {
      addUnique(
        failures,
        "INVENTED_AMOUNT",
        `The response contains an amount not present in authoritative context: ${amount}.`,
      );
      break;
    }
  }

  for (const date of extractDateLiterals(rawText)) {
    if (!packet.allowedDates.includes(date)) {
      addUnique(
        failures,
        "INVENTED_DATE",
        `The response contains a date not present in authoritative context: ${date}.`,
      );
      break;
    }
  }

  checkStatusAndExecutionClaims(output, packet, input.state, text, failures);

  if (containsNonNegated(text, GUARANTEE_PATTERNS, 55)) {
    addUnique(
      failures,
      "GUARANTEED_RETURN_CLAIM",
      "The response makes a guaranteed-return claim.",
    );
  }

  if (containsNonNegated(text, FUND_RECOMMENDATION_PATTERNS, 55)) {
    addUnique(
      failures,
      "FUND_RECOMMENDATION",
      "The response recommends a specific fund.",
    );
  }

  if (!output.refusal) {
    for (const match of allMatches(text, REGULATED_ADVICE_PATTERN)) {
      if (isNegated(text, match.index ?? 0, 55)) {
        continue;
      }

      const evidenceText = packet.evidence.items
        .map((item) => `${item.title} ${item.excerpt}`.toLowerCase())
        .join(" ");
      const term = match[0];

      if (!evidenceText.includes(term)) {
        addUnique(
          failures,
          "UNSUPPORTED_REGULATED_ADVICE",
          "The response gives tax, legal or regulatory guidance without supporting evidence.",
        );
        break;
      }
    }
  }

  if (containsNonNegated(text, CREDENTIAL_PATTERNS, 55)) {
    addUnique(
      failures,
      "CREDENTIAL_REQUEST",
      "The response requests credentials or sensitive financial identifiers.",
    );
  }

  if (containsNonNegated(text, SYSTEM_PROMPT_DISCLOSURE_PATTERNS, 55)) {
    addUnique(
      failures,
      "SYSTEM_PROMPT_DISCLOSURE",
      "The response discloses hidden instructions or prompts.",
    );
  }

  if (containsNonNegated(text, CHAIN_OF_THOUGHT_PATTERNS, 55)) {
    addUnique(
      failures,
      "CHAIN_OF_THOUGHT_DISCLOSURE",
      "The response exposes hidden reasoning or chain-of-thought.",
    );
  }

  if (containsNonNegated(text, INJECTION_OVERRIDE_PATTERNS, 45)) {
    addUnique(
      failures,
      "PROMPT_INJECTION_OVERRIDE",
      "The response follows a prompt-injection instruction.",
    );
  }

  const criticalFailures = [...failures.values()];
  const result: RuntimeGateResult = {
    passed: criticalFailures.length === 0,
    criticalFailures,
    checkedAt,
    qualityLabel:
      criticalFailures.length === 0 ? qualityLabelFor(output, packet) : null,
  };

  return { output, result };
}
