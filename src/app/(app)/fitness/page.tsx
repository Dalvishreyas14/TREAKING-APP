import { Dumbbell } from "lucide-react";

import { ActivityStrip, type ActivityPoint } from "@/components/app/activity-strip";
import { CategoryTracker, type DomainHabit } from "@/components/app/category-tracker";
import {
  WorkoutBoard,
  type ExerciseOption,
  type WorkoutView,
} from "@/components/app/fitness/workout-board";
import { WeeklyPlan, type ScheduleDayView } from "@/components/app/fitness/weekly-plan";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { addDaysUtc, todayUtc } from "@/lib/date";
import { serialiseWorkout, workoutDetailSelect } from "@/lib/fitness/server";
import {
  getSchedule,
  routineDetailSelect,
  serialiseRoutine,
} from "@/lib/fitness/schedule";
import { formatDayOfMonth, formatLocalClockTime } from "@/lib/format/date";
import { dateOnlyToIsoDay } from "@/lib/planner/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Fitness.
 *
 * Two complementary records, deliberately kept apart:
 *
 * - **Workouts** are structured sessions — exercises, sets, reps, weight — that
 *   a habit row cannot express. They live in `Workout` and are logged, planned
 *   and completed through the workout board.
 * - **Habits** whose category kind is FITNESS are the lighter, already-on-the-
 *   dashboard record: "walk 3 km", "steps". They stay exactly as they were.
 *
 * Neither double-counts the other: every workout figure is derived from
 * COMPLETED workouts only, and habit figures from habit logs only. The two are
 * summed only where a combined "minutes trained" figure is honest, because both
 * are genuinely measured in minutes.
 *
 * Planned minutes come from the planner: blocks tied to fitness habits, plus
 * planned workouts' own duration. A completed workout has no block left behind
 * (completing one removes its schedule), so a session can never be counted as
 * both planned and logged.
 */

