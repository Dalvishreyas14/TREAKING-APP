import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { assertNoConflict, blockInstants, isoDayToDateOnly } from "@/lib/planner/server";
import {
  assertWorkoutLinks,
  exerciseTreeCreateData,
  logWorkoutHabit,
  resolveWorkoutTiming,
  serialiseWorkout,
  WORKOUT_BLOCK_COLOR,
  workoutDetailSelect,
} from "@/lib/fitness/server";
import {
  workoutCreateSchema,
  workoutListQuerySchema,
} from "@/lib/validation/schemas";

/**
 * GET /api/v1/workouts   POST /api/v1/workouts
 *
 * The workout log. `status` filters the two meanings of a Workout row apart:
 * COMPLETED rows are history, PLANNED rows are a schedule. The fitness page
 * reads both, but every progress figure is built from COMPLETED only — a plan
 * is not something you did.
 */

export const GET = withApi({
  method: "GET",
  query: workoutListQuerySchema,
  async handler({ user, query }) {
    const items = await prisma.workout.findMany({
      where: {
        userId: user.id,
        ...(query.from || query.to
          ? {
              date: {
                ...(query.from ? { gte: isoDayToDateOnly(query.from) } : {}),
                ...(query.to ? { lte: isoDayToDateOnly(query.to) } : {}),
              },
            }
          : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: query.limit,
      select: workoutDetailSelect,
    });

    return { items: items.map(serialiseWorkout) };
  },
});

/**
 * POST /api/v1/workouts
 *
 * A PLANNED workout that carries both a time of day and a duration also places
 * a block on the planner in the same transaction, so "I will train at 6pm for
 * 45 minutes" is one statement that cannot half-happen. The block is subject to
 * the planner's usual no-double-booking rule; logging a workout that has
 * already happened never touches the planner at all.
 */
export const POST = withApi({
  method: "POST",
  body: workoutCreateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, body }) {
    await assertWorkoutLinks(user.id, body.categoryId, body.goalId, body.habitId);

    const startMinutes = body.startMinutes ?? null;
    const { date, startAt } = resolveWorkoutTiming(body.date, startMinutes);

    const shouldPlan =
      body.status === "PLANNED" && startMinutes !== null && body.minutes !== null;
    if (shouldPlan) {
      await assertNoConflict(user.id, body.date, startMinutes, body.minutes!);
    }

    const created = await prisma.$transaction(async (tx) => {
      const workout = await tx.workout.create({
        data: {
          userId: user.id,
          name: body.name,
          date,
          startAt,
          minutes: body.minutes ?? null,
          notes: body.notes ?? null,
          status: body.status,
          completedAt: body.status === "COMPLETED" ? new Date() : null,
          startedAt: body.status === "IN_PROGRESS" ? new Date() : null,
          muscleGroups: body.muscleGroups,
          categoryId: body.categoryId ?? null,
          goalId: body.goalId ?? null,
          habitId: body.habitId ?? null,
          exercises: { create: exerciseTreeCreateData(body.exercises) },
        },
        select: workoutDetailSelect,
      });

      if (body.status === "COMPLETED") {
        await logWorkoutHabit(tx, {
          id: workout.id,
          userId: user.id,
          habitId: workout.habitId,
          date: workout.date,
          minutes: workout.minutes,
        });
      }

      if (shouldPlan) {
        const block = blockInstants(body.date, startMinutes!, body.minutes!);
        await tx.timeBlock.create({
          data: {
            userId: user.id,
            title: body.name,
            date: block.date,
            startAt: block.startAt,
            endAt: block.endAt,
            color: WORKOUT_BLOCK_COLOR,
            source: "MANUAL",
            workoutId: workout.id,
          },
        });
      }

      return workout;
    });

    if (!created) throw ApiError.internal();
    return serialiseWorkout(created);
  },
});
