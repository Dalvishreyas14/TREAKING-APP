import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import {
  exerciseCreateSchema,
  exerciseListQuerySchema,
} from "@/lib/validation/schemas";

/**
 * GET /api/v1/exercises   POST /api/v1/exercises
 *
 * The exercise library. Reads return the shared system exercises plus whatever
 * the user has added, in one list, because to the person picking an exercise
 * there is no difference between the two — the `isSystem` flag only exists so
 * the UI can mark the seeded ones as read-only.
 */

const exerciseSelect = {
  id: true,
  name: true,
  muscleGroup: true,
  equipment: true,
  notes: true,
  isSystem: true,
} as const;

export const GET = withApi({
  method: "GET",
  query: exerciseListQuerySchema,
  async handler({ user, query }) {
    const items = await prisma.exercise.findMany({
      where: {
        OR: [{ isSystem: true }, { userId: user.id }],
        ...(query.muscleGroup ? { muscleGroup: query.muscleGroup } : {}),
        ...(query.search
          ? { name: { contains: query.search, mode: "insensitive" as const } }
          : {}),
      },
      orderBy: [{ muscleGroup: "asc" }, { name: "asc" }],
      select: exerciseSelect,
    });

    return { items };
  },
});

export const POST = withApi({
  method: "POST",
  body: exerciseCreateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, body }) {
    // A case-insensitive pre-check so "Bench press" and "Bench Press" are
    // treated as the same exercise to the user. The database's unique index is
    // exact-match and remains the real guard against a concurrent duplicate.
    const existing = await prisma.exercise.findFirst({
      where: {
        userId: user.id,
        name: { equals: body.name, mode: "insensitive" as const },
      },
      select: { id: true },
    });
    if (existing) {
      throw ApiError.conflict("You already have an exercise with that name.");
    }

    return prisma.exercise.create({
      data: {
        userId: user.id,
        isSystem: false,
        name: body.name,
        muscleGroup: body.muscleGroup,
        equipment: body.equipment ?? null,
        notes: body.notes ?? null,
      },
      select: exerciseSelect,
    });
  },
});
