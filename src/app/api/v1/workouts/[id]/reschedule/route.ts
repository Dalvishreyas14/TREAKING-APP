import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { assertNoConflict, blockInstants } from "@/lib/planner/server";
import {
  resolveWorkoutTiming,
  serialiseWorkout,
  startMinutesOf,
  WORKOUT_BLOCK_COLOR,
  workoutDetailSelect,
} from "@/lib/fitness/server";
import { workoutRescheduleSchema } from "@/lib/validation/schemas";

/**
 * POST /api/v1/workouts/:id/reschedule
 *
 * Move a planned session to a different day.
 *
 * This is deliberately not the same as editing `date` on the workout. A plain
 * edit moves the row and the week silently shows the session on its new day with
 * no trace of the old one. A reschedule closes the original slot as RESCHEDULED
 * and creates a fresh PLANNED copy, so the calendar can say "moved here from
 * Tuesday" and the history keeps the fact that the original slot was given up.
 *
 * Only a PLANNED or IN_PROGRESS session can be moved. A completed one is a
 * record, and rewriting where it happened would be falsifying history.
 */

const params = z.object({ id: z.string().min(1) });

export const POST = withApi({
  method: "POST",
  params,
  body: workoutRescheduleSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const existing = await prisma.workout.findUnique({
      where: { id: params.id },
      select: workoutDetailSelect,
    });
    assertOwnership(existing, user.id, "That workout no longer exists.");
    const source = existing!;

    if (source.status !== "PLANNED" && source.status !== "IN_PROGRESS") {
      throw ApiError.badRequest("Only a planned session can be rescheduled.");
    }

    const nextStartMinutes =
      body.startMinutes !== undefined
        ? body.startMinutes
        : startMinutesOf(source.startAt);
    const { date, startAt } = resolveWorkoutTiming(body.date, nextStartMinutes);

    const shouldPlan = nextStartMinutes !== null && source.minutes !== null;
    const linkedBlock = await prisma.timeBlock.findFirst({
      where: { workoutId: source.id },
      select: { id: true },
    });

    if (shouldPlan) {
      await assertNoConflict(
        user.id,
        body.date,
        nextStartMinutes!,
        source.minutes!,
        linkedBlock?.id,
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      await tx.workout.update({
        where: { id: source.id },
        data: { status: "RESCHEDULED", completedAt: null, startedAt: null },
      });

      // The original slot is no longer a plan, so its block must go with it.
      await tx.timeBlock.deleteMany({ where: { workoutId: source.id } });

      const copy = await tx.workout.create({
        data: {
          userId: user.id,
          name: source.name,
          date,
          startAt,
          minutes: source.minutes,
          notes: source.notes,
          status: "PLANNED",
          muscleGroups: source.muscleGroups,
          categoryId: source.categoryId,
          goalId: source.goalId,
          habitId: source.habitId,
          routineId: source.routineId,
          routineDayId: source.routineDayId,
          rescheduledFromDate: source.date,
          exercises: {
            create: source.exercises.map((exercise, index) => ({
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
                  completed: false,
                })),
              },
            })),
          },
        },
        select: workoutDetailSelect,
      });

      if (shouldPlan) {
        const block = blockInstants(body.date, nextStartMinutes!, source.minutes!);
        await tx.timeBlock.create({
          data: {
            userId: user.id,
            title: source.name,
            date: block.date,
            startAt: block.startAt,
            endAt: block.endAt,
            color: WORKOUT_BLOCK_COLOR,
            source: "MANUAL",
            workoutId: copy.id,
          },
        });
      }

      return copy;
    });

    return serialiseWorkout(created);
  },
});
