import "server-only";

import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { normalizeEmail } from "./tokens";

/**
 * Sign-in rate limiting.
 *
 * Lives beside the route handler rather than inside the credentials provider,
 * for two reasons:
 *
 * 1. Correct HTTP semantics. A throttled request should answer 429 with a
 *    Retry-After, not a 302 redirect to /sign-in?error=... . Throwing from
 *    `authorize` instead produced a redirect, and `AccessDenied` is not one of
 *    Auth.js's sign-in error parameters, so the type was rewritten to
 *    `Configuration` and the real reason was lost.
 * 2. One obvious place to look. `/api/auth/callback/credentials` is the only
 *    route that can reach `authorize` for credentials, so limiting here is as
 *    authoritative as limiting inside it, and it cannot be bypassed by posting
 *    to a different route.
 *
 * OAuth callbacks are not limited: they are guarded by `state`/`nonce`/`pkce`,
 * which makes replay pointless, and Google's own throttling applies.
 */

export interface SignInLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  scope: "address" | "ip" | null;
}

/**
 * Best-effort client address.
 *
 * Honest about its limits: `x-forwarded-for` is client-controlled unless a
 * trusted proxy overwrites it, so a determined attacker can rotate the value and
 * weaken the per-IP bucket. It is not the security boundary - the per-address
 * bucket is, and that one cannot be spoofed. The IP exists to stop casual
 * spraying across many addresses from a single host.
 */
function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

/** True when this request is a credentials sign-in, the only limited action. */
export function isCredentialsSignIn(request: Request): boolean {
  const path = new URL(request.url).pathname;
  return path.endsWith("/callback/credentials");
}

/**
 * Consumes one unit of budget for this attempt.
 *
 * Counts the attempt whether or not the password is right, which is the point:
 * a limit that only counted failures could be walked straight past by a script
 * sending the correct password first.
 */
export function consumeSignInAttempt(
  request: Request,
  email: string | null,
): SignInLimitResult {
  // A missing or malformed address still costs the per-IP budget, so an attacker
  // cannot avoid all accounting by sending an empty email.
  const address = email ? normalizeEmail(email) : null;

  if (address) {
    const byAddress = rateLimit(
      `signin:email:${address}`,
      LIMITS.signIn.limit,
      LIMITS.signIn.windowMs,
    );
    if (!byAddress.allowed) {
      return {
        allowed: false,
        retryAfterSeconds: byAddress.retryAfterSeconds,
        scope: "address",
      };
    }
  }

  const byIp = rateLimit(
    `signin:ip:${clientIp(request)}`,
    LIMITS.signInByIp.limit,
    LIMITS.signInByIp.windowMs,
  );
  if (!byIp.allowed) {
    return {
      allowed: false,
      retryAfterSeconds: byIp.retryAfterSeconds,
      scope: "ip",
    };
  }

  return { allowed: true, retryAfterSeconds: 0, scope: null };
}
