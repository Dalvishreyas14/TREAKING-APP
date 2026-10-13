import { SettingsScreen, type SettingsSnapshot } from "@/components/app/settings-screen";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Settings.
 *
 * The page reads the same rows the API edits, and passes them down as one
 * snapshot. The client form then PATCHes two endpoints — `/settings` for
 * preferences and `/settings/profile` for the planning inputs — and both are
 * saved together from a single button so the two can never be half-applied.
 *
 * `passwordHash` is deliberately never selected. Nothing in the UI needs it, and
 * a settings screen that reads a hash is a settings screen that can leak one.
 *
 * `aiConsentAt` is shown only to state the truth about external providers: in
 * this build nothing is ever sent anywhere, so consent is never required and
 * switching AI off clears the stamp server-side as a withdrawal.
 */

export default async function SettingsPage() {
  const user = await requireUser();

  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      name: true,
      email: true,
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
      createdAt: true,
      profile: {
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
        },
      },
    },
  });

  const snapshot: SettingsSnapshot = {
    name: record?.name ?? null,
    email: record?.email ?? user.email,
    theme: record?.theme ?? "SYSTEM",
    timezone: record?.timezone ?? "UTC",
    locale: record?.locale ?? "en-IN",
    aiEnabled: record?.aiEnabled ?? true,
    aiConsentAt: record?.aiConsentAt?.toISOString() ?? null,
    gamificationOn: record?.gamificationOn ?? true,
    weekStartsOn: record?.weekStartsOn ?? 0,
    dailySummaryTime: record?.dailySummaryTime ?? 8,
    quietHoursStart: record?.quietHoursStart ?? 22,
    quietHoursEnd: record?.quietHoursEnd ?? 7,
    createdAt: record?.createdAt.toISOString() ?? null,
    onboarded: !!record?.onboardedAt,
    profile: record?.profile ?? null,
  };

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Settings</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          Your day boundaries live here, and the planner reads them every time it
          builds a schedule.
        </p>
      </header>

      <SettingsScreen initial={snapshot} />
    </div>
  );
}
