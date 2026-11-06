import "server-only";

import type { AssistantApiCitation, AssistantApiResponse } from "@/lib/assistant/contracts";
import type { AssistantResult } from "./types";
import type { PublicActionPreview } from "@/lib/assistant/action-contracts";

/** Maps only gate-approved fields to the browser-facing response contract. */
export function toAssistantApiResponse(
  result: AssistantResult,
  actionPreview: PublicActionPreview | null = null,
): AssistantApiResponse {
  const citations: AssistantApiCitation[] = [];

  if (result.gateResult?.passed) {
    const retrievedIds = new Set(result.retrievedEvidenceIds);
    const itemsById = new Map(
      result.retrievedEvidenceItems.map((item) => [item.evidenceId, item]),
    );
    const seen = new Set<string>();

    for (const evidenceId of result.citedEvidenceIds) {
      if (!retrievedIds.has(evidenceId) || seen.has(evidenceId)) {
        continue;
      }

      const item = itemsById.get(evidenceId);

      if (!item) {
        continue;
      }

      seen.add(evidenceId);
      citations.push({
        evidenceId: item.evidenceId,
        title: item.title,
        sourceTier: item.sourceTier,
        sourceLabel: item.sourceLabel,
        sourceName: item.sourceName,
        excerpt: item.excerpt,
        verificationStatus: item.verificationStatus,
        verificationLabel: item.verificationLabel,
        sourceUrl: item.sourceUrl,
        sourceDate: item.sourceDate,
        applicableDemoPolicyVersion: item.applicableDemoPolicyVersion,
      });
    }
  }

  return {
    requestId: result.requestId,
    status: result.status,
    intent: result.intent,
    directAnswer: result.directAnswer,
    keyPoints: [...result.keyPoints],
    followUpQuestion: result.followUpQuestion,
    qualityLabel: result.qualityLabel,
    fallbackUsed: result.fallbackUsed,
    citations,
    actionPreview,
    executionPerformed: false,
  };
}
