import { Dumbbell } from "lucide-react";

import { ActivityStrip, type ActivityPoint } from "@/components/app/activity-strip";
import { CategoryTracker, type DomainHabit } from "@/components/app/category-tracker";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { addDaysUtc, todayUtc } from "@/lib/date";
import { formatDayOfMonth, formatLocalClockTime } from "@/lib/format/date";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Fitness.
 *
 * A view over habits whose category kind is FITNESS. There is no separate
 * workout log, and that is the design: a "Run 3 km" habit is already on the
 * dashboard, already in streaks, and already feeding insights. A second table
 * would be a second source of truth for the same fact.
 *
 * Two derivations worth spelling out, because both are easy to get subtly wrong:
 *
 * **Minutes come from DURATION habits only.** Adding a 3 km run and a 45 minute
 * workout into one "total" is arithmetic on incompatible units, and a number like
 * "48" with no unit is worse than no number. When the user has no DURATION
 * habit, the strip falls back to counting sessions, and says so in its label
 * rather than quietly changing what the bars mean.
 *
 * **Planned minutes are scheduled, not prescribed.** Time blocks attached to
 * these habits in the next seven days are summed and shown against what was
 * actually logged in the last seven. That is a real comparison the user already
 * implicitly makes, and it is only honest because the two windows are labelled.
 */

const HISTORY_DAYS = 14;
const WINDOW_DAYS = 7;

