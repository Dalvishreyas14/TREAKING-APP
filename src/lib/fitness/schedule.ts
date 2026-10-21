import "server-only";

import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { addDaysUtc, dateOnly, startOfWeekUtc, todayUtc } from "@/lib/date";
import { blockInstants, blockMinutes, dateOnlyToIsoDay, isoDayToDateOnly } from "@/lib/planner/server";
import { findConflict } from "@/lib/planner/layout";
import { weekBounds } from "@/lib/weekly-plans/week";
import { WORKOUT_BLOCK_COLOR, resolveWorkoutTiming, serialiseWorkout, workoutDetailSelect } from "@/lib/fitness/server";
import type { Prisma } from "@/generated/prisma/client";

/**
 * The weekly workout planner's server half: recurring routines, and the
 * materialisation of those routines into concrete `Workout` rows.
 *
 * Everything here is Monday-first. `WorkoutRoutineDay.weekday` is 0 = Monday ..
 * 6 = Sunday, `weekBounds(anchor, 1)` hardcodes a Monday week regardless of the
 * user's `weekStartsOn` (a training week is a training week), and the one
 * conversion to JS's Sunday-first `getUTCDay()` is `mondayIndex`, used only at
 * generation time.
 */

/** How many weeks ahead the schedule is lazily kept filled. */
export const SCHEDULE_HORIZON_WEEKS = 6;

/** The stored weekday index (0 = Monday) for a `@db.Date` calendar day. */
export function mondayIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

// --------------------------------------------------------------- read shape

export const routineDetailSelect = {
  id: true,
  userId: true,
  name: true,
  description: true,
  color: true,
  isActive: true,
  activatedAt: true,
  pausedAt: true,
  generatedThrough: true,
  createdAt: true,
  updatedAt: true,
  days: {
    orderBy: { weekday: "asc" },
    select: {
      id: true,
      weekday: true,
      name: true,
      muscleGroups: true,
      isRest: true,
      targetMinutes: true,
      startMinutes: true,
      notes: true,
      position: true,
      exercises: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          exerciseId: true,
          name: true,
          position: true,
          restSeconds: true,
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
            },
          },
        },
      },
    },
  },
} satisfies Prisma.WorkoutRoutineSelect;

export type RoutineDetail = Prisma.WorkoutRoutineGetPayload<{
  select: typeof routineDetailSelect;
}>;

export function serialiseRoutine(routine: RoutineDetail) {
  return {
    id: routine.id,
    name: routine.name,
    description: routine.description,
    color: routine.color,
    isActive: routine.isActive,
    activatedAt: routine.activatedAt ? routine.activatedAt.toISOString() : null,
    pausedAt: routine.pausedAt ? routine.pausedAt.toISOString() : null,
    generatedThrough: routine.generatedThrough
      ? dateOnlyToIsoDay(routine.generatedThrough)
      : null,
    days: routine.days.map((day) => ({
      id: day.id,
      weekday: day.weekday,
      name: day.name,
      muscleGroups: day.muscleGroups,
      isRest: day.isRest,
      targetMinutes: day.targetMinutes,
      startMinutes: day.startMinutes,
      notes: day.notes,
      position: day.position,
      exercises: day.exercises.map((exercise) => ({
        id: exercise.id,
        exerciseId: exercise.exerciseId,
        name: exercise.name,
        position: exercise.position,
        restSeconds: exercise.restSeconds,
        notes: exercise.notes,
        sets: exercise.sets,
      })),
    })),
  };
}

export type SerialisedRoutine = ReturnType<typeof serialiseRoutine>;

// ------------------------------------------------------------ nested writes

type RoutineDayInput = {
  weekday: number;
  name: string;
  muscleGroups: string[];
  isRest: boolean;
  targetMinutes?: number | null;
  startMinutes?: number | null;
  notes?: string | null;
  exercises: {
    exerciseId?: string | null;
    name: string;
    notes?: string | null;
    restSeconds?: number | null;
    sets: {
      reps?: number | null;
      weight?: number | null;
      durationSeconds?: number | null;
      restSeconds?: number | null;
    }[];
  }[];
};

/**
 * The nested-write payload for a routine's seven days.
 *
 * Sent whole and created with nested `create`, matching how a workout's exercise
 * tree is written: a routine is small, and replacing it wholesale keeps stored
 * order and displayed order in exact agreement. A rest day carries no exercises,
 * enforced here rather than in the schema so the API never stores an exercise on
 * a day the user marked as rest.
 */
