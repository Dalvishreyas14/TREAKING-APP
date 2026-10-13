import "server-only";
import { auth } from "@/lib/auth";
import { ApiError } from "@/lib/api/errors";

/**
 * Session guards.
 *
 * proxy.ts already redirects unauthenticated browsers, but that is a
 * convenience, not a control. Every service call and route handler goes through
 * `requireUser` so authorisation cannot be forgotten at a call site.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  emailVerified: Date | null;
}

/** Returns the session user, or null. Never throws. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  const user = session?.user;

  // Concrete-property check, not an existence check. Fails closed if Auth.js is
  // misconfigured. See GHSA-8fpg-xm3f-6cx3.
  if (!user?.id) return null;

  return {
    id: user.id,
    email: user.email ?? "",
    name: user.name ?? null,
    image: user.image ?? null,
    emailVerified: user.emailVerified ?? null,
  };
}

/** Throws 401 unless a valid session exists. The default guard. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw ApiError.unauthorized();
  return user;
}

/**
 * Ownership assertion for a record loaded outside the caller's filter.
 *
 * All list queries are scoped by `userId` in the WHERE clause. This exists for
 * the cases where a record is fetched by its own id first - a request carrying
 * somebody else's task id must be rejected here rather than trusted.
 */
export function assertOwnership(
  record: { userId: string } | null | undefined,
  userId: string,
  notFoundMessage?: string,
): void {
  if (!record) throw ApiError.notFound(notFoundMessage);
  if (record.userId !== userId) {
    // Deliberately 404 rather than 403: confirming a record exists but is not
    // yours leaks information about other users' data.
    throw ApiError.notFound(notFoundMessage);
  }
}
