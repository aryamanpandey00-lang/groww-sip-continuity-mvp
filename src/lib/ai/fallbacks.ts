import type { RetrievalResult } from "@/lib/evidence";
import type { GoldenFallbackReason } from "@/lib/evaluation";
import { isCredentialRequestQuestion } from "./intent";
import type {
  AssistantConfigUnavailableReason,
  AssistantFallbackReason,
  AssistantIntent,
  AssistantProposedAction,
  AssistantQualityLabel,
  AssistantStatus,
} from "./types";

export interface AssistantFallbackContent {
  status: AssistantStatus;
  qualityLabel: AssistantQualityLabel;
  fallbackReason: AssistantFallbackReason;
  evaluationFallbackReason: GoldenFallbackReason;
  directAnswer: string;
  keyPoints: string[];
  citedEvidenceIds: string[];
  proposedAction: AssistantProposedAction;
  followUpQuestion: string;
  refusal: boolean;
  fallbackUsed: boolean;
}

const NO_ACTION_NOTE = "No action has been taken.";

export function toEvaluationFallbackReason(
  reason: AssistantFallbackReason,
): GoldenFallbackReason {
  switch (reason) {
    case "NONE":
    case "MISSING_INFORMATION":
    case "INPUT_INVALID":
      return "NONE";
    case "ASSISTANT_DISABLED":
    case "MISSING_CONFIG":
    case "MODEL_UNAVAILABLE":
    case "MODEL_TIMEOUT":
    case "MODEL_INVALID_OUTPUT":
      return "MODEL_UNAVAILABLE";
    case "OFFICIAL_EVIDENCE_UNAVAILABLE":
      return "OFFICIAL_EVIDENCE_UNAVAILABLE";
    case "ACCOUNT_SPECIFIC_UNAVAILABLE":
      return "ACCOUNT_SPECIFIC_UNAVAILABLE";
    case "INSUFFICIENT_EVIDENCE":
      return "INSUFFICIENT_EVIDENCE";
    case "CONFIRMATION_REQUIRED":
      return "CONFIRMATION_REQUIRED";
    case "ACTION_NOT_ELIGIBLE":
      return "ACTION_NOT_ELIGIBLE";
    case "CITATION_SCOPE_VIOLATION":
      return "CITATION_SCOPE_VIOLATION";
    case "SAFETY_REFUSAL":
    case "GATE_FAILED":
    case "REPAIR_FAILED":
      return "SAFETY_REFUSAL";
  }
}

function baseContent(
  overrides: Partial<AssistantFallbackContent> &
    Pick<AssistantFallbackContent, "qualityLabel" | "fallbackReason" | "directAnswer">,
): AssistantFallbackContent {
  return {
    status: "SAFE_FALLBACK",
    evaluationFallbackReason: toEvaluationFallbackReason(
      overrides.fallbackReason,
    ),
    keyPoints: [],
    citedEvidenceIds: [],
    proposedAction: { type: "NONE" },
    followUpQuestion: "",
    refusal: false,
    fallbackUsed: true,
    ...overrides,
  };
}

export function buildMissingInformationContent(
  question: string,
): AssistantFallbackContent {
  return {
    status: "NEEDS_MORE_INFORMATION",
    qualityLabel: "Need more information",
    fallbackReason: "MISSING_INFORMATION",
    evaluationFallbackReason: "NONE",
    directAnswer: question,
    keyPoints: [],
    citedEvidenceIds: [],
    proposedAction: { type: "NONE" },
    followUpQuestion: question,
    refusal: false,
    fallbackUsed: false,
  };
}

export function buildInputInvalidContent(maxInputChars: number): AssistantFallbackContent {
  return baseContent({
    qualityLabel: "Safe fallback",
    fallbackReason: "INPUT_INVALID",
    directAnswer: `I couldn't process that request. Please keep the question under ${maxInputChars.toLocaleString("en-IN")} characters and ask about a failed payment, a SIP change, restart, reward progress, or general SIP education. ${NO_ACTION_NOTE}`,
  });
}

export function buildConfigUnavailableContent(
  reason: AssistantConfigUnavailableReason,
  fallbackReason: AssistantFallbackReason,
): AssistantFallbackContent {
  const directAnswer =
    reason === "ASSISTANT_DISABLED"
      ? `The assistant is currently disabled. No request was sent to the model. ${NO_ACTION_NOTE}`
      : `The assistant is not fully configured, so it is unavailable. No request was sent to the model. ${NO_ACTION_NOTE}`;

  return baseContent({
    status: "UNAVAILABLE",
    qualityLabel: "Assistant unavailable",
    fallbackReason,
    directAnswer,
  });
}

export function buildModelUnavailableContent(
  reason: "MODEL_UNAVAILABLE" | "MODEL_TIMEOUT",
): AssistantFallbackContent {
  return baseContent({
    status: "UNAVAILABLE",
    qualityLabel: "Assistant unavailable",
    fallbackReason: reason,
    directAnswer: `The assistant is temporarily unavailable, so I can't provide a verified answer right now. ${NO_ACTION_NOTE} Please try again later.`,
  });
}

export function buildGateFailureContent(
  reason: "GATE_FAILED" | "REPAIR_FAILED" | "MODEL_INVALID_OUTPUT",
): AssistantFallbackContent {
  return baseContent({
    qualityLabel: "Safe fallback",
    fallbackReason: reason,
    directAnswer: `I couldn't validate a reliable answer, so I'm not showing guidance or a proposed action. ${NO_ACTION_NOTE} Please rephrase the question or try again.`,
  });
}