export function routineDaysCreateData(
  days: RoutineDayInput[],
): Prisma.WorkoutRoutineDayCreateWithoutRoutineInput[] {
  return days.map((day, dayIndex) => ({
    weekday: day.weekday,
    name: day.name,
    muscleGroups: day.muscleGroups,
    isRest: day.isRest,
    targetMinutes: day.isRest ? null : day.targetMinutes ?? null,
    startMinutes: day.isRest ? null : day.startMinutes ?? null,
    notes: day.notes ?? null,
    position: dayIndex,
    exercises: day.isRest
      ? undefined
      : {
          create: day.exercises.map((exercise, exerciseIndex) => ({
            exerciseId: exercise.exerciseId ?? null,
            name: exercise.name,
            position: exerciseIndex,
            notes: exercise.notes ?? null,
            restSeconds: exercise.restSeconds ?? null,
            sets: {
              create: exercise.sets.map((set, setIndex) => ({
                position: setIndex,
                reps: set.reps ?? null,
                weight: set.weight ?? null,
                durationSeconds: set.durationSeconds ?? null,
                restSeconds: set.restSeconds ?? null,
              })),
            },
          })),
        },
  }));
}

// ------------------------------------------------------------- generation

/**
 * Create the concrete PLANNED sessions a routine implies for every day in
 * `[from, through]` that has no session for the routine yet.
 *
 * Idempotent by `(routineId, date)`: a day already materialised is skipped, so
 * running this on every schedule read is safe. A session that also carries a
 * start time and a duration places a planner block, subject to the planner's
 * no-double-booking rule — on a clash the block is skipped but the session is
 * still created, because the training day matters more than the calendar slot
 * and a generation pass must never abort the whole week over one clash.
 */
export async function generateRoutineSchedule(
  tx: Prisma.TransactionClient,
  routine: RoutineDetail,
  from: Date,
  through: Date,
): Promise<void> {
  const trainingDays = routine.days.filter((day) => !day.isRest);
  if (trainingDays.length === 0) return;
  const byWeekday = new Map(trainingDays.map((day) => [day.weekday, day]));

  const start = dateOnly(from);
  const end = dateOnly(through);

  for (let cursor = start; cursor.getTime() <= end.getTime(); cursor = addDaysUtc(cursor, 1)) {
    const day = byWeekday.get(mondayIndex(cursor));
    if (!day) continue;

    const isoDay = dateOnlyToIsoDay(cursor);
    const startMinutes = day.startMinutes ?? null;
    const { date, startAt } = resolveWorkoutTiming(isoDay, startMinutes);

    const existing = await tx.workout.findFirst({
      where: { userId: routine.userId, routineId: routine.id, date },
      select: { id: true },
    });
    if (existing) continue;

    const created = await tx.workout.create({
      data: {
        userId: routine.userId,
        name: day.name,
        date,
        startAt,
        minutes: day.targetMinutes ?? null,
        status: "PLANNED",
        muscleGroups: day.muscleGroups,
        routineId: routine.id,
        routineDayId: day.id,
        exercises: {
          create: day.exercises.map((exercise, index) => ({
            exerciseId: exercise.exerciseId,
            name: exercise.name,
            position: index,
            notes: exercise.notes,
            sets: {
              create: exercise.sets.map((set, setIndex) => ({
                position: setIndex,
                reps: set.reps,
                weight: set.weight,
                durationSeconds: set.durationSeconds,
                restSeconds: set.restSeconds,
              })),
            },
          })),
        },
      },
      select: { id: true },
    });

    if (startMinutes !== null && day.targetMinutes != null) {
      await createBlockIfFree(
        tx,
        routine.userId,
        created.id,
        day.name,
        isoDay,
        startMinutes,
        day.targetMinutes,
      );
    }
  }
}

/** Place a workout's planner block unless another block already owns the slot. */
async function createBlockIfFree(
  tx: Prisma.TransactionClient,
  userId: string,
  workoutId: string,
  title: string,
  isoDay: string,
  startMinutes: number,
  durationMinutes: number,
): Promise<void> {
  const { date, startAt, endAt } = blockInstants(isoDay, startMinutes, durationMinutes);
  const sameDay = await tx.timeBlock.findMany({
    where: { userId, date },
    select: { id: true, startAt: true, endAt: true },
  });
  const candidate = {
    startMinutes,
    endMinutes: Math.min(startMinutes + durationMinutes, 1440),
  };
  const others = sameDay.map((block) => ({ id: block.id, ...blockMinutes(block.startAt, block.endAt) }));
  if (findConflict(candidate, others)) return;
  await tx.timeBlock.create({
    data: {
      userId,
      title,
      date,
      startAt,
      endAt,
      color: WORKOUT_BLOCK_COLOR,
      source: "MANUAL",
      workoutId,
    },
  });
}

