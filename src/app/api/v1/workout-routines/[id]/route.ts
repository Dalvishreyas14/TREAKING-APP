import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { todayUtc } from "@/lib/date";
import { LIMITS } from "@/lib/rate-limit";
import {
  routineDaysCreateData,
  routineDetailSelect,
  serialiseRoutine,
} from "@/lib/fitness/schedule";
import { workoutRoutineUpdateSchema } from "@/lib/validation/schemas";

/**
 * GET / PATCH / DELETE /api/v1/workout-routines/:id
 *
 * PATCH edits the *template*. It does not rewrite already-materialised sessions:
 * editing the routine and applying it are deliberately two steps, so a user can
 * tweak next month's plan without the change retroactively altering this week.
 * `days`, when sent, replaces the whole day set, matching how a workout's
 * exercise tree is updated.
 *
 * DELETE removes the routine and its future PLANNED sessions, but keeps every
 * session it already generated that is in the past or that the user acted on —
 * deleting a template must never delete training history.
 */

const params = z.object({ id: z.string().min(1) });

async function requireRoutine(userId: string, id: string) {
  const routine = await prisma.workoutRoutine.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!routine) throw ApiError.notFound("That routine no longer exists.");
  return routine;
}

export const GET = withApi({
  method: "GET",
  params,
  async handler({ user, params }) {
    await requireRoutine(user.id, params.id);
    const routine = await prisma.workoutRoutine.findUnique({
      where: { id: params.id },
      select: routineDetailSelect,
    });
    return serialiseRoutine(routine!);
  },
});

export const PATCH = withApi({
  method: "PATCH",
  params,
  body: workoutRoutineUpdateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const existing = await requireRoutine(user.id, params.id);

    await prisma.$transaction(async (tx) => {
      await tx.workoutRoutine.update({
        where: { id: existing.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description ?? null } : {}),
          ...(body.color !== undefined ? { color: body.color } : {}),
        },
      });

      if (body.days !== undefined) {
        await tx.workoutRoutineDay.deleteMany({ where: { routineId: existing.id } });
        for (const day of routineDaysCreateData(body.days)) {
          await tx.workoutRoutineDay.create({
            data: { ...day, routineId: existing.id },
          });
        }
      }
    });

    const routine = await prisma.workoutRoutine.findUnique({
      where: { id: existing.id },
      select: routineDetailSelect,
    });
    return serialiseRoutine(routine!);
  },
});

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const existing = await requireRoutine(user.id, params.id);
    const today = todayUtc();

    await prisma.$transaction(async (tx) => {
      await tx.workout.deleteMany({
        where: {
          userId: user.id,
          routineId: existing.id,
          status: "PLANNED",
          date: { gte: today },
        },
      });
      await tx.workoutRoutine.delete({ where: { id: existing.id } });
    });

    return { deleted: true, id: existing.id };
  },
});
