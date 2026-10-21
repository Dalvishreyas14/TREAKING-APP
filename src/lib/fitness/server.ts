import "server-only";

import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { blockInstants, isoDayToDateOnly, dateOnlyToIsoDay } from "@/lib/planner/server";
import type { Prisma } from "@/generated/prisma/client";

/** Colour a planned workout's block carries on the planner. */
export const WORKOUT_BLOCK_COLOR = "#C8F751";

/**
 * Shared read shape for a workout, so the detail route and the list route speak
 * the same language and a client component can render either without branching.
 *
 * The select is deliberately deep: a workout's meaning lives in its exercise
 * tree, and fetching it in one query avoids the N+1 that a per-workout detail
 * fetch would otherwise introduce on the history list.
 */
export const workoutDetailSelect = {
  id: true,
  userId: true,
  name: true,
  date: true,
  startAt: true,
  minutes: true,
  notes: true,
  status: true,
  completedAt: true,
  startedAt: true,
  muscleGroups: true,
  categoryId: true,
  goalId: true,
  habitId: true,
  routineId: true,
  routineDayId: true,
  rescheduledFromDate: true,
  category: { select: { id: true, name: true, color: true } },
  goal: { select: { id: true, title: true } },
  exercises: {
    orderBy: { position: "asc" },
    select: {
      id: true,
      exerciseId: true,
      name: true,
      position: true,
      notes: true,
      sets: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          reps: true,
          weight: true,
          durationSeconds: true,
          restSeconds: true,
          completed: true,
        },
      },
    },
  },
} satisfies Prisma.WorkoutSelect;

export type WorkoutDetail = Prisma.WorkoutGetPayload<{
  select: typeof workoutDetailSelect;
}>;

/**
 * Strip Prisma's own types (and the `Date` objects inside them) down to the
 * JSON-safe shape the client receives. `date` in particular has to go out as a
 * bare `yyyy-MM-dd`: serialised as a full ISO timestamp it carries a time that
 * the client would then reinterpret in its own zone, shifting the day.
 */
export function serialiseWorkout(workout: WorkoutDetail) {
  return {
    id: workout.id,
    name: workout.name,
    date: dateOnlyToIsoDay(workout.date),
    startAt: workout.startAt ? workout.startAt.toISOString() : null,
    minutes: workout.minutes,
    notes: workout.notes,
    status: workout.status,
    completedAt: workout.completedAt ? workout.completedAt.toISOString() : null,
    startedAt: workout.startedAt ? workout.startedAt.toISOString() : null,
    muscleGroups: workout.muscleGroups,
    categoryId: workout.categoryId,
    goalId: workout.goalId,
    habitId: workout.habitId,
    routineId: workout.routineId,
    routineDayId: workout.routineDayId,
    rescheduledFromDate: workout.rescheduledFromDate
      ? dateOnlyToIsoDay(workout.rescheduledFromDate)
      : null,
    category: workout.category,
    goal: workout.goal,
    exercises: workout.exercises.map((exercise) => ({
      id: exercise.id,
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      position: exercise.position,
      notes: exercise.notes,
      sets: exercise.sets,
    })),
  };
}

export type SerialisedWorkout = ReturnType<typeof serialiseWorkout>;

/**
 * The nested-write payload for a workout's exercise tree.
 *
 * `exercises` is sent whole and created with nested `create` rather than
 * diffed, because the client edits a workout as a single form and the tree is
 * small. Replacing it wholesale inside one transaction keeps the stored order
 * and the order the user sees in exact agreement.
 */