const HISTORY_DAYS = 14;
const WINDOW_DAYS = 7;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export default async function FitnessPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const user = await requireUser();
  const { week } = await searchParams;
  const weekParam = week && ISO_DAY.test(week) ? week : undefined;
  const today = todayUtc();
  const historyStart = addDaysUtc(today, -(HISTORY_DAYS - 1));
  const windowStart = addDaysUtc(today, -(WINDOW_DAYS - 1));
  const planEnd = addDaysUtc(today, WINDOW_DAYS);

  const [categories, habits, workoutRows, exercises, schedule, routineRows] = await Promise.all([
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
          select: { date: true, value: true, completed: true, workoutId: true },
        },
      },
    }),
    prisma.workout.findMany({
      where: { userId: user.id },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 200,
      select: workoutDetailSelect,
    }),
    prisma.exercise.findMany({
      where: { OR: [{ isSystem: true }, { userId: user.id }] },
      orderBy: [{ muscleGroup: "asc" }, { name: "asc" }],
      select: { id: true, name: true, muscleGroup: true, equipment: true, isSystem: true },
    }),
    getSchedule(user.id, weekParam),
    prisma.workoutRoutine.findMany({
      where: { userId: user.id },
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
      select: routineDetailSelect,
    }),
  ]);

  const workouts: WorkoutView[] = workoutRows.map(serialiseWorkout);
  const routines = routineRows.map(serialiseRoutine);

  const habitIds = habits.map((h) => h.id);
  const todayKey = dateOnlyToIsoDay(today);
  const historyStartKey = dateOnlyToIsoDay(historyStart);
  const windowStartKey = dateOnlyToIsoDay(windowStart);
  const planEndKey = dateOnlyToIsoDay(planEnd);

  const completedWorkouts = workouts.filter((w) => w.status === "COMPLETED");

  const [planBlocks, todayBlocks] = await Promise.all([
    prisma.timeBlock.findMany({
      where: {
        userId: user.id,
        date: { gte: today, lte: planEnd },
        OR: [{ habitId: { in: habitIds } }, { workoutId: { not: null } }],
      },
      select: { startAt: true, endAt: true, habitId: true, workoutId: true },
    }),
    prisma.timeBlock.findMany({
      where: {
        userId: user.id,
        date: today,
        OR: [{ habitId: { in: habitIds } }, { workoutId: { not: null } }],
      },
      orderBy: { startAt: "asc" },
      select: { id: true, title: true, startAt: true, endAt: true, habitId: true, workoutId: true },
    }),
  ]);

  /**
   * `HabitLog.date` is a `@db.Date`, so it reads back as UTC midnight. The strip
   * is keyed by that same UTC key to avoid a second timezone conversion turning a
   * logged session into the neighbouring day.
   */
  const dateKey = (d: Date) => d.toISOString().slice(0, 10);

  const hasDurationHabit = habits.some((h) => h.type === "DURATION");
  const hasMinutes = hasDurationHabit || completedWorkouts.length > 0;

  // Completed workout minutes/count per day, so the strip and the totals can
  // fold them in without a second pass over the list.
  const workoutMinutesByDay = new Map<string, number>();
  const workoutCountByDay = new Map<string, number>();
  for (const workout of completedWorkouts) {
    if (workout.date < historyStartKey) continue;
    workoutMinutesByDay.set(
      workout.date,
      (workoutMinutesByDay.get(workout.date) ?? 0) + (workout.minutes ?? 0),
    );
    workoutCountByDay.set(workout.date, (workoutCountByDay.get(workout.date) ?? 0) + 1);
  }

  const points: ActivityPoint[] = Array.from({ length: HISTORY_DAYS }, (_, i) => {
    const day = addDaysUtc(historyStart, i);
    const key = dateKey(day);
    let value = 0;
    for (const habit of habits) {
      for (const log of habit.logs) {
        if (dateKey(log.date) !== key) continue;
        // A log a workout wrote is that workout counted a second time; its own
        // `minutes` already represent the session, so it is skipped here.
        if (log.workoutId) continue;
        if (!log.completed && log.value <= 0) continue;
        if (hasMinutes) {
          // The strip is in minutes, so only duration habits and workouts can
          // contribute. Adding `1` for a count or distance habit here would mix
          // a session count into a minutes series.
          if (habit.type === "DURATION") value += log.value;
        } else {
          value += 1;
        }
      }
    }
    if (hasMinutes) {
      value += workoutMinutesByDay.get(key) ?? 0;
    } else {
      value += workoutCountByDay.get(key) ?? 0;
    }
    return {
      date: key,
      label: formatDayOfMonth(day),
      value: Math.round(value * 10) / 10,
    };
  });

  const stripMax = hasMinutes
    ? Math.max(30, Math.ceil(Math.max(...points.map((p) => p.value), 0) / 15) * 15)
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

  const minutesForBlocks = (blocks: { startAt: Date; endAt: Date }[]) =>
    blocks.reduce(
      (sum, b) => sum + Math.max(0, Math.round((b.endAt.getTime() - b.startAt.getTime()) / 60_000)),
      0,
    );

  // Habit-linked blocks are scheduled time; workout-linked blocks are already
  // represented by the planned workout's own `minutes`, so they are excluded
  // here to avoid counting the same plan twice.
  const plannedHabitMinutes = minutesForBlocks(planBlocks.filter((b) => b.habitId));
  const plannedWorkoutMinutes = workouts
    .filter(
      (w) => w.status === "PLANNED" && w.date >= todayKey && w.date <= planEndKey,
    )
    .reduce((sum, w) => sum + (w.minutes ?? 0), 0);
  const plannedMinutes = plannedHabitMinutes + plannedWorkoutMinutes;

  const loggedHabitMinutes = habits
    .filter((h) => h.type === "DURATION")
    .reduce(
      (sum, h) =>
        sum +
        h.logs
          .filter((l) => l.date >= windowStart && !l.workoutId && (l.completed || l.value > 0))
          .reduce((n, l) => n + l.value, 0),
      0,
    );
  const loggedWorkoutMinutes = completedWorkouts
    .filter((w) => w.date >= windowStartKey && w.date <= todayKey)
    .reduce((sum, w) => sum + (w.minutes ?? 0), 0);
  const loggedMinutes = loggedHabitMinutes + loggedWorkoutMinutes;

  const activeDays = points.filter((p) => p.value > 0).length;
  const totalHabitSessions = habits.reduce(
    (n, h) => n + h.logs.filter((l) => !l.workoutId && (l.completed || l.value > 0)).length,
    0,
  );
  const totalSessions = totalHabitSessions + completedWorkouts.filter((w) => w.date >= historyStartKey).length;
  const totalMinutes =
    habits
      .filter((h) => h.type === "DURATION")
      .reduce((n, h) => n + h.logs.filter((l) => !l.workoutId && (l.completed || l.value > 0)).reduce((s, l) => s + l.value, 0), 0) +
    completedWorkouts
      .filter((w) => w.date >= historyStartKey)
      .reduce((n, w) => n + (w.minutes ?? 0), 0);

  const isEmpty = habits.length === 0 && workouts.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Fitness</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          {isEmpty
            ? "Movement you are actually doing, not a plan to move."
            : hasMinutes
              ? `${activeDays} active ${activeDays === 1 ? "day" : "days"} in the last ${HISTORY_DAYS} · ${Math.round(totalMinutes)} min · ${totalSessions} logged`
              : `${activeDays} active ${activeDays === 1 ? "day" : "days"} in the last ${HISTORY_DAYS} · ${totalSessions} logged`}
        </p>
      </header>

      <WorkoutBoard
        workouts={workouts}
        exercises={exercises as ExerciseOption[]}
        categories={categories}
        today={todayKey}
      />

      <WeeklyPlan
        weekStart={schedule.week.start}
        days={schedule.days as ScheduleDayView[]}
        routines={routines}
        today={todayKey}
        exercises={exercises as ExerciseOption[]}
      />

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{hasMinutes ? "Minutes trained" : "Sessions logged"}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ActivityStrip
              points={points}
              max={stripMax}
              unit={hasMinutes ? "min" : "sessions"}
            />
            <p className="text-[11px] leading-relaxed text-ink-subtle">
              {hasMinutes
                ? "Completed workouts and duration habits, both measured in minutes. Distance and count habits are tracked but not added in, because kilometres and minutes are not the same quantity."
                : "Counted from logged habits and completed workouts. Add a duration habit or log a workout with a duration and this chart switches to minutes."}
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
              Scheduled time is whatever you put on the planner, plus any planned
              workouts. It is a commitment you made to yourself, not a training
              prescription, and nothing here is medical or physiological advice.
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
                    {block.workoutId ? (
                      <Badge variant="outline" size="sm">
                        Workout
                      </Badge>
                    ) : null}
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
        emptyHint="Anything you categorise as fitness shows up here — a lighter alternative to a full workout log for things like steps or a daily walk."
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
