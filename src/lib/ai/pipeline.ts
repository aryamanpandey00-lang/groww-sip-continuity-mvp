import { randomUUID } from "node:crypto";
import { cloneDemoInvestorState } from "@/lib/domain/fixtures/demo-investor";
import type { DemoInvestorState } from "@/lib/domain/types";
import { retrieveEvidence, INSUFFICIENT_EVIDENCE_MESSAGE } from "@/lib/evidence";
import { resolveAssistantConfig, DEFAULT_MAX_INPUT_CHARS } from "./config";
import { buildAssistantContextPacket } from "./context";
import {
  buildConfigUnavailableContent,
  buildGateFailureContent,
  buildInsufficientEvidenceContent,
  buildInputInvalidContent,
  buildMissingInformationContent,
  buildModelUnavailableContent,
  buildNoEvidenceContent,
  buildSafetyContent,
  type AssistantFallbackContent,
} from "./fallbacks";
import { evaluateRuntimeGate } from "./gate";
import {
  classifyIntent,
  evidenceIntentForAssistantIntent,
  isAssistantProblemCategory,
  isSafetyOverrideIntent,
} from "./intent";
import { emitAssistantLog } from "./logger";
import { detectMissingInformation } from "./missing-info";
import {
  buildAssistantModelRequest,
  buildRepairModelRequest,
} from "./prompts";
import type {
  AssistantContextPacket,
  AssistantDependencies,
  AssistantIntent,
  AssistantModelCallResult,
  AssistantModelClient,
  AssistantModelDiagnostics,
  AssistantRequest,
  AssistantResult,
  AssistantEvidenceItem,
  AssistantTokenUsage,
  RuntimeGateResult,
} from "./types";

interface CallTelemetry {
  latencyMs: number;
  modelId: string | null;
  usage: AssistantTokenUsage | null;
}

async function callModel(
  client: AssistantModelClient,
  request: ReturnType<typeof buildAssistantModelRequest>,
): Promise<{ result: AssistantModelCallResult; telemetry: CallTelemetry }> {
  const startedAt = Date.now();

  try {
    const result = await client.respond(request);

    return {
      result,
      telemetry: {
        latencyMs: Date.now() - startedAt,
        modelId: result.status === "OK" ? (result.modelId ?? null) : null,
        usage: result.status === "OK" ? (result.usage ?? null) : null,
      },
    };
  } catch {
    return {
      result: { status: "UNAVAILABLE", errorCode: "client_exception" },
      telemetry: {
        latencyMs: Date.now() - startedAt,
        modelId: null,
        usage: null,
      },
    };
  }
}

function mergeTelemetry(
  previous: CallTelemetry | null,
  next: CallTelemetry,
): CallTelemetry {
  return {
    latencyMs: (previous?.latencyMs ?? 0) + next.latencyMs,
    modelId: next.modelId ?? previous?.modelId ?? null,
    usage: next.usage ?? previous?.usage ?? null,
  };
}

function buildResult(input: {
  requestId: string;
  intent: AssistantIntent;
  content: AssistantFallbackContent;
  gateResult: RuntimeGateResult | null;
  retrievedEvidenceIds: string[];
  retrievedEvidenceItems: AssistantEvidenceItem[];
  model: AssistantModelDiagnostics | null;
  repairAttempted: boolean;
  repairSucceeded: boolean;
  generatedAt: string;
}): AssistantResult {
  return {
    requestId: input.requestId,
    status: input.content.status,
    intent: input.intent,
    directAnswer: input.content.directAnswer,
    keyPoints: input.content.keyPoints,
    citedEvidenceIds: input.content.citedEvidenceIds,
    proposedAction: input.content.proposedAction,
    followUpQuestion: input.content.followUpQuestion,
    refusal: input.content.refusal,
    qualityLabel: input.content.qualityLabel,
    fallbackReason: input.content.fallbackReason,
    evaluationFallbackReason: input.content.evaluationFallbackReason,
    fallbackUsed: input.content.fallbackUsed,
    repairAttempted: input.repairAttempted,
    repairSucceeded: input.repairSucceeded,
    gateResult: input.gateResult,
    retrievedEvidenceIds: input.retrievedEvidenceIds,
    retrievedEvidenceItems: input.retrievedEvidenceItems,
    model: input.model,
    executionPerformed: false,
    generatedAt: input.generatedAt,
  };
}

