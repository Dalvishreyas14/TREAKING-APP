import { WellbeingCheckIn, type WellbeingEntry } from "@/components/app/wellbeing-check-in";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { addDaysUtc, todayUtc } from "@/lib/date";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;

/**
 * Wellbeing.
 *
 * `today` and `history` are read in one query and split in memory: today's entry
 * is also the last element of the window, and two queries would either duplicate
 * it or need a merge step to work out which is which.
 */
export default async function WellbeingPage() {
  const user = await requireUser();
  const today = todayUtc();
  const from = addDaysUtc(today, -(WINDOW_DAYS - 1));

  const entries = await prisma.moodEnergyEntry.findMany({
    where: { userId: user.id, date: { gte: from, lte: today } },
    orderBy: { date: "asc" },
    select: {
      date: true,
      mood: true,
      energy: true,
      stress: true,
      sleepQuality: true,
      sleepHours: true,
      note: true,
    },
  });

  const rows: WellbeingEntry[] = entries.map((e) => ({
    date: e.date.toISOString(),
    mood: e.mood,
    energy: e.energy,
    stress: e.stress,
    sleepQuality: e.sleepQuality,
    sleepHours: e.sleepHours,
    note: e.note,
  }));

  const todayEntry = rows.find((r) => r.date.slice(0, 10) === today.toISOString().slice(0, 10)) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Wellbeing</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          Thirty seconds a day. Only you ever see this.
        </p>
      </header>

      <WellbeingCheckIn todayEntry={todayEntry} history={rows} />
    </div>
  );
}
