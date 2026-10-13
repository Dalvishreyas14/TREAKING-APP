import type { NextRequest } from "next/server";

import { handlers } from "@/lib/auth";
import { consumeSignInAttempt, isCredentialsSignIn } from "@/lib/auth/sign-in-limit";

/**
 * Auth.js route handler.
 *
 * `force-dynamic` is mandatory, not defensive. In Next 16 a GET route handler
 * is cached by the Data Cache keyed on URL, not on the requesting user. Without
 * this, one user's /api/auth/session response could be served to another user.
 * See the Next.js 16 upgrade notes on cached GET route handlers.
 */
export const dynamic = "force-dynamic";

/**
 * Throttles credentials sign-in before Auth.js sees the request.
 *
 * Deliberately not wrapped in `withApi`: that helper wraps a handler's return
 * value in a JSON envelope, but Auth.js returns redirects, Set-Cookie headers
 * and 303 responses that must reach the browser untouched.
 *
 * Only the credentials action is limited. Everything else - the session read, the
 * CSRF token, the OAuth handshake - passes straight through, because those
 * endpoints are hit constantly by a single signed-in user and throttling them
 * would break normal use rather than an attack.
 */
async function authPost(request: NextRequest): Promise<Response> {
  if (!isCredentialsSignIn(request)) return handlers.POST(request);

  /**
   * The email is read defensively and on a clone. A malformed, oversized or
   * non-form body is not this layer's problem to report: it is forwarded to
   * Auth.js, which owns parsing and will reject it properly. All that is needed
   * here is a best-effort rate-limit key.
   */
  let email: string | null = null;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await request.clone().formData();
      const raw = form.get("email");
      if (typeof raw === "string") email = raw.slice(0, 254);
    }
  } catch {
    email = null;
  }

  const result = consumeSignInAttempt(request, email);
  if (result.allowed) return handlers.POST(request);

  return Response.json(
    {
      ok: false,
      error: {
        code: "RATE_LIMITED",
        message: "Too many sign-in attempts. Wait a few minutes and try again.",
        details: { scope: result.scope },
      },
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "Cache-Control": "no-store",
      },
    },
  );
}

export const GET = handlers.GET;
export const POST = authPost;