function noEvidenceReason(
  retrieval: RetrievalResult,
): AssistantFallbackReason {
  switch (retrieval.noEvidenceReason) {
    case "OFFICIAL_EVIDENCE_UNAVAILABLE":
      return "OFFICIAL_EVIDENCE_UNAVAILABLE";
    case "ACCOUNT_SPECIFIC_UNAVAILABLE":
      return "ACCOUNT_SPECIFIC_UNAVAILABLE";
    default:
      return "INSUFFICIENT_EVIDENCE";
  }
}

export function buildNoEvidenceContent(
  retrieval: RetrievalResult,
): AssistantFallbackContent {
  const reason = noEvidenceReason(retrieval);
  const suffix =
    reason === "OFFICIAL_EVIDENCE_UNAVAILABLE"
      ? " I can't present fictional demo rules as official Groww policy."
      : reason === "ACCOUNT_SPECIFIC_UNAVAILABLE"
        ? " I can only discuss the fictional demo account data in this project."
        : " Please ask about a failed payment, SIP modification, restart, reward progress, or general SIP education.";

  return baseContent({
    qualityLabel: "Safe fallback",
    fallbackReason: reason,
    directAnswer: `${retrieval.message}${suffix} ${NO_ACTION_NOTE}`,
  });
}

export function buildInsufficientEvidenceContent(
  message: string,
): AssistantFallbackContent {
  return baseContent({
    qualityLabel: "Safe fallback",
    fallbackReason: "INSUFFICIENT_EVIDENCE",
    directAnswer: `${message} I can't verify that topic from the available evidence, so I'm not going to guess. ${NO_ACTION_NOTE}`,
  });
}

function evidenceIdForGuarantee(retrieval: RetrievalResult | null): string[] {
  if (!retrieval) {
    return [];
  }

  const exact = retrieval.matches.find(
    (match) => match.evidenceId === "general-education.no-guaranteed-returns",
  );

  if (exact) {
    return [exact.evidenceId];
  }

  const general = retrieval.matches.find(
    (match) => match.sourceTier === "general_education",
  );

  return general ? [general.evidenceId] : [];
}

export function buildSafetyContent(
  intent: AssistantIntent,
  question: string,
  retrieval: RetrievalResult | null,
): AssistantFallbackContent {
  switch (intent) {
    case "PROMPT_INJECTION":
      return baseContent({
        qualityLabel: "Safety guidance",
        fallbackReason: "SAFETY_REFUSAL",
        directAnswer:
          "I can't follow instructions that try to change my rules, ignore safeguards, or reveal hidden instructions. I can still help with the fictional demo's SIP payment, modification, restart, reward, or general SIP education questions. " +
          NO_ACTION_NOTE,
        refusal: true,
      });

    case "GUARANTEED_RETURN_REQUEST": {
      const citedEvidenceIds = evidenceIdForGuarantee(retrieval);
      return baseContent({
        qualityLabel: "Safety guidance",
        fallbackReason: "SAFETY_REFUSAL",
        directAnswer:
          "No. Mutual-fund returns are not guaranteed or assured. Investor-education sources state that investing involves risk and there are no guaranteed returns. This is general education, not a promise about your portfolio. " +
          NO_ACTION_NOTE,
        keyPoints: [
          "Mutual-fund returns can rise or fall and are not guaranteed.",
          "A SIP does not remove market risk or assure a profit.",
        ],
        citedEvidenceIds,
        refusal: true,
      });
    }

    case "FUND_RECOMMENDATION_REQUEST":
      return baseContent({
        qualityLabel: "Safety guidance",
        fallbackReason: "SAFETY_REFUSAL",
        directAnswer:
          "I can't recommend a specific mutual fund or tell you which fund to buy. I can explain general SIP mechanics, risk, and the fictional demo's policies, but I won't make a fund recommendation. " +
          NO_ACTION_NOTE,
        keyPoints: [
          "No specific fund is being recommended.",
          "Fund selection depends on personal circumstances and is outside this demo's scope.",
        ],
        refusal: true,
      });

    case "OUT_OF_SCOPE":
      if (isCredentialRequestQuestion(question)) {
        return baseContent({
          qualityLabel: "Safety guidance",
          fallbackReason: "SAFETY_REFUSAL",
          directAnswer:
            "I will never ask you to share an OTP, PAN, password, PIN, CVV, card number, bank credentials, or other sensitive information. Please don't share those details with anyone. " +
            NO_ACTION_NOTE,
          keyPoints: [
            "Never share an OTP or banking credentials in a chat.",
            "This demo does not need real account credentials.",
          ],
          refusal: true,
        });
      }

      return baseContent({
        qualityLabel: "Safety guidance",
        fallbackReason: "SAFETY_REFUSAL",
        directAnswer:
          "I can't provide tax, legal, or regulatory advice, or recommendations about other financial products. Please consult a qualified professional for those questions. I can still explain the fictional demo's SIP mechanics. " +
          NO_ACTION_NOTE,
        keyPoints: [
          "Tax, legal, and regulatory questions are outside this assistant's scope.",
          "No tax or legal determination has been made.",
        ],
        refusal: true,
      });

    default:
      return baseContent({
        qualityLabel: "Safety guidance",
        fallbackReason: "SAFETY_REFUSAL",
        directAnswer: `I can't help with that request. ${NO_ACTION_NOTE}`,
        refusal: true,
      });
  }
}
