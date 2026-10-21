import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import {
  assertNoConflict,
  blockInstants,
  dateOnlyToIsoDay,
} from "@/lib/planner/server";
import {
  assertWorkoutLinks,
  exerciseTreeCreateData,
  logWorkoutHabit,
  resolveWorkoutTiming,
  serialiseWorkout,
  startMinutesOf,
  WORKOUT_BLOCK_COLOR,
  workoutDetailSelect,
} from "@/lib/fitness/server";
import { workoutUpdateSchema } from "@/lib/validation/schemas";
import type { Prisma } from "@/generated/prisma/client";

/**
 * GET / PATCH / DELETE /api/v1/workouts/:id
 *
 * The planner link is maintained here. While a workout is PLANNED and has a
 * time, it owns a `TimeBlock`; the block is created, moved and retitled to match
 * the workout, and removed the moment the workout stops being a plan (completed
 * or switched back to a logged session). A block is a plan, not a record — the
 * completed workout's own `startAt` is what remembers when it happened, so
 * leaving a block behind would be a stale plan sitting in the planner.
 */

const params = z.object({ id: z.string().min(1) });

async function loadOwned(userId: string, id: string) {
  const workout = await prisma.workout.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      name: true,
      date: true,
      startAt: true,
      minutes: true,
      status: true,
      completedAt: true,
      startedAt: true,
      habitId: true,
      muscleGroups: true,
    },
  });
  assertOwnership(workout, userId, "That workout no longer exists.");
  return workout!;
}

export const GET = withApi({
  method: "GET",
  params,
  async handler({ user, params }) {
    await loadOwned(user.id, params.id);
    const workout = await prisma.workout.findUnique({
      where: { id: params.id },
      select: workoutDetailSelect,
    });
    return serialiseWorkout(workout!);
  },
});

export const PATCH = withApi({
  method: "PATCH",
  params,
  body: workoutUpdateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const existing = await loadOwned(user.id, params.id);

    // Resolve the whole next state before writing, so the workout row and the
    // planner block it drives are derived from one set of merged values.
    const nextName = body.name ?? existing.name;
    const nextIsoDate = body.date ?? dateOnlyToIsoDay(existing.date);
    const nextStartMinutes =
      body.startMinutes !== undefined ? body.startMinutes : startMinutesOf(existing.startAt);
    const nextMinutes = body.minutes !== undefined ? body.minutes : existing.minutes;
    const nextStatus = body.status ?? existing.status;
    const nextHabitId = body.habitId !== undefined ? body.habitId : existing.habitId;

    const { date, startAt } = resolveWorkoutTiming(nextIsoDate, nextStartMinutes);

    if (
      body.categoryId !== undefined ||
      body.goalId !== undefined ||
      body.habitId !== undefined
    ) {
      await assertWorkoutLinks(user.id, body.categoryId, body.goalId, nextHabitId);
    }

    const shouldPlan =
      nextStatus === "PLANNED" && nextStartMinutes !== null && nextMinutes !== null;
    const timingChanged =
      body.date !== undefined || body.startMinutes !== undefined || body.minutes !== undefined;

    const linkedBlock = await prisma.timeBlock.findFirst({
      where: { workoutId: existing.id },
      select: { id: true },
    });

    // Only re-check conflicts when the schedule actually moved; editing the
    // notes on an already-overlapping plan must not fail on a clash it did not
    // create.
    if (shouldPlan && timingChanged) {
      await assertNoConflict(
        user.id,
        nextIsoDate,
        nextStartMinutes!,
        nextMinutes!,
        linkedBlock?.id,
      );
    }

    const now = new Date();
    const updateData: Prisma.WorkoutUpdateInput = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.minutes !== undefined ? { minutes: body.minutes ?? null } : {}),
      ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
      ...(body.muscleGroups !== undefined ? { muscleGroups: body.muscleGroups } : {}),
      ...(body.categoryId !== undefined ? { categoryId: body.categoryId ?? null } : {}),
      ...(body.goalId !== undefined ? { goalId: body.goalId ?? null } : {}),
      ...(body.habitId !== undefined ? { habitId: body.habitId ?? null } : {}),
      ...(body.status !== undefined
        ? {
            status: body.status,
            completedAt: body.status === "COMPLETED" ? (existing.completedAt ?? now) : null,
            startedAt:
              body.status === "IN_PROGRESS"
                ? (existing.startedAt ?? now)
                : body.status === "COMPLETED"
                  ? existing.startedAt
                  : null,
          }
        : {}),
      date,
      startAt,
    };

    await prisma.$transaction(async (tx) => {
      await tx.workout.update({ where: { id: existing.id }, data: updateData });

      if (body.exercises !== undefined) {
        await tx.workoutExercise.deleteMany({ where: { workoutId: existing.id } });
        for (const exercise of exerciseTreeCreateData(body.exercises)) {
          await tx.workoutExercise.create({
            data: { ...exercise, workoutId: existing.id },
          });
        }
      }

      // Keep the linked habit in step with the session's state: completing logs
      // it (once), and any other state removes an auto-log this workout wrote —
      // never a log the user wrote by hand, which carries no `workoutId`.
      if (nextStatus === "COMPLETED") {
        await logWorkoutHabit(tx, {
          id: existing.id,
          userId: user.id,
          habitId: nextHabitId,
          date,
          minutes: nextMinutes,
        });
      } else {
        await tx.habitLog.deleteMany({ where: { workoutId: existing.id } });
      }

      if (shouldPlan) {
        const block = blockInstants(nextIsoDate, nextStartMinutes!, nextMinutes!);
        if (linkedBlock) {
          await tx.timeBlock.update({
            where: { id: linkedBlock.id },
            data: {
              title: nextName,
              date: block.date,
              startAt: block.startAt,
              endAt: block.endAt,
            },
          });
        } else {
          await tx.timeBlock.create({
            data: {
              userId: user.id,
              title: nextName,
              date: block.date,
              startAt: block.startAt,
              endAt: block.endAt,
              color: WORKOUT_BLOCK_COLOR,
              source: "MANUAL",
              workoutId: existing.id,
            },
          });
        }
      } else if (linkedBlock) {
        await tx.timeBlock.delete({ where: { id: linkedBlock.id } });
      }
    });

    const workout = await prisma.workout.findUnique({
      where: { id: existing.id },
      select: workoutDetailSelect,
    });
    return serialiseWorkout(workout!);
  },
});

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const existing = await loadOwned(user.id, params.id);
    // Cascades remove the exercise tree, its sets, and any planner block that
    // was scheduled from this workout.
    await prisma.workout.delete({ where: { id: existing.id } });
    return { deleted: true, id: existing.id };
  },
});
