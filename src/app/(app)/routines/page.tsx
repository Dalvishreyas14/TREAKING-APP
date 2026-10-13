import { ListTodo } from "lucide-react";

import { RoutineList, type RoutineRow } from "@/components/app/routine-list";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { addDaysUtc, todayUtc } from "@/lib/date";
import { formatLocalClockTime, formatLocalWeekdayClock } from "@/lib/format/date";
import { suggestFromHistory } from "@/lib/routines/suggestions";

export const dynamic = "force-dynamic";

/**
 * Routines.
 *
 * A routine is a *template* of steps; running one is a `RoutineRun`. Keeping the
 * two apart is what makes the history meaningful: editing a routine's steps must
 * not rewrite what actually happened last Tuesday, and `RoutineRun` snapshots
 * `totalItems` at the start for exactly that reason.
 *
 * The completion rate shown here is computed from finished runs only. An open run
 * (started, never closed) is not counted as a failure — most open runs are simply
 * someone who walked away, and a routine that punishes a half-finished morning
 * gets abandoned rather than completed. The count of open runs is shown
 * separately so their existence is visible without being scored.
 *
 * `timeOfDay` is minutes from local midnight, so the label is formatted with the
 * user's own locale rather than re-zoned through UTC.
 *
 * History-based suggestions are computed here rather than fetched, because the
 * runs are already loaded for the completion rates and a second request for a
 * question about the same rows would be one more thing to wait for. `now` is
 * passed explicitly so the 30-day window is the page's idea of today and not a
 * second reading of the clock a few milliseconds away.
 */

const HISTORY_DAYS = 30;
const RUN_LIMIT = 40;

function formatTimeOfDay(minutes: number | null): string | null {
  if (minutes === null) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const date = new Date();
  date.setHours(h, m, 0, 0);
  return formatLocalClockTime(date);
}

export default async function RoutinesPage() {
  const user = await requireUser();
  const now = new Date();
  const since = addDaysUtc(todayUtc(), -(HISTORY_DAYS - 1));

  const [routines, runs, habits, categories] = await Promise.all([
    prisma.routine.findMany({
      where: { userId: user.id },
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        description: true,
        kind: true,
        timeOfDay: true,
        color: true,
        icon: true,
        isActive: true,
        createdAt: true,
        items: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            title: true,
            estimatedMinutes: true,
            habitId: true,
            createsTask: true,
            habit: { select: { name: true, color: true } },
          },
        },
      },
    }),
    prisma.routineRun.findMany({
      where: { userId: user.id, startedAt: { gte: since } },
      orderBy: { startedAt: "desc" },
      take: RUN_LIMIT,
      select: {
        id: true,
        routineId: true,
        startedAt: true,
        completedAt: true,
        completedItems: true,
        totalItems: true,
      },
    }),
    prisma.habit.findMany({
      where: { userId: user.id, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.category.findMany({
      where: { OR: [{ userId: user.id }, { userId: null }] },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, kind: true },
    }),
  ]);

  const rows: RoutineRow[] = routines.map((routine) => {
    const routineRuns = runs.filter((r) => r.routineId === routine.id);
    const closed = routineRuns.filter((r) => r.completedAt);
    const completed = closed.filter((r) => r.totalItems > 0 && r.completedItems >= r.totalItems);
    const totalMinutes = routine.items.reduce((n, i) => n + (i.estimatedMinutes ?? 0), 0);

    const suggestions = suggestFromHistory(
      routine.items.map((item) => ({
        id: item.id,
        title: item.title,
        estimatedMinutes: item.estimatedMinutes,
      })),
      routineRuns,
      now,
    );

    return {
      id: routine.id,
      name: routine.name,
      description: routine.description,
      kind: routine.kind,
      timeOfDay: routine.timeOfDay,
      timeLabel: formatTimeOfDay(routine.timeOfDay),
      color: routine.color,
      isActive: routine.isActive,
      estimatedMinutes: totalMinutes,
      items: routine.items.map((item) => ({
        id: item.id,
        title: item.title,
        estimatedMinutes: item.estimatedMinutes,
        habitId: item.habitId,
        habitName: item.habit?.name ?? null,
        createsTask: item.createsTask,
      })),
      runCount: routineRuns.length,
      completedRunCount: completed.length,
      /** A routine with no closed runs has no rate — never 0%, which reads as failure. */
      completionRate: closed.length ? Math.round((completed.length / closed.length) * 100) : null,
      openRunCount: routineRuns.length - closed.length,
      lastRunAt: routineRuns[0]?.startedAt.toISOString() ?? null,
      suggestions,
    };
  });

  const openRun = runs.find((r) => !r.completedAt);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Routines</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          {routines.length === 0
            ? "Sequences that make a good day repeatable."
            : `${rows.filter((r) => r.isActive).length} active · ${rows.reduce((n, r) => n + r.items.length, 0)} steps · ${rows.reduce((n, r) => n + r.completedRunCount, 0)} runs finished in ${HISTORY_DAYS} days`}
        </p>
      </header>

      {openRun ? (
        <p className="rounded-control border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink-muted">
          You have a run open from{" "}
          {formatLocalWeekdayClock(openRun.startedAt)}{" "}
          with {openRun.completedItems}/{openRun.totalItems} steps. Finish or abandon it
          from the routine it belongs to.
        </p>
      ) : null}

      <RoutineList
        routines={rows}
        habits={habits}
        categories={categories}
        emptyHint="A routine is the same steps in the same order. Start one, tick each step as you go, and the run is recorded even if you stop halfway."
      />

      <p className="flex items-center gap-2 text-[11px] text-ink-subtle">
        <ListTodo className="size-3.5" />
        Starting a routine puts its steps on your task list, and ticking a step
        finishes its task. Each step keeps one task for as long as you use it, so a
        routine adds to your list once rather than every morning. Turn it off per
        step for the ones that are ritual rather than work.
      </p>
    </div>
  );
}
