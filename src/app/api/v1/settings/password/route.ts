import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { passwordChangeSchema } from "@/lib/validation/schemas";

/**
 * PATCH /api/v1/settings/password
 *
 * Requires the current password even though the session already proves who the
 * user is. A stolen session cookie should not be enough to lock the real owner
 * out of their own account permanently, and a password change is the one action
 * where that matters.
 *
 * `passwordChangedAt` is the mechanism that makes the change stick. The session
 * JWT carries a `pwd` claim stamped from that column, so bumping it invalidates
 * every already-issued token without needing a session table to delete rows
 * from. Without it, "change my password" would leave every other device signed
 * in, which is the opposite of what someone changing a compromised password
 * needs.
 */

export const PATCH = withApi({
  method: "PATCH",
  body: passwordChangeSchema,
  // Deliberately tighter than a normal write. Argon2 is expensive by design, and
  // an endpoint that verifies a password is a better place to spend a guesser's
  // time budget than an ordinary field update.
  rateLimit: { limit: 5, windowMs: 15 * 60_000 },
  async handler({ user, body }) {
    const record = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });

    if (!record) throw ApiError.unauthorized();

    // An account with no password (OAuth-only) cannot "change" one — it has
    // nothing to verify against. Sending them to a provider-link flow is the
    // honest answer; inventing a null comparison here would let anyone who
    // obtained such a session set a password without ever proving one.
    if (!record.passwordHash) {
      throw ApiError.badRequest(
        "This account signs in with a provider, so there is no password to change.",
        { code: "NO_PASSWORD" },
      );
    }

    const valid = await verifyPassword(record.passwordHash, body.currentPassword);
    if (!valid) {
      throw ApiError.validation("That is not your current password.", {
        currentPassword: "Check it and try again",
      });
    }

    const passwordHash = await hashPassword(body.newPassword);
    const changedAt = new Date();

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordChangedAt: changedAt },
      select: { id: true },
    });

    // Any outstanding reset link is a standing way back into the account and is
    // meaningless once the password has changed by hand.
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

    return { changedAt };
  },
});
