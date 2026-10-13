import { withApi } from "@/lib/api/with-api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api/errors";
import { LIMITS } from "@/lib/rate-limit";
import { profileUpdateSchema } from "@/lib/validation/schemas";

/**
 * PATCH /api/v1/settings/profile
 *
 * The answers that shape every later suggestion: rhythm, available hours, and
 * what the user said matters most. Separate from `/settings` because these are
 * the numbers the planner reads, and a user editing "what time do I wake up" is
 * doing something conceptually different from toggling dark mode.
 *
 * Upsert rather than create. Onboarding writes the row, but a user can reach
 * settings first, and a 404 from the profile form is a worse answer than a
 * second chance.
 *
 * The pair refinements mirror `onboardingSchema`: half a work schedule is not a
 * schedule, and wake-at-07:00/sleep-at-07:00 is a 24-hour day.
 */

export const PATCH = withApi({
  method: "PATCH",
  body: profileUpdateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, body }) {
    const hasWorkStart = body.workStartMinutes !== undefined;
    const hasWorkEnd = body.workEndMinutes !== undefined;
    if (hasWorkStart !== hasWorkEnd) {
      throw ApiError.validation("Give both a work start and end time, or neither.", {
        workStartMinutes: "Both work times are needed",
      });
    }

    // Both fields are present by the time this is reached: the pair check above
    // has already rejected a request that supplies only one of them.
    const workStart = body.workStartMinutes;
    const workEnd = body.workEndMinutes;
    if (workStart != null && workEnd != null && workStart >= workEnd) {
      throw ApiError.validation("Work has to end after it starts.", {
        workEndMinutes: "That is not after the start time",
      });
    }

    const hasCollegeStart = body.collegeStartMinutes !== undefined;
    const hasCollegeEnd = body.collegeEndMinutes !== undefined;
    if (hasCollegeStart !== hasCollegeEnd) {
      throw ApiError.validation("Give both a college start and end time, or neither.", {
        collegeStartMinutes: "Both college times are needed",
      });
    }

    const collegeStart = body.collegeStartMinutes;
    const collegeEnd = body.collegeEndMinutes;
    if (collegeStart != null && collegeEnd != null && collegeStart >= collegeEnd) {
      throw ApiError.validation("College has to end after it starts.", {
        collegeEndMinutes: "That is not after the start time",
      });
    }

    if (
      body.wakeMinutes !== undefined &&
      body.wakeMinutes !== null &&
      body.sleepMinutes !== undefined &&
      body.sleepMinutes !== null &&
      body.wakeMinutes === body.sleepMinutes
    ) {
      throw ApiError.validation("Wake and sleep times cannot be the same.", {
        sleepMinutes: "Pick a different time",
      });
    }

    // Undefined means "not in this request" and is left alone. Null means "clear
    // it", which is a real edit. Conflating the two would make it impossible to
    // clear a single optional field.
    const data = {
      ...(body.ageRange !== undefined ? { ageRange: body.ageRange } : {}),
      ...(body.occupation !== undefined ? { occupation: body.occupation } : {}),
      ...(body.wakeMinutes !== undefined ? { wakeMinutes: body.wakeMinutes } : {}),
      ...(body.sleepMinutes !== undefined ? { sleepMinutes: body.sleepMinutes } : {}),
      ...(body.availableWeekdayMinutes !== undefined
        ? { availableWeekdayMinutes: body.availableWeekdayMinutes }
        : {}),
      ...(body.availableWeekendMinutes !== undefined
        ? { availableWeekendMinutes: body.availableWeekendMinutes }
        : {}),
      ...(body.studyTargetMinutes !== undefined
        ? { studyTargetMinutes: body.studyTargetMinutes }
        : {}),
      ...(body.fitnessFrequency !== undefined
        ? { fitnessFrequency: body.fitnessFrequency }
        : {}),
      ...(body.productivityStyle !== undefined
        ? { productivityStyle: body.productivityStyle }
        : {}),
      ...(body.focusPreference !== undefined
        ? { focusPreference: body.focusPreference }
        : {}),
      ...(body.workLabel !== undefined ? { workLabel: body.workLabel } : {}),
      ...(body.workStartMinutes !== undefined ? { workStartMinutes: body.workStartMinutes } : {}),
      ...(body.workEndMinutes !== undefined ? { workEndMinutes: body.workEndMinutes } : {}),
      ...(body.workDays !== undefined ? { workDays: body.workDays ?? [] } : {}),
      ...(body.collegeLabel !== undefined ? { collegeLabel: body.collegeLabel } : {}),
      ...(body.collegeStartMinutes !== undefined
        ? { collegeStartMinutes: body.collegeStartMinutes }
        : {}),
      ...(body.collegeEndMinutes !== undefined
        ? { collegeEndMinutes: body.collegeEndMinutes }
        : {}),
      ...(body.collegeDays !== undefined ? { collegeDays: body.collegeDays ?? [] } : {}),
      ...(body.importantHabits !== undefined
        ? { importantHabits: body.importantHabits ?? [] }
        : {}),
      ...(body.goalsSummary !== undefined ? { goalsSummary: body.goalsSummary } : {}),
    };

    const profile = await prisma.profile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
      select: {
        ageRange: true,
        occupation: true,
        wakeMinutes: true,
        sleepMinutes: true,
        availableWeekdayMinutes: true,
        availableWeekendMinutes: true,
        studyTargetMinutes: true,
        fitnessFrequency: true,
        productivityStyle: true,
        focusPreference: true,
        workLabel: true,
        workStartMinutes: true,
        workEndMinutes: true,
        workDays: true,
        collegeLabel: true,
        collegeStartMinutes: true,
        collegeEndMinutes: true,
        collegeDays: true,
        importantHabits: true,
        goalsSummary: true,
        updatedAt: true,
      },
    });

    return profile;
  },
});
