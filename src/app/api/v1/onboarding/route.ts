import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { onboardingSchema } from "@/lib/validation/schemas";

/**
 * POST /api/v1/onboarding
 *
 * Stores the answers that shape every later suggestion: the user's rhythm, how
 * many hours they actually have, and what they said matters most. Written once
 * and then editable in settings, so a user who changes their life is not stuck
 * with what they said on day one.
 *
 * Idempotent. Re-running onboarding overwrites the profile rather than creating
 * a second one, and `onboardedAt` is only stamped the first time so the
 * "first week" logic elsewhere can rely on it meaning "when they arrived".
 */
export const POST = withApi({
  method: "POST",
  body: onboardingSchema,
  async handler({ user, body }) {
    const existing = await prisma.user.findUnique({
      where: { id: user.id },
      select: { onboardedAt: true, name: true },
    });
    if (!existing) throw ApiError.unauthorized();

    const profileData = {
      wakeMinutes: body.wakeMinutes,
      sleepMinutes: body.sleepMinutes,
      availableWeekdayMinutes: body.availableWeekdayMinutes,
      availableWeekendMinutes: body.availableWeekendMinutes,
      occupation: body.occupation ?? null,
      workLabel: body.workLabel ?? null,
      workStartMinutes: body.workStartMinutes ?? null,
      workEndMinutes: body.workEndMinutes ?? null,
      workDays: body.workDays,
      importantHabits: body.importantHabits,
      goalsSummary: body.goalsSummary ?? null,
    };

    const user_ = await prisma.$transaction(async (tx) => {
      await tx.profile.upsert({
        where: { userId: user.id },
        create: { userId: user.id, ...profileData },
        update: profileData,
      });

      return tx.user.update({
        where: { id: user.id },
        data: {
          // A blank name is not worth overwriting an existing one with.
          ...(body.name ? { name: body.name } : {}),
          timezone: body.timezone,
          weekStartsOn: body.weekStartsOn,
          dailySummaryTime: body.dailySummaryTime,
          gamificationOn: body.gamificationOn,
          ...(existing.onboardedAt ? {} : { onboardedAt: new Date() }),
        },
        select: { id: true, name: true, onboardedAt: true, timezone: true },
      });
    });

    return user_;
  },
});
