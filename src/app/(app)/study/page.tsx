import { GraduationCap } from "lucide-react";

import { ActivityStrip, type ActivityPoint } from "@/components/app/activity-strip";
import { CategoryTracker, type DomainHabit } from "@/components/app/category-tracker";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { addDaysUtc, dateOnlyLocal, todayUtc } from "@/lib/date";
import { formatDayOfMonth, formatLocalDayMonth } from "@/lib/format/date";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Study.
 *
 * Same shape as Fitness — a lens over habits categorised as STUDY — but the
 * interesting number here is one the user cannot get from the habit grid at all:
 * **focus actually spent on study tasks**.
 *
 * That figure comes from `FocusSession`, joined through the session's task to the
 * task's category, rather than from the habit log. A timer is self-reported and
 * easy to skip, whereas a finished focus session has a start, an end, and actual
 * elapsed seconds, so it is the more honest measure of hours on a book. It also
 * catches study done inside a task ("Revise chapter 4") that nobody ever made a
 * habit for.
 *
 * `FocusSession.taskId` is nullable and set to null on task delete, so those
 * minutes are genuinely unavailable rather than merely undiscovered. That is
 * stated on the card instead of quietly shrinking the total.
 */

const HISTORY_DAYS = 14;
const WINDOW_DAYS = 7;

