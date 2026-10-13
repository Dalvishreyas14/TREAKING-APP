import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { hashPassword } from "@/lib/auth/password";
import { createToken, hashToken, normalizeEmail, verificationExpiry } from "@/lib/auth/tokens";
import { sendVerificationEmail, verificationUrl, devActionUrl } from "@/lib/email";
import { signUpSchema } from "@/lib/validation/schemas";

/**
 * POST /api/v1/auth/sign-up
 *
 * Creates the account, provisions gamification state and issues a verification
 * link. The user is NOT signed in here: `authorize` in the Auth.js config
 * refuses unverified accounts, so no unverified session can exist at all.
 *
 * The verification URL is echoed back in the response only when the dev mail
 * transport is active, which is what makes the flow testable without SMTP.
 */
export const POST = withApi({
  method: "POST",
  auth: false,
  body: signUpSchema,
  rateLimit: LIMITS.signUp,
  async handler({ body }) {
    const email = normalizeEmail(body.email);

    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw ApiError.conflict("An account with that email already exists.");
    }

    const passwordHash = await hashPassword(body.password);
    const rawToken = createToken();

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          name: body.name.trim(),
          passwordHash,
          // Stamped immediately so the very first session JWT has a marker to
          // be invalidated against later.
          passwordChangedAt: new Date(),
          // Default to UTC rather than trusting a request header, which is
          // trivially spoofed.
          timezone: "UTC",
        },
        select: { id: true, email: true, name: true },
      });

      // Provisioned here rather than in the Auth.js signIn event, because the
      // user does not sign in until they verify.
      await tx.userStats.create({ data: { userId: created.id } });

      await tx.emailVerificationToken.create({
        data: {
          userId: created.id,
          tokenHash: hashToken(rawToken),
          expiresAt: verificationExpiry(),
        },
      });

      return created;
    });

    await sendVerificationEmail(user.email, rawToken);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      devVerificationUrl: devActionUrl(verificationUrl(rawToken)),
    };
  },
});