function modelDiagnostics(
  telemetry: CallTelemetry | null,
): AssistantModelDiagnostics | null {
  if (!telemetry) {
    return null;
  }

  return {
    modelId: telemetry.modelId,
    latencyMs: telemetry.latencyMs,
    usage: telemetry.usage,
  };
}

function defaultState(state: DemoInvestorState | undefined): DemoInvestorState {
  if (!state) {
    return cloneDemoInvestorState();
  }

  return structuredClone(state);
}

/**
 * General-education and safety retrieval must not be blocked by Phase 3's
 * account-specific guard just because a general question contains "my SIP".
 * The original question is still preserved in the context packet.
 */
function evidenceQuestionForIntent(
  intent: AssistantIntent,
  question: string,
): string {
  if (
    intent !== "GENERAL_SIP_EDUCATION" &&
    intent !== "MARKET_UNCERTAINTY" &&
    intent !== "GUARANTEED_RETURN_REQUEST"
  ) {
    return question;
  }

  return question.replace(
    /\bmy\s+(sip|mutual fund|portfolio|investment)\b/gi,
    "a $1",
  );
}

/**
 * Runs the server-side assistant pipeline. The OpenAI client is only imported
 * lazily on the approved model path, so configuration failures, deterministic
 * clarification, safety refusals and offline tests never construct an SDK
 * client or require a live API key.
 */
