/**
 * Model call retry helpers.
 *
 * Goal: make the agent resilient to transient provider failures (rate limits,
 * token-per-second throttles, network hiccups) without pushing complexity into
 * every call site.
 */

export type RetryableCheck = {
  retryable: boolean;
  reason: string;
  retryAfterMs?: number;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Best-effort classification of provider errors coming from AI SDK providers.
 * The SDK error shapes differ across providers; we lean on common patterns.
 */
export function isRetryableModelError(err: unknown): RetryableCheck {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : JSON.stringify(err);

  const lower = msg.toLowerCase();

  // Common rate-limit / throttling phrases.
  const rateLimit =
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("tpm") ||
    lower.includes("tokens per minute") ||
    lower.includes("rpm") ||
    lower.includes("requests per minute") ||
    lower.includes("throttle") ||
    lower.includes("overloaded") ||
    lower.includes("temporarily unavailable") ||
    lower.includes("service unavailable");

  // Sometimes providers embed status codes.
  const has429 = lower.includes(" 429") || lower.includes("status 429") || lower.includes("http 429");
  const has503 = lower.includes(" 503") || lower.includes("status 503") || lower.includes("http 503");
  const has502 = lower.includes(" 502") || lower.includes("status 502") || lower.includes("http 502");
  const has504 = lower.includes(" 504") || lower.includes("status 504") || lower.includes("http 504");

  // Common transient network errors.
  const network =
    lower.includes("etimedout") ||
    lower.includes("econnreset") ||
    lower.includes("socket hang up") ||
    lower.includes("network error") ||
    lower.includes("fetch failed");

  const retryable = rateLimit || has429 || has503 || has502 || has504 || network;

  // Best-effort Retry-After extraction from the message if present.
  // Some providers include "retry after Xs" in error text.
  let retryAfterMs: number | undefined;
  const m = lower.match(/retry[- ]after[: ]+(\d+)\s*(s|sec|secs|seconds|ms)?/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) {
      retryAfterMs = m[2] === "ms" ? n : n * 1000;
    }
  }

  return {
    retryable,
    reason: retryable ? "transient_provider_error" : "non_retryable_error",
    retryAfterMs,
  };
}

/**
 * Exponential backoff with jitter.
 * attempt is 0-based (0 => ~1s).
 */
export function computeBackoffMs(attempt: number, opts?: { baseMs?: number; capMs?: number }): number {
  const baseMs = opts?.baseMs ?? 1000;
  const capMs = opts?.capMs ?? 20_000;
  const exp = baseMs * Math.pow(2, clamp(attempt, 0, 10));
  const capped = Math.min(exp, capMs);
  // Full jitter: random in [0, capped]
  return Math.floor(Math.random() * capped);
}

export async function withModelRetries<T>(
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; baseMs?: number; capMs?: number; onRetry?: (info: { attempt: number; waitMs: number; error: unknown }) => void },
): Promise<T> {
  const maxAttempts = Math.max(1, opts?.maxAttempts ?? 4);

  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const check = isRetryableModelError(err);
      if (!check.retryable || attempt === maxAttempts - 1) {
        throw err;
      }

      const waitMs =
        typeof check.retryAfterMs === "number" && Number.isFinite(check.retryAfterMs)
          ? clamp(check.retryAfterMs, 250, 120_000)
          : computeBackoffMs(attempt, { baseMs: opts?.baseMs, capMs: opts?.capMs });

      opts?.onRetry?.({ attempt, waitMs, error: err });
      await sleep(waitMs);
      continue;
    }
  }

  // Unreachable, but TS likes completeness.
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

