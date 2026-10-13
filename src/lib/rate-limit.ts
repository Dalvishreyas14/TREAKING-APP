import "server-only";

/**
 * Fixed-window rate limiter held in process memory.
 *
 * Scope and honesty: this is a single-process limiter, appropriate for local
 * development and a single-instance deployment. It is NOT a distributed
 * limiter - behind multiple instances each keeps its own counters. The
 * interface is deliberately narrow so swapping in Redis later is a change to
 * this file only, and every call site already goes through `rateLimit`.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Bound memory: sweep expired buckets periodically rather than growing forever.
const SWEEP_INTERVAL_MS = 60_000;
let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

/** A limiter policy: how many requests, over what window. */
export type RateLimit = { limit: number; windowMs: number };

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: limit - 1,
      resetAt,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  existing.count += 1;
  const allowed = existing.count <= limit;

  return {
    allowed,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

/** Rate limit presets, named by what they protect. */
export const LIMITS = {
  signIn: { limit: 8, windowMs: 15 * 60_000 },
  /**
   * Per-IP companion to `signIn`. The per-address bucket stops one account being
   * brute forced; this stops a single host spraying many addresses to find out
   * which ones exist. It is looser on purpose so a shared office or a household
   * NAT does not lock everyone out.
   */
  signInByIp: { limit: 40, windowMs: 15 * 60_000 },
  signUp: { limit: 5, windowMs: 60 * 60_000 },
  passwordReset: { limit: 5, windowMs: 60 * 60_000 },
  emailVerification: { limit: 10, windowMs: 60 * 60_000 },
  aiChat: { limit: 30, windowMs: 60_000 },
  aiPlan: { limit: 20, windowMs: 60_000 },
  nlParse: { limit: 60, windowMs: 60_000 },
  search: { limit: 60, windowMs: 60_000 },
  write: { limit: 240, windowMs: 60_000 },
  export: { limit: 3, windowMs: 60 * 60_000 },
} as const;
