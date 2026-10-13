import { withApi } from "@/lib/api/with-api";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { normalizeEmail, createToken, hashToken, verificationExpiry } from "@/lib/auth/tokens";
import { sendVerificationEmail, verificationUrl, devActionUrl } from "@/lib/email";
import { resendVerificationSchema } from "@/lib/validation/schemas";

/**
 * POST /api/v1/auth/resend-verification
 *
 * Re-issues a verification link. Always reports success: an attacker must not be
 * able to learn whether an address is registered by watching this endpoint.
 */
export const POST = withApi({
  method: "POST",
  auth: false,
  body: resendVerificationSchema,
  rateLimit: LIMITS.emailVerification,
  async handler({ body: { email } }) {
    const user = await prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      select: { id: true, email: true, emailVerified: true },
    });

    if (!user || user.emailVerified) {
      return { sent: true };
    }

    const rawToken = createToken();

    // Retire outstanding tokens first, so only the newest link is live and a
    // previously forwarded email stops working.
    await prisma.emailVerificationToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: verificationExpiry(),
      },
    });

    await sendVerificationEmail(user.email, rawToken);

    return {
      sent: true,
      devVerificationUrl: devActionUrl(verificationUrl(rawToken)),
    };
  },
});