export function exerciseTreeCreateData(
  exercises: {
    exerciseId?: string | null;
    name: string;
    notes?: string | null;
    sets: {
      reps?: number | null;
      weight?: number | null;
      durationSeconds?: number | null;
      restSeconds?: number | null;
      completed: boolean;
    }[];
  }[],
): Prisma.WorkoutExerciseUncheckedCreateWithoutWorkoutInput[] {
  return exercises.map((exercise, index) => ({
    exerciseId: exercise.exerciseId ?? null,
    name: exercise.name,
    position: index,
    notes: exercise.notes ?? null,
    sets: {
      create: exercise.sets.map((set, setIndex) => ({
        position: setIndex,
        reps: set.reps ?? null,
        weight: set.weight ?? null,
        durationSeconds: set.durationSeconds ?? null,
        restSeconds: set.restSeconds ?? null,
        completed: set.completed,
      })),
    },
  }));
}

/**
 * Resolve a workout's `@db.Date` day and optional instant from a calendar day
 * and a time of day.
 *
 * Reuses the planner's `blockInstants` so the workout's day and the day its
 * scheduled block lands on are derived by the exact same code. When no time is
 * given the day is the literal calendar day, which is the right answer for a
 * workout logged after the fact.
 */
export function resolveWorkoutTiming(
  isoDay: string,
  startMinutes: number | null,
): { date: Date; startAt: Date | null } {
  if (startMinutes === null) {
    return { date: isoDayToDateOnly(isoDay), startAt: null };
  }
  const { date, startAt } = blockInstants(isoDay, startMinutes, 0);
  return { date, startAt };
}

/** Minutes from local midnight for a stored workout start instant. */
export function startMinutesOf(startAt: Date | null): number | null {
  return startAt ? startAt.getHours() * 60 + startAt.getMinutes() : null;
}

/**
 * Verify a workout's optional category, goal and habit belong to this user (or,
 * for a category, are a shared system row). Mirrors `assertLinkOwnership`, which
 * only knows about tasks and habits.
 */
export async function assertWorkoutLinks(
  userId: string,
  categoryId?: string | null,
  goalId?: string | null,
  habitId?: string | null,
): Promise<void> {
  if (categoryId) {
    const category = await prisma.category.findFirst({
      where: { id: categoryId, OR: [{ userId }, { userId: null }] },
      select: { id: true },
    });
    if (!category) throw ApiError.badRequest("That category no longer exists.");
  }
  if (goalId) {
    const goal = await prisma.goal.findFirst({
      where: { id: goalId, userId },
      select: { id: true },
    });
    if (!goal) throw ApiError.badRequest("That goal no longer exists.");
  }
  if (habitId) {
    const habit = await prisma.habit.findFirst({
      where: { id: habitId, userId },
      select: { id: true },
    });
    if (!habit) throw ApiError.badRequest("That habit no longer exists.");
  }
}

/**
 * Log the linked habit for a completed workout, if it is not already logged.
 *
 * This is how a session can "contribute" to a habit — keeping a Gym streak alive
 * — without the fitness page counting the effort twice. The written log carries
 * the workout's id, and the fitness page excludes workout-linked logs from its
 * minutes because the workout's own `minutes` already represents that session.
 *
 * Written through a passed-in transaction so it commits atomically with the
 * status change: a workout marked COMPLETED whose habit was not logged would be
 * a silent half-truth. Only creates a log when none exists, so a habit the user
 * already ticked by hand is left exactly as they left it.
 */
export async function logWorkoutHabit(
  tx: Prisma.TransactionClient,
  workout: { id: string; userId: string; habitId: string | null; date: Date; minutes: number | null },
): Promise<void> {
  if (!workout.habitId) return;

  const existing = await tx.habitLog.findUnique({
    where: { habitId_date: { habitId: workout.habitId, date: workout.date } },
    select: { id: true, workoutId: true },
  });

  if (existing) {
    // Adopt an unlinked hand-logged row so the double-count guard still holds,
    // but never overwrite the value the user entered.
    if (!existing.workoutId) {
      await tx.habitLog.update({
        where: { id: existing.id },
        data: { workoutId: workout.id },
      });
    }
    return;
  }

  await tx.habitLog.create({
    data: {
      userId: workout.userId,
      habitId: workout.habitId,
      date: workout.date,
      value: workout.minutes ?? 1,
      completed: true,
      workoutId: workout.id,
    },
  });
}
