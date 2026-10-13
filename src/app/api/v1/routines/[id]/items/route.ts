import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { routineItemCreateSchema } from "@/lib/validation/schemas";

/**
 * POST /api/v1/routines/:id/items
 *
 * Steps are appended here; editing, reordering and removing a step live under
 * `/items/:itemId`. Splitting them is not a style choice — Next.js only supplies
 * the params the URL contains, so a collection route cannot read an item id at
 * all, and a handler that tried would fail its params schema on every call.
 *
 * `RoutineItem` has no `userId`, so the parent routine is what proves ownership.
 */

const params = z.object({ id: z.string().min(1) });

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

export const POST = withApi({
  method: "POST",
  params,
  body: routineItemCreateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const routine = await prisma.routine.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true },
    });
    assertOwnership(routine, user.id);

    const last = await prisma.routineItem.findFirst({
      where: { routineId: routine!.id },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const item = await prisma.routineItem.create({
      data: {
        routineId: routine!.id,
        title: body.title,
        estimatedMinutes: body.estimatedMinutes ?? null,
        categoryId: body.categoryId ?? null,
        habitId: body.habitId ?? null,
        createsTask: body.createsTask,
        // Ordering is a server concern. Accepting it from the client would let a
        // client insert a step in the middle of a sequence it can only see by
        // accident, and two steps would then share an order.
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
      select: itemSelect,
    });

    return item;
  },
});