export async function runAssistant(
  request: AssistantRequest,
  dependencies: AssistantDependencies = {},
): Promise<AssistantResult> {
  const startedAt = Date.now();
  const requestId = dependencies.requestId ?? randomUUID();
  const now = dependencies.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const rawQuestion =
    typeof request.question === "string" ? request.question.trim() : "";
  const selectedCategory =
    request.selectedCategory && isAssistantProblemCategory(request.selectedCategory)
      ? request.selectedCategory
      : null;
  const intent = classifyIntent(rawQuestion, selectedCategory);
  const retrievedEvidenceIds: string[] = [];
  let retrievedEvidenceItems: AssistantEvidenceItem[] = [];
  let telemetry: CallTelemetry | null = null;
  let repairAttempted = false;
  let repairSucceeded = false;

  const finish = (
    content: AssistantFallbackContent,
    gateResult: RuntimeGateResult | null,
  ): AssistantResult => {
    const result = buildResult({
      requestId,
      intent,
      content,
      gateResult,
      retrievedEvidenceIds,
      retrievedEvidenceItems,
      model: modelDiagnostics(telemetry),
      repairAttempted,
      repairSucceeded,
      generatedAt,
    });

    emitAssistantLog(dependencies.log, {
      requestId,
      intent,
      retrievedEvidenceIds,
      gatePassed: gateResult?.passed ?? null,
      gateFailureCodes:
        gateResult?.criticalFailures.map((failure) => failure.code) ?? [],
      fallbackReason: result.fallbackReason,
      qualityLabel: result.qualityLabel,
      modelId: result.model?.modelId ?? null,
      latencyMs: Date.now() - startedAt,
      tokenUsage: result.model?.usage ?? null,
      repairAttempted,
      timestamp: generatedAt,
    });

    return result;
  };

  if (!rawQuestion) {
    return finish(
      buildInputInvalidContent(DEFAULT_MAX_INPUT_CHARS),
      null,
    );
  }

  if (rawQuestion.length > DEFAULT_MAX_INPUT_CHARS) {
    return finish(buildInputInvalidContent(DEFAULT_MAX_INPUT_CHARS), null);
  }

  const evidenceIntent = evidenceIntentForAssistantIntent(
    intent,
    rawQuestion,
  );
  const retrieval = evidenceIntent
    ? retrieveEvidence({
        question: evidenceQuestionForIntent(intent, rawQuestion),
        intent: evidenceIntent,
      })
    : null;

  if (retrieval) {
    retrievedEvidenceIds.push(...retrieval.evidenceIds);
    retrievedEvidenceItems = retrieval.matches.map((item) => ({
      ...item,
      matchedTerms: [...item.matchedTerms],
    }));
  }

  const configResolution = dependencies.config
    ? ({ status: "READY", config: dependencies.config } as const)
    : resolveAssistantConfig(dependencies.env ?? process.env);

  if (configResolution.status === "UNAVAILABLE") {
    return finish(
      buildConfigUnavailableContent(
        configResolution.reason,
        configResolution.fallbackReason,
      ),
      null,
    );
  }

  const config = configResolution.config;

  if (rawQuestion.length > config.maxInputChars) {
    return finish(buildInputInvalidContent(config.maxInputChars), null);
  }

  if (isSafetyOverrideIntent(intent)) {
    return finish(buildSafetyContent(intent, rawQuestion, retrieval), null);
  }

  if (intent === "INSUFFICIENT_EVIDENCE") {
    return finish(
      buildInsufficientEvidenceContent(INSUFFICIENT_EVIDENCE_MESSAGE),
      null,
    );
  }

  if (!retrieval || retrieval.status === "NO_EVIDENCE") {
    return retrieval
      ? finish(buildNoEvidenceContent(retrieval), null)
      : finish(buildInsufficientEvidenceContent(INSUFFICIENT_EVIDENCE_MESSAGE), null);
  }

  const missingInformation = detectMissingInformation(
    rawQuestion,
    intent,
    selectedCategory,
  );

  if (missingInformation.required && missingInformation.question) {
    return finish(
      buildMissingInformationContent(missingInformation.question),
      null,
    );
  }

  const state = defaultState(request.state);
  const packet = buildAssistantContextPacket({
    question: rawQuestion,
    selectedCategory,
    intent,
    evidenceIntent,
    retrieval,
    state,
  });

  let modelClient = dependencies.modelClient;

  if (!modelClient) {
    try {
      const { createOpenAIModelClient } = await import("./client");
      modelClient = createOpenAIModelClient(config);
    } catch {
      return finish(buildModelUnavailableContent("MODEL_UNAVAILABLE"), null);
    }
  }

  const firstCall = await callModel(
    modelClient,
    buildAssistantModelRequest(packet),
  );
  telemetry = mergeTelemetry(telemetry, firstCall.telemetry);

  if (firstCall.result.status === "TIMEOUT") {
    return finish(buildModelUnavailableContent("MODEL_TIMEOUT"), null);
  }

  if (firstCall.result.status === "UNAVAILABLE") {
    return finish(buildModelUnavailableContent("MODEL_UNAVAILABLE"), null);
  }

  let previousOutput =
    firstCall.result.status === "OK" ? firstCall.result.outputText : "";
  let gateEvaluation = evaluateRuntimeGate({
    rawOutput: previousOutput,
    packet,
    state,
  });

  if (!gateEvaluation.result.passed) {
    repairAttempted = true;

    const repairCall = await callModel(
      modelClient,
      buildRepairModelRequest(
        packet,
        gateEvaluation.result.criticalFailures.map((failure) => failure.code),
        previousOutput,
      ),
    );
    telemetry = mergeTelemetry(telemetry, repairCall.telemetry);

    if (repairCall.result.status === "TIMEOUT") {
      return finish(buildModelUnavailableContent("MODEL_TIMEOUT"), null);
    }

    if (repairCall.result.status === "UNAVAILABLE") {
      return finish(buildModelUnavailableContent("MODEL_UNAVAILABLE"), null);
    }

    previousOutput =
      repairCall.result.status === "OK" ? repairCall.result.outputText : "";
    gateEvaluation = evaluateRuntimeGate({
      rawOutput: previousOutput,
      packet,
      state,
    });

    if (!gateEvaluation.result.passed) {
      return finish(
        buildGateFailureContent("REPAIR_FAILED"),
        gateEvaluation.result,
      );
    }

    repairSucceeded = true;
  }

  const output = gateEvaluation.output;

  if (!output) {
    return finish(
      buildGateFailureContent("MODEL_INVALID_OUTPUT"),
      gateEvaluation.result,
    );
  }

  return finish(
    {
      status: "APPROVED",
      qualityLabel: gateEvaluation.result.qualityLabel ?? "Limited evidence",
      fallbackReason: "NONE",
      evaluationFallbackReason: "NONE",
      directAnswer: output.directAnswer,
      keyPoints: output.keyPoints,
      citedEvidenceIds: output.citedEvidenceIds,
      proposedAction: output.proposedAction,
      followUpQuestion: output.followUpQuestion,
      refusal: output.refusal,
      fallbackUsed: false,
    },
    gateEvaluation.result,
  );
}

export type { AssistantContextPacket };