export default async function FitnessPage() {
  const user = await requireUser();
  const today = todayUtc();
  const historyStart = addDaysUtc(today, -(HISTORY_DAYS - 1));
  const windowStart = addDaysUtc(today, -(WINDOW_DAYS - 1));
  const planEnd = addDaysUtc(today, WINDOW_DAYS);

  const [categories, habits] = await Promise.all([
    prisma.category.findMany({
      where: {
        kind: "FITNESS",
        OR: [{ userId: user.id }, { userId: null }],
      },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    prisma.habit.findMany({
      where: {
        userId: user.id,
        isActive: true,
        category: { kind: "FITNESS" },
      },
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
  ]);

  const habitIds = habits.map((h) => h.id);

  const [plannedBlocks, todayBlocks] = await Promise.all([
    habitIds.length
      ? prisma.timeBlock.findMany({
          where: {
            userId: user.id,
            habitId: { in: habitIds },
            date: { gte: today, lte: planEnd },
          },
          select: { startAt: true, endAt: true },
        })
      : Promise.resolve([]),
    habitIds.length
      ? prisma.timeBlock.findMany({
          where: { userId: user.id, habitId: { in: habitIds }, date: today },
          orderBy: { startAt: "asc" },
          select: { id: true, title: true, startAt: true, endAt: true },
        })
      : Promise.resolve([]),
  ]);

  /**
   * `HabitLog.date` is a `@db.Date`, so it reads back as UTC midnight. The strip
   * is keyed by that same UTC key to avoid a second timezone conversion turning a
   * logged session into the neighbouring day.
   */
  const dateKey = (d: Date) => d.toISOString().slice(0, 10);

  const hasDurationHabit = habits.some((h) => h.type === "DURATION");

  const points: ActivityPoint[] = Array.from({ length: HISTORY_DAYS }, (_, i) => {
    const day = addDaysUtc(historyStart, i);
    const key = dateKey(day);
    let value = 0;
    for (const habit of habits) {
      for (const log of habit.logs) {
        if (dateKey(log.date) !== key) continue;
        if (!log.completed && log.value <= 0) continue;
        if (hasDurationHabit) {
          // The strip is in minutes, so only duration habits can contribute.
          // Adding `1` for a count or distance habit here would silently mix a
          // session count into a minutes series, and the caption below the
          // chart explicitly promises that it does not.
          if (habit.type === "DURATION") value += log.value;
        } else {
          // No duration habit exists, so the strip counts sessions. A BOOLEAN
          // run still happened and counting it is closer to the truth than
          // dropping it.
          value += 1;
        }
      }
    }
    return {
      date: key,
      label: formatDayOfMonth(day),
      value: Math.round(value * 10) / 10,
    };
  });

  const stripMax = hasDurationHabit
    ? // Round up to the nearest 15 minutes so the ceiling is a round number the
      // user can hold in their head, rather than whatever their busiest day was.
      Math.max(30, Math.ceil(Math.max(...points.map((p) => p.value), 0) / 15) * 15)
    : Math.max(1, Math.max(...points.map((p) => p.value), 0));

  const rows: DomainHabit[] = habits.map((habit) => {
    const todayLog = habit.logs.find((l) => dateKey(l.date) === dateKey(today)) ?? null;
    const weekValue = habit.logs
      .filter((l) => l.date >= windowStart)
      .reduce((sum, l) => sum + (l.completed || l.value > 0 ? (habit.type === "BOOLEAN" ? 1 : l.value) : 0), 0);

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

  const plannedMinutes = plannedBlocks.reduce(
    (sum, b) => sum + Math.max(0, Math.round((b.endAt.getTime() - b.startAt.getTime()) / 60_000)),
    0,
  );
  const loggedMinutes = habits
    .filter((h) => h.type === "DURATION")
    .reduce(
      (sum, h) =>
        sum +
        h.logs
          .filter((l) => l.date >= windowStart && (l.completed || l.value > 0))
          .reduce((n, l) => n + l.value, 0),
      0,
    );

  const activeDays = points.filter((p) => p.value > 0).length;
  const totalSessions = habits.reduce(
    (n, h) => n + h.logs.filter((l) => l.completed || l.value > 0).length,
    0,
  );
  const totalMinutes = habits
    .filter((h) => h.type === "DURATION")
    .reduce((n, h) => n + h.logs.filter((l) => l.completed || l.value > 0).reduce((s, l) => s + l.value, 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Fitness</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          {habits.length === 0
            ? "Movement you are actually doing, not a plan to move."
            : hasDurationHabit
              ? `${activeDays} active ${activeDays === 1 ? "day" : "days"} in the last ${HISTORY_DAYS} · ${Math.round(totalMinutes)} min · ${totalSessions} logged`
              : `${activeDays} active ${activeDays === 1 ? "day" : "days"} in the last ${HISTORY_DAYS} · ${totalSessions} logged`}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{hasDurationHabit ? "Minutes trained" : "Sessions logged"}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ActivityStrip
              points={points}
              max={stripMax}
              unit={hasDurationHabit ? "min" : "sessions"}
            />
            <p className="text-[11px] leading-relaxed text-ink-subtle">
              {hasDurationHabit
                ? "Summed from duration habits. Distance and count habits are tracked but not added in, because kilometres and minutes are not the same quantity."
                : "Counted from logged habits. Add a duration habit such as “Workout 45 min” and this chart switches to minutes."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Planned vs logged</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Compare
              label="Scheduled next 7 days"
              minutes={plannedMinutes}
              total={Math.max(plannedMinutes, loggedMinutes)}
            />
            <Compare
              label="Logged last 7 days"
              minutes={loggedMinutes}
              total={Math.max(plannedMinutes, loggedMinutes)}
            />
            <p className="text-[11px] leading-relaxed text-ink-subtle">
              Scheduled time is whatever you put on the planner. It is a
              commitment you made to yourself, not a training prescription, and
              nothing here is medical or physiological advice.
            </p>
          </CardContent>
        </Card>
      </div>

      {todayBlocks.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>On the plan today</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1.5">
              {todayBlocks.map((block) => {
                const minutes = Math.max(
                  0,
                  Math.round((block.endAt.getTime() - block.startAt.getTime()) / 60_000),
                );
                return (
                  <li key={block.id} className="flex items-center gap-3 text-[13px]">
                    <span className="w-24 shrink-0 tabular-nums text-ink-subtle">
                      {formatLocalClockTime(block.startAt)}
                    </span>
                    <span className="flex-1 truncate text-ink">{block.title}</span>
                    <Badge variant="outline" size="sm">
                      {minutes} min
                    </Badge>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <CategoryTracker
        kind="FITNESS"
        title="Your fitness habits"
        description="Filed under a fitness category, so they also count on the dashboard and in streaks."
        habits={rows}
        categories={categories}
        emptyHint="Anything you categorise as fitness shows up here — one place to log, no separate workout log to keep in sync."
      />

      {habits.length === 0 ? (
        <p className="flex items-center gap-2 text-[11px] text-ink-subtle">
          <Dumbbell className="size-3.5" />
          Tip: you can also set a category on an existing habit from the Habits screen.
        </p>
      ) : null}
    </div>
  );
}

function Compare({
  label,
  minutes,
  total,
}: {
  label: string;
  minutes: number;
  total: number;
}) {
  const share = total > 0 ? Math.round((minutes / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] text-ink-muted">{label}</span>
        <span className="text-[13px] font-semibold tabular-nums text-ink">
          {Math.round(minutes)} min
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
        <div
          style={{ width: `${Math.max(minutes > 0 ? 4 : 0, share)}%` }}
          className={cn("h-full rounded-full", share >= 100 ? "bg-ink" : "bg-lime")}
        />
      </div>
    </div>
  );
}
