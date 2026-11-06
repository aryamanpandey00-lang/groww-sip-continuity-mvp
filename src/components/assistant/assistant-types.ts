import type { AssistantApiResponse } from "@/lib/assistant/contracts";

export type ConversationMessage =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; response: AssistantApiResponse };

export type ModifyTarget = "amount" | "debitDay" | "both" | "unknown";

export interface ModifyClarificationContext {
  target: ModifyTarget;
  amount: number | null;
  debitDay: number | null;
}

export interface PreparedModifyRequest {
  ok: true;
  question: string;
  context: ModifyClarificationContext;
}

export interface IncompleteModifyRequest {
  ok: false;
  context: ModifyClarificationContext;
  message: string;
}

export type ModifyRequestPreparation =
  | PreparedModifyRequest
  | IncompleteModifyRequest;
