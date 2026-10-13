import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { routineItemCreateSchema } from "@/lib/validation/schemas";

/**
 * PATCH/DELETE /api/v1/routines/:id/items/:itemId
 *
 * One step of a routine. It lives under its own `[itemId]` segment rather than
 * sharing the collection route because Next.js only supplies the params the URL
 * actually contains: a handler here that declared `itemId` while sitting at
 * `/items` would be handed `undefined`, which the params schema rejects and the
 * error wrapper turns into a 500. The segment has to exist for the id to exist.
 *
 * `RoutineItem` has no `userId` of its own, so every write is authorised through
 * the parent routine. Ordering is stored, not derived: steps are a sequence, and
 * reordering them by title would be nonsense for a morning routine.
 */

const params = z.object({ id: z.string().min(1), itemId: z.string().min(1) });

const reorderBody = z.object({ direction: z.enum(["up", "down"]) });
const updateBody = routineItemCreateSchema.partial();

const itemSelect = {
  id: true,
  routineId: true,
  title: true,
  sortOrder: true,
  estimatedMinutes: true,
  categoryId: true,
  habitId: true,
  createsTask: true,
} as const;

async function loadItem(itemId: string, routineId: string, userId: string) {
  const item = await prisma.routineItem.findUnique({
    where: { id: itemId },
    select: { id: true, routineId: true, sortOrder: true, routine: { select: { userId: true } } },
  });
  if (!item || item.routineId !== routineId || item.routine.userId !== userId) {
    throw ApiError.notFound("Step not found");
  }
  return item;
}

export const PATCH = withApi({
  method: "PATCH",
  params,
  body: updateBody,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const existing = await loadItem(params.itemId, params.id, user.id);
    const item = await prisma.routineItem.update({
      where: { id: existing.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.estimatedMinutes !== undefined ? { estimatedMinutes: body.estimatedMinutes } : {}),
        ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
        ...(body.habitId !== undefined ? { habitId: body.habitId } : {}),
        ...(body.createsTask !== undefined ? { createsTask: body.createsTask } : {}),
      },
      select: itemSelect,
    });
    return item;
  },
});

/**
 * Reordering swaps `sortOrder` with the neighbour and then compacts the sequence
 * so gaps don't accumulate. Doing a plain `+1`/`-1` is cheaper but leaves holes,
 * and holes eventually produce two steps with the same order after enough
 * edits — at which point the list renders in an arbitrary order.
 */
async function move(routineId: string, itemId: string, userId: string, direction: "up" | "down") {
  const item = await loadItem(itemId, routineId, userId);
  const neighbour = await prisma.routineItem.findFirst({
    where: {
      routineId,
      ...(direction === "up" ? { sortOrder: { lt: item.sortOrder } } : { sortOrder: { gt: item.sortOrder } }),
    },
    orderBy: { sortOrder: direction === "up" ? "desc" : "asc" },
    select: { id: true, sortOrder: true },
  });

  if (!neighbour) return { moved: false };

  await prisma.$transaction([
    prisma.routineItem.update({ where: { id: item.id }, data: { sortOrder: neighbour.sortOrder } }),
    prisma.routineItem.update({ where: { id: neighbour.id }, data: { sortOrder: item.sortOrder } }),
  ]);

  const all = await prisma.routineItem.findMany({
    where: { routineId },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });

  await prisma.$transaction(
    all.map((row, index) =>
      prisma.routineItem.update({ where: { id: row.id }, data: { sortOrder: index } }),
    ),
  );

  return { moved: true };
}

/**
 * PUT rather than PATCH because this is not a partial update of the step — it is
 * a different verb entirely ("move this one place"), and overloading PATCH would
 * mean guessing which of the two the client meant from the body alone.
 *
 * The whole compacted list comes back because a swap moves two rows and a client
 * that only reconciled the one it asked about would render the list in the wrong
 * order until the next reload.
 */
export const PUT = withApi({
  method: "PUT",
  params,
  body: reorderBody,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const result = await move(params.id, params.itemId, user.id, body.direction);
    return { ...result, items: await prisma.routineItem.findMany({
      where: { routineId: params.id },
      orderBy: { sortOrder: "asc" },
      select: itemSelect,
    }) };
  },
});

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const existing = await loadItem(params.itemId, params.id, user.id);
    await prisma.routineItem.delete({ where: { id: existing.id } });
    return { id: existing.id, deleted: true };
  },
});
