import { redirect } from "next/navigation";

import { Wordmark } from "@/components/brand/logo";
import { OnboardingForm } from "@/components/app/onboarding-form";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * First-run onboarding.
 *
 * Deliberately outside the `(app)` group: that layout wraps every page in
 * `AppShell`, and a user being introduced to LIFEOS should not open onto a
 * sidebar full of screens they have not used yet. It requires a session and
 * sends anyone who has already onboarded back to the dashboard, so the route is
 * safe to link to from settings and from the verification email.
 */
export default async function OnboardingPage() {
  const user = await requireUser();

  const [existingProfile, stats] = await Promise.all([
    prisma.profile.findUnique({ where: { userId: user.id } }),
    prisma.user.findUnique({
      where: { id: user.id },
      select: {
        name: true,
        onboardedAt: true,
        timezone: true,
        weekStartsOn: true,
        dailySummaryTime: true,
        gamificationOn: true,
      },
    }),
  ]);

  if (!stats) redirect("/sign-in");
  if (stats.onboardedAt) redirect("/dashboard");

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-5">
          <Wordmark />
          <p className="text-[13px] text-ink-subtle">About two minutes</p>
        </div>
      </header>

      <div className="flex flex-1 items-start justify-center px-5 py-10 sm:py-16">
        <OnboardingForm
          defaults={{
            name: user.name ?? stats.name ?? "",
            timezone: stats.timezone,
            weekStartsOn: stats.weekStartsOn,
            dailySummaryTime: stats.dailySummaryTime,
            gamificationOn: stats.gamificationOn,
            wakeMinutes: existingProfile?.wakeMinutes ?? undefined,
            sleepMinutes: existingProfile?.sleepMinutes ?? undefined,
            availableWeekdayMinutes:
              existingProfile?.availableWeekdayMinutes ?? undefined,
            availableWeekendMinutes:
              existingProfile?.availableWeekendMinutes ?? undefined,
            occupation: existingProfile?.occupation ?? "",
            workLabel: existingProfile?.workLabel ?? "",
            workStartMinutes: existingProfile?.workStartMinutes ?? null,
            workEndMinutes: existingProfile?.workEndMinutes ?? null,
            workDays: existingProfile?.workDays ?? [1, 2, 3, 4, 5],
            importantHabits: existingProfile?.importantHabits ?? [],
            goalsSummary: existingProfile?.goalsSummary ?? "",
          }}
        />
      </div>
    </main>
  );
}