export default async function StudyPage() {
  const user = await requireUser();
  const today = todayUtc();
  const historyStart = addDaysUtc(today, -(HISTORY_DAYS - 1));
  const windowStart = addDaysUtc(today, -(WINDOW_DAYS - 1));
  const planEnd = addDaysUtc(today, WINDOW_DAYS);
  const focusStart = new Date(historyStart.getTime() - 12 * 3600_000);

  const [categories, habits, studyTaskIds] = await Promise.all([
    prisma.category.findMany({
      where: { kind: "STUDY", OR: [{ userId: user.id }, { userId: null }] },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    prisma.habit.findMany({
      where: { userId: user.id, isActive: true, category: { kind: "STUDY" } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        color: true,
        type: true,
        unit: true,
        targetValue: true,
        targetMinutes: true,
        frequency: true,
        timesPerPeriod: true,
        category: { select: { name: true } },
        logs: {
          where: { date: { gte: historyStart, lte: today } },
          select: { date: true, value: true, completed: true },
        },
      },
    }),
    prisma.task.findMany({
      where: { userId: user.id, category: { kind: "STUDY" } },
      select: { id: true },
    }),
  ]);

  const taskIds = studyTaskIds.map((t) => t.id);
  const habitIds = habits.map((h) => h.id);

  const [sessions, orphanFocus, upcomingTasks, plannedBlocks] = await Promise.all([
    taskIds.length
      ? prisma.focusSession.findMany({
          where: {
            userId: user.id,
            taskId: { in: taskIds },
            startedAt: { gte: focusStart },
            endedAt: { not: null },
          },
          select: { startedAt: true, actualSeconds: true, rating: true, taskId: true },
        })
      : Promise.resolve([]),
    // Focus with no task at all. Reported as a caveat rather than mixed in,
    // because unattributed minutes cannot honestly be called study.
    prisma.focusSession.aggregate({
      where: {
        userId: user.id,
        taskId: null,
        startedAt: { gte: focusStart },
        endedAt: { not: null },
      },
      _sum: { actualSeconds: true },
      _count: { _all: true },
    }),
    prisma.task.findMany({
      where: {
        userId: user.id,
        category: { kind: "STUDY" },
        status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
      },
      orderBy: [{ dueAt: "asc" }, { priorityScore: "desc" }],
      take: 8,
      select: { id: true, title: true, status: true, dueAt: true, estimatedMinutes: true },
    }),
    // Gated on tasks *or* habits, not tasks alone. A user who studies through a
    // linked habit block and has no study tasks yet would otherwise be shown zero
    // planned minutes on a screen whose whole point is planned vs actual, and
    // the "nothing planned" reading would be wrong.
    taskIds.length > 0 || habitIds.length > 0
      ? prisma.timeBlock.findMany({
          where: {
            userId: user.id,
            OR: [
              ...(taskIds.length ? [{ taskId: { in: taskIds } }] : []),
              ...(habitIds.length ? [{ habitId: { in: habitIds } }] : []),
            ],
            date: { gte: today, lte: planEnd },
          },
          select: { startAt: true, endAt: true },
        })
      : Promise.resolve([]),
  ]);

  const dateKey = (d: Date) => d.toISOString().slice(0, 10);

  /**
   * Focus sessions are grouped by their *local* calendar day, not by the UTC day.
   * Someone who studies at 23:30 did it on that day where they were sitting, and
   * filing it under the next UTC day would move nearly half of an evening's work
   * onto the following column.
   *
   * `dateOnlyLocal` reduces an instant to a UTC-midnight timestamp of the day the
   * user was actually on, so both sides of the comparison below are the same kind
   * of value. Comparing `getFullYear()`/`getMonth()`/`getDate()` of a local date
   * against the `getUTC*` fields of the column day — as this used to — only
   * produced the right answer on a server that happened to run in UTC, and was
   * off by a day for every session in the evening everywhere else.
   */
  const localDayKey = (d: Date) => dateOnlyLocal(d).toISOString().slice(0, 10);
  const focusPoints: ActivityPoint[] = Array.from({ length: HISTORY_DAYS }, (_, i) => {
    const day = addDaysUtc(historyStart, i);
    const key = dateKey(day);
    const minutes = sessions
      .filter((s) => localDayKey(s.startedAt) === key)
      .reduce((n, s) => n + s.actualSeconds / 60, 0);
    return {
      date: key,
      label: formatDayOfMonth(day),
      value: Math.round(minutes),
    };
  });

  const stripMax = Math.max(30, Math.ceil(Math.max(...focusPoints.map((p) => p.value), 0) / 30) * 30);

  const windowMinutes = focusPoints
    .slice(-WINDOW_DAYS)
    .reduce((n, p) => n + p.value, 0);
  const totalMinutes = focusPoints.reduce((n, p) => n + p.value, 0);
  const rated = sessions.filter((s) => s.rating != null);
  const avgRating = rated.length
    ? rated.reduce((n, s) => n + (s.rating ?? 0), 0) / rated.length
    : null;
  const orphanMinutes = Math.round((orphanFocus._sum.actualSeconds ?? 0) / 60);

  const plannedMinutes = plannedBlocks.reduce(
    (sum, b) => sum + Math.max(0, Math.round((b.endAt.getTime() - b.startAt.getTime()) / 60_000)),
    0,
  );

  const rows: DomainHabit[] = habits.map((habit) => {
    const todayLog = habit.logs.find((l) => dateKey(l.date) === dateKey(today)) ?? null;
    const weekValue = habit.logs
      .filter((l) => l.date >= windowStart)
      .reduce(
        (sum, l) => sum + (l.completed || l.value > 0 ? (habit.type === "BOOLEAN" ? 1 : l.value) : 0),
        0,
      );
    return {
      id: habit.id,
      name: habit.name,
      color: habit.color,
      type: habit.type,
      unit: habit.unit,
      targetValue: habit.targetValue,
      targetMinutes: habit.targetMinutes,
      frequency: habit.frequency,
      timesPerPeriod: habit.timesPerPeriod,
      categoryName: habit.category?.name ?? "Uncategorised",
      today: todayLog ? { value: todayLog.value, completed: todayLog.completed } : null,
      weekValue: Math.round(weekValue * 100) / 100,
      sessionCount: habit.logs.filter((l) => l.completed).length,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Study</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          {sessions.length === 0 && habits.length === 0
            ? "Time actually spent, measured by the clock rather than by intention."
            : `${Math.round(totalMinutes)} min focused in ${HISTORY_DAYS} days · ${windowMinutes} min this week`}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Focus minutes on study tasks</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ActivityStrip points={focusPoints} max={stripMax} unit="min" />
            <dl className="grid grid-cols-3 gap-3 border-t border-line pt-3">
              <Stat label="This week" value={`${windowMinutes} min`} />
              <Stat
                label={`Last ${HISTORY_DAYS} days`}
                value={`${Math.round(totalMinutes)} min`}
              />
              <Stat
                label="Self-rated"
                value={avgRating ? `${avgRating.toFixed(1)} / 5` : "—"}
                hint={rated.length ? `${rated.length} rated sessions` : "No ratings yet"}
              />
            </dl>
            <p className="text-[11px] leading-relaxed text-ink-subtle">
              Measured from finished focus sessions against tasks in a study
              category, using elapsed time rather than planned time.
              {orphanMinutes > 0
                ? ` A further ${orphanMinutes} min of focus in the last ${HISTORY_DAYS} days had no task attached and is excluded rather than guessed at.`
                : ""}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Time committed</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] text-ink-muted">On the planner, next 7 days</span>
                <span className="text-[13px] font-semibold tabular-nums text-ink">
                  {plannedMinutes} min
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                <div
                  style={{
                    width: `${Math.max(plannedMinutes > 0 ? 4 : 0, windowMinutes > 0 ? Math.min(100, Math.round((plannedMinutes / Math.max(plannedMinutes, windowMinutes)) * 100)) : 0)}%`,
                  }}
                  className={cn("h-full rounded-full bg-lime")}
                />
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-ink-subtle">
              Blocked time is a plan; the chart above is what happened. Divergence
              between them is the useful signal, not a verdict.
            </p>

            {upcomingTasks.length > 0 ? (
              <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                <p className="text-[13px] font-medium text-ink-muted">Open study tasks</p>
                {upcomingTasks.map((task) => (
                  <div key={task.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                      {task.title}
                    </span>
                    {task.estimatedMinutes ? (
                      <span className="shrink-0 text-[11px] text-ink-subtle">
                        {task.estimatedMinutes}m
                      </span>
                    ) : null}
                    {task.dueAt ? (
                      <Badge variant={task.dueAt < new Date() ? "coral" : "outline"} size="sm">
                        {formatLocalDayMonth(task.dueAt)}
                      </Badge>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <CategoryTracker
        kind="STUDY"
        title="Your study habits"
        description="Reading, revision and vocabulary — the countable parts of studying."
        habits={rows}
        categories={categories}
        emptyHint="A study habit can be anything countable: pages, words, cards, minutes. Tag it as study and it appears here and in streaks."
      />

      {habits.length === 0 && taskIds.length === 0 ? (
        <p className="flex items-center gap-2 text-[11px] text-ink-subtle">
          <GraduationCap className="size-3.5" />
          Study minutes come from focus sessions on study tasks, so a study task
          and a focus timer is enough to get a number here.
        </p>
      ) : null}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] text-ink-subtle">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-ink">{value}</dd>
      {hint ? <dd className="text-[10px] text-ink-subtle">{hint}</dd> : null}
    </div>
  );
}
