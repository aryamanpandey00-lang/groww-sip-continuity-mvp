import "server-only";

export interface AssistantRateLimitOptions {
  maxRequests: number;
  windowMs: number;
  maxConcurrentPerKey: number;
  maxConcurrentTotal: number;
  maxTrackedKeys: number;
}

export type AssistantRateLimitFailure = "RATE_LIMITED" | "CONCURRENCY_LIMITED";

export type AssistantRateLimitLease =
  | {
      allowed: true;
      release: () => void;
    }
  | {
      allowed: false;
      reason: AssistantRateLimitFailure;
      retryAfterSeconds: number;
      release: () => void;
    };

interface RateBucket {
  windowStartedAt: number;
  requests: number;
  inFlight: number;
}

const DEFAULT_OPTIONS: AssistantRateLimitOptions = {
  maxRequests: 10,
  windowMs: 60_000,
  maxConcurrentPerKey: 2,
  maxConcurrentTotal: 20,
  maxTrackedKeys: 2_000,
};

/** Best-effort per-process protection; public deployments also need edge limits. */
export function createAssistantRateLimiter(
  overrides: Partial<AssistantRateLimitOptions> = {},
) {
  const options = { ...DEFAULT_OPTIONS, ...overrides };
  const buckets = new Map<string, RateBucket>();
  let totalInFlight = 0;

  return {
    acquire(key: string, now = Date.now()): AssistantRateLimitLease {
      let bucket = buckets.get(key);

      if (!bucket) {
        if (buckets.size >= options.maxTrackedKeys) {
          for (const [bucketKey, tracked] of buckets) {
            if (
              tracked.inFlight === 0 &&
              now - tracked.windowStartedAt >= options.windowMs
            ) {
              buckets.delete(bucketKey);
            }
          }

          if (buckets.size >= options.maxTrackedKeys) {
            return {
              allowed: false,
              reason: "RATE_LIMITED",
              retryAfterSeconds: 1,
              release: () => {},
            };
          }
        }

        bucket = { windowStartedAt: now, requests: 0, inFlight: 0 };
        buckets.set(key, bucket);
      } else if (now - bucket.windowStartedAt >= options.windowMs) {
        bucket.windowStartedAt = now;
        bucket.requests = 0;
      }

      if (
        bucket.inFlight >= options.maxConcurrentPerKey ||
        totalInFlight >= options.maxConcurrentTotal
      ) {
        return {
          allowed: false,
          reason: "CONCURRENCY_LIMITED",
          retryAfterSeconds: 1,
          release: () => {},
        };
      }

      if (bucket.requests >= options.maxRequests) {
        const remainingMs = Math.max(
          1,
          bucket.windowStartedAt + options.windowMs - now,
        );

        return {
          allowed: false,
          reason: "RATE_LIMITED",
          retryAfterSeconds: Math.ceil(remainingMs / 1_000),
          release: () => {},
        };
      }

      bucket.requests += 1;
      bucket.inFlight += 1;
      totalInFlight += 1;
      let released = false;

      return {
        allowed: true,
        release() {
          if (released) {
            return;
          }

          released = true;
          bucket!.inFlight = Math.max(0, bucket!.inFlight - 1);
          totalInFlight = Math.max(0, totalInFlight - 1);
        },
      };
    },
  };
}

export const assistantRateLimiter = createAssistantRateLimiter();
