import { HabitList, type HabitItem } from "@/components/app/habit-list";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { addDaysUtc, todayUtc } from "@/lib/date";

export const dynamic = "force-dynamic";

const STRIP_DAYS = 28;

/**
 * Habits.
 *
 * Archived habits are loaded alongside active ones so the screen can offer a
 * restore. Archiving is deliberately reversible — see the DELETE handler in
 * /api/v1/habits/[id] for why the logs are never actually removed — and a
 * restore that needs a support ticket would make that promise hollow.
 */
export default async function HabitsPage() {
  const user = await requireUser();
  const today = todayUtc();
  const from = addDaysUtc(today, -(STRIP_DAYS - 1));

  const [habits, logs] = await Promise.all([
    prisma.habit.findMany({
      where: { userId: user.id },
      orderBy: [{ archivedAt: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        color: true,
        type: true,
        unit: true,
        targetValue: true,
        frequency: true,
        archivedAt: true,
      },
    }),
    prisma.habitLog.findMany({
      where: { userId: user.id, date: { gte: from, lte: today } },
      select: { habitId: true, date: true, value: true, completed: true },
    }),
  ]);

  const byHabit = new Map<string, typeof logs>();
  for (const log of logs) {
    const list = byHabit.get(log.habitId);
    if (list) list.push(log);
    else byHabit.set(log.habitId, [log]);
  }

  const items: HabitItem[] = habits.map((habit) => {
    const history = byHabit.get(habit.id) ?? [];
    const todayLog = history.find((l) => l.date.getTime() === today.getTime());
    return {
      id: habit.id,
      name: habit.name,
      color: habit.color,
      type: habit.type,
      unit: habit.unit,
      targetValue: habit.targetValue,
      frequency: habit.frequency,
      archivedAt: habit.archivedAt ? habit.archivedAt.toISOString() : null,
      today: {
        value: todayLog?.value ?? 0,
        completed: habit.archivedAt ? false : (todayLog?.completed ?? false),
      },
      history: history.map((l) => ({
        date: l.date.toISOString(),
        value: l.value,
        completed: l.completed,
      })),
    };
  });

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Habits</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          The last {STRIP_DAYS} days, so a broken streak shows up immediately.
        </p>
      </header>

      <HabitList initialHabits={items} />
    </div>
  );
}