// ------------------------------------------------------------- scheduling

async function loadActiveRoutine(userId: string): Promise<RoutineDetail | null> {
  return prisma.workoutRoutine.findFirst({
    where: { userId, isActive: true },
    select: routineDetailSelect,
  });
}

/**
 * Extend an active routine's materialised schedule up to the rolling horizon.
 *
 * Only days *after* `generatedThrough` are filled, which is what stops a session
 * the user deleted from being recreated on the next page load. Called on every
 * schedule read; a no-op once the horizon is reached.
 */
export async function ensureActiveSchedule(userId: string): Promise<void> {
  const routine = await loadActiveRoutine(userId);
  if (!routine) return;

  const today = todayUtc();
  const horizonEnd = addDaysUtc(startOfWeekUtc(today), SCHEDULE_HORIZON_WEEKS * 7 - 1);
  const from = routine.generatedThrough ? addDaysUtc(routine.generatedThrough, 1) : today;
  if (from.getTime() > horizonEnd.getTime()) return;

  await prisma.$transaction(async (tx) => {
    await generateRoutineSchedule(tx, routine, from, horizonEnd);
    await tx.workoutRoutine.update({
      where: { id: routine.id },
      data: { generatedThrough: horizonEnd },
    });
  });
}

export interface ScheduleDay {
  date: string;
  weekday: number;
  isRest: boolean;
  restLabel: string | null;
  workouts: ReturnType<typeof serialiseWorkout>[];
}

/**
 * A week's worth of concrete sessions plus the rest days the active routine
 * declares, ready to serialise for the client.
 *
 * `week` is any day inside the requested week; the window is always the Monday
 * .. Sunday containing it. The schedule is topped up before reading, so a week
 * further ahead than anyone has visited is still full.
 */
export async function getSchedule(userId: string, weekIso?: string): Promise<{
  week: { start: string; end: string };
  days: ScheduleDay[];
  activeRoutine: SerialisedRoutine | null;
}> {
  await ensureActiveSchedule(userId);

  const anchor = weekIso ? isoDayToDateOnly(weekIso) : todayUtc();
  const bounds = weekBounds(anchor, 1);

  const [workouts, activeRoutine] = await Promise.all([
    prisma.workout.findMany({
      where: { userId, date: { gte: bounds.start, lte: bounds.end } },
      orderBy: [{ date: "asc" }, { startAt: "asc" }, { createdAt: "asc" }],
      select: workoutDetailSelect,
    }),
    loadActiveRoutine(userId),
  ]);

  const byDate = new Map<string, ReturnType<typeof serialiseWorkout>[]>();
  for (const workout of workouts) {
    const key = dateOnlyToIsoDay(workout.date);
    const list = byDate.get(key) ?? [];
    list.push(serialiseWorkout(workout));
    byDate.set(key, list);
  }

  const days: ScheduleDay[] = Array.from({ length: 7 }, (_, i) => {
    const day = addDaysUtc(bounds.start, i);
    const iso = dateOnlyToIsoDay(day);
    const weekday = mondayIndex(day);
    const routineDay = activeRoutine?.days.find((d) => d.weekday === weekday) ?? null;
    const isRest = routineDay?.isRest ?? false;
    return {
      date: iso,
      weekday,
      isRest,
      restLabel: isRest ? routineDay!.name : null,
      workouts: byDate.get(iso) ?? [],
    };
  });

  return {
    week: { start: dateOnlyToIsoDay(bounds.start), end: dateOnlyToIsoDay(bounds.end) },
    days,
    activeRoutine: activeRoutine ? serialiseRoutine(activeRoutine) : null,
  };
}

// ------------------------------------------------------------- mutations

async function requireRoutine(userId: string, id: string): Promise<RoutineDetail> {
  const routine = await prisma.workoutRoutine.findFirst({
    where: { id, userId },
    select: routineDetailSelect,
  });
  if (!routine) throw ApiError.notFound("That routine no longer exists.");
  return routine;
}

/** Activate a routine, deactivating any other, and start filling its schedule. */
export async function activateRoutine(userId: string, id: string): Promise<SerialisedRoutine> {
  await requireRoutine(userId, id);
  const today = todayUtc();

  await prisma.$transaction(async (tx) => {
    await tx.workoutRoutine.updateMany({
      where: { userId, isActive: true, id: { not: id } },
      data: { isActive: false, pausedAt: new Date() },
    });
    await tx.workoutRoutine.update({
      where: { id },
      data: {
        isActive: true,
        activatedAt: new Date(),
        pausedAt: null,
        generatedThrough: addDaysUtc(today, -1),
      },
    });
  });

  await ensureActiveSchedule(userId);
  return serialiseRoutine(await requireRoutine(userId, id));
}

