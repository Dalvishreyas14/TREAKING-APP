import { NextResponse } from "next/server";
import NextAuth from "next-auth";

import { authConfig } from "@/lib/auth/config";

/**
 * Network boundary. In Next 16 `middleware.ts` is renamed `proxy.ts`; it runs on
 * the Node.js runtime.
 *
 * This file exists for UX only - it redirects browsers away from pages they
 * cannot use. It is NOT a security control. Every Server Action and route
 * handler independently re-verifies the session, because a client-side redirect
 * is trivially bypassed.
 */

const { auth } = NextAuth(authConfig);

/**
 * Routes that require a session. Kept as an explicit allowlist of prefixes.
 *
 * The `matcher` at the bottom lists the same routes. It has to be a literal
 * array of static strings — Turbopack parses it at build time and rejects
 * anything computed — so the two cannot be derived from one another. What keeps
 * them in sync is `test/proxy-matcher.test.ts`, which fails the build if a prefix
 * is added to one list and not the other.
 */
export const PROTECTED = [
  "/dashboard",
  "/today",
  "/planner",
  "/tasks",
  "/habits",
  "/wellbeing",
  "/focus",
  "/journal",
  "/fitness",
  "/study",
  "/goals",
  "/projects",
  "/routines",
  "/analytics",
  "/insights",
  "/ai",
  "/calendar",
  "/notifications",
  "/profile",
  "/settings",
  "/onboarding",
];

/** Routes a signed-in user should be bounced away from. */
export const AUTH_PAGES = ["/sign-in", "/sign-up", "/forgot-password"];

export default auth((req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;

  // Fail closed. An absent token.sub means "not authenticated" regardless of
  // whether the session object itself exists. See GHSA-8fpg-xm3f-6cx3 - a
  // truthy session object can be produced by a configuration error, and any
  // existence check would then grant access to everyone.
  const isSignedIn = Boolean(req.auth?.user?.id);

  const needsAuth = PROTECTED.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const isAuthPage = AUTH_PAGES.some((p) => pathname === p);

  if (needsAuth && !isSignedIn) {
    const url = new URL("/sign-in", nextUrl.origin);
    // Preserve where the user was headed so sign-in can bounce them back.
    if (pathname !== "/dashboard") {
      url.searchParams.set("callbackUrl", `${pathname}${nextUrl.search}`);
    }
    return NextResponse.redirect(url);
  }

  if (isAuthPage && isSignedIn) {
    return NextResponse.redirect(new URL("/dashboard", nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  /**
   * Explicit prefix list rather than a broad negative-lookahead regex. The
   * boundary should run on the pages that need a session and nowhere else, so
   * static assets and public marketing pages cost nothing.
   *
   * Literal on purpose: Turbopack statically parses this at build time and fails
   * the build on anything computed, so it cannot be built from `PROTECTED` above.
   * Protected routes get `:path*`; the auth pages are exact paths.
   */
  matcher: [
    "/dashboard/:path*",
    "/today/:path*",
    "/planner/:path*",
    "/tasks/:path*",
    "/habits/:path*",
    "/wellbeing/:path*",
    "/focus/:path*",
    "/journal/:path*",
    "/fitness/:path*",
    "/study/:path*",
    "/goals/:path*",
    "/projects/:path*",
    "/routines/:path*",
    "/analytics/:path*",
    "/insights/:path*",
    "/ai/:path*",
    "/calendar/:path*",
    "/notifications/:path*",
    "/profile/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
    "/sign-in",
    "/sign-up",
    "/forgot-password",
  ],
};
