import { z } from "zod";
import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { hashToken, isExpired } from "@/lib/auth/tokens";

const body = z.object({ token: z.string().min(10, "This link is not valid") });

/**
 * POST /api/v1/auth/verify-email
 *
 * Consumes a single-use verification token. Reached from a deliberate button
 * press rather than the emailed link itself, so an email scanner or browser
 * prefetch cannot silently burn the user's only token.
 */
export const POST = withApi({
  method: "POST",
  auth: false,
  body,
  rateLimit: LIMITS.emailVerification,
  async handler({ body: { token } }) {
    const record = await prisma.emailVerificationToken.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });

    // One message for every failure mode. Distinguishing "expired" from "already
    // used" from "invalid" tells an attacker which tokens exist.
    const invalid = ApiError.badRequest(
      "This verification link is invalid or has expired.",
    );

    if (!record || record.usedAt || isExpired(record.expiresAt)) {
      throw invalid;
    }

    await prisma.$transaction(async (tx) => {
      // Conditional update: `usedAt: null` in the WHERE clause makes this an
      // atomic compare-and-set, so two concurrent clicks cannot both succeed.
      const claimed = await tx.emailVerificationToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw invalid;

      await tx.user.update({
        where: { id: record.userId },
        data: { emailVerified: new Date() },
      });
    });

    return { verified: true, signInUrl: "/sign-in?verified=1" };
  },
});