/** Pause a routine. Already-materialised sessions are kept, not deleted. */
export async function pauseRoutine(userId: string, id: string): Promise<SerialisedRoutine> {
  await requireRoutine(userId, id);
  const routine = await prisma.workoutRoutine.update({
    where: { id },
    data: { isActive: false, pausedAt: new Date() },
    select: routineDetailSelect,
  });
  return serialiseRoutine(routine);
}

export type ApplyScope = "future" | "week";

/**
 * Re-materialise a routine's schedule after its template changed.
 *
 * `future` wipes every not-yet-done session from today onwards and refills to
 * the horizon. `week` touches only the named week. Either way, anything the user
 * has acted on — COMPLETED, SKIPPED, IN_PROGRESS, RESCHEDULED — and anything in
 * the past is left untouched: the template is the plan, not the record.
 */
export async function applyRoutine(
  userId: string,
  id: string,
  scope: ApplyScope,
  weekIso?: string,
): Promise<{ regenerated: true }> {
  const routine = await requireRoutine(userId, id);
  const today = todayUtc();

  if (scope === "week") {
    const anchor = weekIso ? isoDayToDateOnly(weekIso) : today;
    const bounds = weekBounds(anchor, 1);
    await prisma.$transaction(async (tx) => {
      await tx.workout.deleteMany({
        where: {
          userId,
          routineId: id,
          status: "PLANNED",
          date: { gte: bounds.start, lte: bounds.end },
        },
      });
      await generateRoutineSchedule(tx, routine, bounds.start, bounds.end);
    });
    return { regenerated: true };
  }

  await prisma.$transaction(async (tx) => {
    await tx.workout.deleteMany({
      where: { userId, routineId: id, status: "PLANNED", date: { gte: today } },
    });
    await tx.workoutRoutine.update({
      where: { id },
      data: { generatedThrough: addDaysUtc(today, -1) },
    });
  });

  if (routine.isActive) {
    await ensureActiveSchedule(userId);
  } else {
    // An inactive routine the user is editing: regenerate the horizon explicitly
    // so "apply to future weeks" means the same thing whether or not it is the
    // routine currently driving today.
    const horizonEnd = addDaysUtc(startOfWeekUtc(today), SCHEDULE_HORIZON_WEEKS * 7 - 1);
    await prisma.$transaction(async (tx) => {
      await generateRoutineSchedule(tx, routine, today, horizonEnd);
      await tx.workoutRoutine.update({
        where: { id },
        data: { generatedThrough: horizonEnd },
      });
    });
  }

  return { regenerated: true };
}

/**
 * Build a reusable routine from the sessions already scheduled in a week.
 *
 * The week's concrete rows are the source: each training day becomes a routine
 * day with its name, muscle groups and exercises. A day with no session is left
 * out entirely rather than guessed at, so the resulting template is exactly what
 * the user built.
 */
export async function routineFromWeek(
  userId: string,
  weekIso: string,
  name: string,
  description: string | null,
): Promise<SerialisedRoutine> {
  const bounds = weekBounds(isoDayToDateOnly(weekIso), 1);
  const workouts = await prisma.workout.findMany({
    where: {
      userId,
      date: { gte: bounds.start, lte: bounds.end },
      status: { in: ["PLANNED", "IN_PROGRESS"] },
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    select: workoutDetailSelect,
  });

  const byWeekday = new Map<number, (typeof workouts)[number]>();
  for (const workout of workouts) {
    const weekday = mondayIndex(workout.date);
    if (!byWeekday.has(weekday)) byWeekday.set(weekday, workout);
  }

  if (byWeekday.size === 0) {
    throw ApiError.badRequest("There is nothing scheduled this week to save as a routine.");
  }

  const days: RoutineDayInput[] = [...byWeekday.entries()].map(([weekday, workout]) => ({
    weekday,
    name: workout.name,
    muscleGroups: workout.muscleGroups,
    isRest: false,
    targetMinutes: workout.minutes,
    startMinutes: null,
    notes: workout.notes,
    exercises: workout.exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      notes: exercise.notes,
      restSeconds: null,
      sets: exercise.sets.map((set) => ({
        reps: set.reps,
        weight: set.weight,
        durationSeconds: set.durationSeconds,
        restSeconds: set.restSeconds,
      })),
    })),
  }));

  const created = await prisma.workoutRoutine.create({
    data: {
      userId,
      name,
      description,
      days: { create: routineDaysCreateData(days) },
    },
    select: { id: true },
  });

  return serialiseRoutine(await requireRoutine(userId, created.id));
}
