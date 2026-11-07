import { cloneDemoInvestorState } from "@/lib/domain/fixtures/demo-investor";
import type { DemoInvestorState } from "@/lib/domain/types";
import { retrieveEvidence } from "@/lib/evidence";
import {
  buildAssistantContextPacket,
} from "@/lib/ai/context";
import { evidenceIntentForAssistantIntent } from "@/lib/ai/intent";
import type {
  AssistantContextPacket,
  AssistantIntent,
  AssistantModelCallResult,
  AssistantModelClient,
  AssistantModelOutput,
  AssistantModelRequest,
  AssistantProblemCategory,
} from "@/lib/ai/types";

export const READY_CONFIG = {
  apiKey: "test-api-key-not-real",
  model: "configured-test-model",
  responseFormat: "json_schema",
  maxOutputTokens: 700,
  requestTimeoutMs: 1_000,
  maxInputChars: 2_000,
} as const;

export const PAYMENT_QUESTION =
  "Why did my SIP debit fail on 10 November 2026?";

export function okResult(
  output: AssistantModelOutput | unknown,
  modelId = "mock-model-v1",
): AssistantModelCallResult {
  return {
    status: "OK",
    outputText:
      typeof output === "string" ? output : JSON.stringify(output),
    modelId,
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  };
}

export function fromRawResult(raw: string): AssistantModelCallResult {
  return {
    status: "OK",
    outputText: raw,
    modelId: "mock-model-v1",
    usage: { inputTokens: 80, outputTokens: 40, totalTokens: 120 },
  };
}

export interface FakeModelClient extends AssistantModelClient {
  readonly calls: AssistantModelRequest[];
}

export function fakeModelClient(
  results: AssistantModelCallResult[],
): FakeModelClient {
  const calls: AssistantModelRequest[] = [];
  let index = 0;

  return {
    calls,
    async respond(request: AssistantModelRequest) {
      calls.push(request);
      const result = results[index];

      index += 1;

      return result ?? { status: "UNAVAILABLE", errorCode: "no_more_mocks" };
    },
  };
}

export function validPaymentOutput(
  overrides: Partial<AssistantModelOutput> = {},
): AssistantModelOutput {
  return {
    intent: "PAYMENT_FAILED",
    directAnswer:
      "The fictional demo debit failed on 10 November 2026. Under the fictional demo policy, a simulated retry can be previewed through 17 November 2026. The fictional monthly amount is ₹5,000, and nothing has been paid.",
    keyPoints: [
      "This is fictional demo policy, not Groww policy.",
      "A retry is a preview only and requires explicit confirmation.",
    ],
    citedEvidenceIds: ["demo-policy.retry-window"],
    proposedAction: { type: "RETRY_PAYMENT", cycleId: "cycle_2026_11" },
    followUpQuestion: "",
    refusal: false,
    ...overrides,
  };
}

export function validEducationOutput(
  overrides: Partial<AssistantModelOutput> = {},
): AssistantModelOutput {
  return {
    intent: "GENERAL_SIP_EDUCATION",
    directAnswer:
      "A SIP invests a fixed amount in a mutual fund at regular intervals. This is general investor education, not a personal recommendation.",
    keyPoints: ["SIPs are designed for regular, disciplined investing."],
    citedEvidenceIds: ["general-education.sip-basics"],
    proposedAction: { type: "NONE" },
    followUpQuestion: "",
    refusal: false,
    ...overrides,
  };
}

export function validModifyAmountOutput(
  amount = 6_000,
  overrides: Partial<AssistantModelOutput> = {},
): AssistantModelOutput {
  return {
    intent: "MODIFY_SIP",
    directAnswer:
      "Under the fictional demo policy, you can preview changing the monthly amount to ₹6,000. Nothing has been changed, and this is not Groww policy.",
    keyPoints: ["The change is a preview only."],
    citedEvidenceIds: ["demo-policy.amount-modification"],
    proposedAction: { type: "MODIFY_AMOUNT", amount },
    followUpQuestion: "",
    refusal: false,
    ...overrides,
  };
}

export function buildPacket(input: {
  question: string;
  intent: AssistantIntent;
  selectedCategory?: AssistantProblemCategory | null;
  state?: DemoInvestorState;
}): { packet: AssistantContextPacket; state: DemoInvestorState } {
  const state = input.state ?? cloneDemoInvestorState();
  const evidenceIntent = evidenceIntentForAssistantIntent(
    input.intent,
    input.question,
  );
  const retrieval = retrieveEvidence({
    question: input.question,
    intent: evidenceIntent ?? "sip_basics",
  });
  const packet = buildAssistantContextPacket({
    question: input.question,
    selectedCategory: input.selectedCategory ?? null,
    intent: input.intent,
    evidenceIntent,
    retrieval,
    state,
  });

  return { packet, state };
}
