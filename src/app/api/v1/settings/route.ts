import { withApi } from "@/lib/api/with-api";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { settingsUpdateSchema } from "@/lib/validation/schemas";

/**
 * GET /api/v1/settings
 *
 * Returns preferences and the profile that shapes planning, in one round trip.
 * The settings screen edits both in a single form and saves them together, so
 * splitting the read would mean two loading states for one page.
 *
 * The profile is joined rather than a second request because a missing profile
 * row is normal — a user who skipped onboarding still has a settings page, and
 * it should render with defaults instead of an error.
 */

const profileSelect = {
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
} as const;

const userSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  theme: true,
  timezone: true,
  locale: true,
  aiEnabled: true,
  aiConsentAt: true,
  gamificationOn: true,
  weekStartsOn: true,
  dailySummaryTime: true,
  quietHoursStart: true,
  quietHoursEnd: true,
  onboardedAt: true,
  profile: { select: profileSelect },
} as const;

export const GET = withApi({
  method: "GET",
  async handler({ user }) {
    const record = await prisma.user.findUnique({
      where: { id: user.id },
      select: userSelect,
    });

    // A session user always has a row. Returning a shape the client can render
    // keeps a transient inconsistency from turning the settings page into an
    // error boundary.
    return record ?? { id: user.id, name: user.name, email: user.email, profile: null };
  },
});

/**
 * PATCH /api/v1/settings
 *
 * Preferences live on `User`, and the planner's day boundaries are derived from
 * them, so a bad value here quietly breaks scheduling for weeks afterwards. That
 * is why the ranges are validated in `settingsUpdateSchema` rather than trusted.
 *
 * `theme` and `gamificationOn` are written even though they are not in the body
 * schema's stricter AI fields, because the schema is `.partial()` and these
 * arrive as booleans. Sending `aiConsentAt` directly is deliberately impossible:
 * Zod strips unknown keys, so a client cannot grant itself external-LLM consent,
 * and consent is only ever set by the server at the point it is actually needed.
 */
export const PATCH = withApi({
  method: "PATCH",
  body: settingsUpdateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, body }) {
    return prisma.user.update({
      where: { id: user.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.theme !== undefined ? { theme: body.theme } : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
        ...(body.locale !== undefined ? { locale: body.locale } : {}),
        ...(body.gamificationOn !== undefined ? { gamificationOn: body.gamificationOn } : {}),
        ...(body.weekStartsOn !== undefined ? { weekStartsOn: body.weekStartsOn } : {}),
        ...(body.dailySummaryTime !== undefined
          ? { dailySummaryTime: body.dailySummaryTime }
          : {}),
        ...(body.quietHoursStart !== undefined ? { quietHoursStart: body.quietHoursStart } : {}),
        ...(body.quietHoursEnd !== undefined ? { quietHoursEnd: body.quietHoursEnd } : {}),
        // Turning AI off is an instruction, and also a consent withdrawal: the
        // stamp is cleared in the same update so a later re-enable has to be an
        // explicit act rather than the residue of an old one.
        ...(body.aiEnabled !== undefined
          ? {
              aiEnabled: body.aiEnabled,
              aiConsentAt: body.aiEnabled ? undefined : null,
            }
          : {}),
      },
      select: userSelect,
    });
  },
});
