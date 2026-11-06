import "server-only";

const MAX_TRACKED_CONSUMED_PREVIEWS = 2_000;
const consumedPreviewIds = new Map<string, number>();

function prune(nowMs: number): void {
  for (const [previewId, expiresAt] of consumedPreviewIds) {
    if (expiresAt <= nowMs) consumedPreviewIds.delete(previewId);
  }

  while (consumedPreviewIds.size > MAX_TRACKED_CONSUMED_PREVIEWS) {
    const oldest = consumedPreviewIds.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    consumedPreviewIds.delete(oldest);
  }
}

export function markActionPreviewConsumed(
  previewId: string,
  expiresAtMs: number,
  nowMs = Date.now(),
): void {
  prune(nowMs);
  if (!previewId || !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) return;
  consumedPreviewIds.set(previewId, expiresAtMs);
  prune(nowMs);
}

export function isActionPreviewConsumed(
  previewId: string,
  nowMs = Date.now(),
): boolean {
  prune(nowMs);
  return consumedPreviewIds.has(previewId);
}
