import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { hashPassword } from "@/lib/auth/password";
import { hashToken, isExpired, tokensMatch } from "@/lib/auth/tokens";
import { resetPasswordSchema } from "@/lib/validation/schemas";

/**
 * POST /api/v1/auth/reset-password
 *
 * Redeems a single-use reset token and sets a new password. The token is burned
 * in the same transaction that writes the password, so a failure part-way
 * cannot leave a valid token attached to a changed password.
 */
export const POST = withApi({
  method: "POST",
  auth: false,
  body: resetPasswordSchema,
  rateLimit: LIMITS.passwordReset,
  async handler({ body: { token, password } }) {
    const tokenHash = hashToken(token);

    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        tokenHash: true,
        expiresAt: true,
        usedAt: true,
      },
    });

    const invalid = ApiError.badRequest(
      "This reset link is invalid or has expired. Request a new one.",
    );

    // Constant-time comparison as a second check, so a partial index match can
    // never be distinguished from a wrong token.
    if (!record || !tokensMatch(token, record.tokenHash)) throw invalid;
    if (record.usedAt || isExpired(record.expiresAt)) throw invalid;

    const passwordHash = await hashPassword(password);
    const changedAt = new Date();

    await prisma.$transaction(async (tx) => {
      // Atomic claim: `usedAt: null` in the WHERE clause means two concurrent
      // redemptions of the same token cannot both pass.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw invalid;

      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash, passwordChangedAt: changedAt },
      });

      // Clears any database sessions. Credentials sign-in uses the JWT strategy,
      // so these are usually empty; the real revocation for JWTs is the
      // passwordChangedAt comparison in the session callback. Both are done so
      // the guarantee holds whichever strategy is in force.
      await tx.session.deleteMany({ where: { userId: record.userId } });
    });

    return { reset: true, signInUrl: "/sign-in?reset=1" };
  },
});
