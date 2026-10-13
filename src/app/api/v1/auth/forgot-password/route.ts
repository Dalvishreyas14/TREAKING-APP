import { withApi } from "@/lib/api/with-api";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { normalizeEmail, createToken, hashToken, resetExpiry } from "@/lib/auth/tokens";
import { sendPasswordResetEmail, resetUrl, devActionUrl } from "@/lib/email";
import { forgotPasswordSchema } from "@/lib/validation/schemas";

/**
 * POST /api/v1/auth/forgot-password
 *
 * Always returns 200 with the same shape. Any difference in response between a
 * known and unknown address would make this endpoint an account enumeration
 * oracle, so a miss and a hit are indistinguishable from the outside.
 */
export const POST = withApi({
  method: "POST",
  auth: false,
  body: forgotPasswordSchema,
  rateLimit: LIMITS.passwordReset,
  async handler({ body: { email } }) {
    const generic = {
      sent: true,
      devResetUrl: undefined as string | undefined,
    };

    const user = await prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      select: { id: true, email: true, passwordHash: true },
    });

    // OAuth-only accounts have no password to reset, so no mail is sent.
    if (!user?.passwordHash) return generic;

    const rawToken = createToken();

    // One live reset link at a time. Requesting a new one invalidates the old.
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: resetExpiry(),
      },
    });

    await sendPasswordResetEmail(user.email, rawToken);

    return { sent: true, devResetUrl: devActionUrl(resetUrl(rawToken)) };
  },
});
