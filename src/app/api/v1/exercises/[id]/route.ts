import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { exerciseUpdateSchema } from "@/lib/validation/schemas";

/**
 * PATCH /api/v1/exercises/:id   DELETE /api/v1/exercises/:id
 *
 * Only user-owned exercises can be changed. The seeded system library is shared
 * by every user, so editing it would silently rewrite the list for everyone;
 * a user who wants a variant copies the name into their own library instead.
 *
 * Deleting detaches rather than cascades: `WorkoutExercise.exerciseId` is
 * `onDelete: SetNull` and each row keeps a `name` snapshot, so history survives
 * the library entry it came from.
 */

const params = z.object({ id: z.string().min(1) });

async function loadOwned(userId: string, id: string) {
  const exercise = await prisma.exercise.findUnique({
    where: { id },
    select: { id: true, userId: true, isSystem: true },
  });
  if (!exercise) throw ApiError.notFound("That exercise no longer exists.");
  if (exercise.isSystem) {
    throw ApiError.forbidden("Built-in exercises cannot be edited.");
  }
  if (exercise.userId !== userId) {
    throw ApiError.notFound("That exercise no longer exists.");
  }
  return exercise;
}

export const PATCH = withApi({
  method: "PATCH",
  params,
  body: exerciseUpdateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const existing = await loadOwned(user.id, params.id);

    if (body.name !== undefined) {
      const clash = await prisma.exercise.findFirst({
        where: {
          userId: user.id,
          name: { equals: body.name, mode: "insensitive" as const },
          NOT: { id: existing.id },
        },
        select: { id: true },
      });
      if (clash) {
        throw ApiError.conflict("You already have an exercise with that name.");
      }
    }

    return prisma.exercise.update({
      where: { id: existing.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.muscleGroup !== undefined ? { muscleGroup: body.muscleGroup } : {}),
        ...(body.equipment !== undefined ? { equipment: body.equipment ?? null } : {}),
        ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
      },
      select: {
        id: true,
        name: true,
        muscleGroup: true,
        equipment: true,
        notes: true,
        isSystem: true,
      },
    });
  },
});

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const existing = await loadOwned(user.id, params.id);
    await prisma.exercise.delete({ where: { id: existing.id } });
    return { deleted: true, id: existing.id };
  },
});
