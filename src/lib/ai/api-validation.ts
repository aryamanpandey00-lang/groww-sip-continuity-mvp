import "server-only";

import { ASSISTANT_PROBLEM_CATEGORIES } from "./types";
import {
  ASSISTANT_DEMO_SCENARIOS,
  type AssistantDemoScenario,
} from "@/lib/domain/fixtures/assistant-scenarios";
import type { AssistantApiRequest } from "@/lib/assistant/contracts";
import { DEFAULT_MAX_INPUT_CHARS } from "./config";

export const MAX_ASSISTANT_REQUEST_BYTES = 8 * 1024;

export type AssistantJsonBodyResult =
  | { status: "OK"; value: unknown }
  | { status: "INVALID_JSON" }
  | { status: "PAYLOAD_TOO_LARGE" };

export type AssistantRequestValidationResult =
  | { valid: true; request: AssistantApiRequest & { demoScenario: AssistantDemoScenario } }
  | { valid: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readBoundedAssistantJson(
  request: Request,
  maxBytes = MAX_ASSISTANT_REQUEST_BYTES,
): Promise<AssistantJsonBodyResult> {
  const contentLength = request.headers.get("content-length");

  if (contentLength && /^\d+$/.test(contentLength.trim())) {
    if (Number(contentLength) > maxBytes) {
      return { status: "PAYLOAD_TOO_LARGE" };
    }
  }

  if (!request.body) {
    return { status: "INVALID_JSON" };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { status: "PAYLOAD_TOO_LARGE" };
      }

      chunks.push(value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { status: "OK", value: JSON.parse(text) as unknown };
  } catch {
    return { status: "INVALID_JSON" };
  } finally {
    reader.releaseLock();
  }
}

export function validateAssistantApiRequest(
  value: unknown,
): AssistantRequestValidationResult {
  if (!isRecord(value)) {
    return { valid: false };
  }

  const allowedKeys = new Set([
    "question",
    "selectedCategory",
    "demoScenario",
  ]);

  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return { valid: false };
  }

  if (typeof value.question !== "string") {
    return { valid: false };
  }

  const question = value.question.trim();

  if (question.length === 0 || question.length > DEFAULT_MAX_INPUT_CHARS) {
    return { valid: false };
  }

  let selectedCategory: AssistantApiRequest["selectedCategory"];

  if (Object.hasOwn(value, "selectedCategory")) {
    if (
      value.selectedCategory !== null &&
      (typeof value.selectedCategory !== "string" ||
        !(ASSISTANT_PROBLEM_CATEGORIES as readonly string[]).includes(
          value.selectedCategory,
        ))
    ) {
      return { valid: false };
    }

    selectedCategory = value.selectedCategory as AssistantApiRequest["selectedCategory"];
  }

  let demoScenario: AssistantDemoScenario = "BASE";

  if (Object.hasOwn(value, "demoScenario")) {
    if (
      typeof value.demoScenario !== "string" ||
      !(ASSISTANT_DEMO_SCENARIOS as readonly string[]).includes(
        value.demoScenario,
      )
    ) {
      return { valid: false };
    }

    demoScenario = value.demoScenario as AssistantDemoScenario;
  }

  return {
    valid: true,
    request: {
      question,
      selectedCategory,
      demoScenario,
    },
  };
}

export function hasJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type");

  if (!contentType) {
    return false;
  }

  return contentType.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

export function hasSameOrigin(request: Request): boolean {
  const originHeader = request.headers.get("origin");

  if (!originHeader || originHeader === "null") {
    return false;
  }

  try {
    const origin = new URL(originHeader);
    const requestOrigin = new URL(request.url).origin;

    return (
      origin.origin === originHeader &&
      origin.username.length === 0 &&
      origin.password.length === 0 &&
      origin.origin === requestOrigin
    );
  } catch {
    return false;
  }
}

/**
 * The route cannot establish whether forwarding headers were normalized by a
 * trusted proxy. Use one bounded demo bucket rather than trusting spoofable
 * request headers to create unlimited rate-limit identities.
 */
export function assistantRateLimitKey(request: Request): string {
  void request;
  return "shared-demo-client";
}
