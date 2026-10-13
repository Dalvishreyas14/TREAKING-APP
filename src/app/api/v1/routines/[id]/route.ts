import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { routineUpdateSchema } from "@/lib/validation/schemas";

/**
 * PATCH /api/v1/routines/:id    DELETE /api/v1/routines/:id
 *
 * Items are not edited through this route — they have their own endpoints under
 * `/items`, so adding a step never has to send the whole list back and risk
 * clobbering a concurrent edit.
 */

const params = z.object({ id: z.string().min(1) });

const routineInclude = {
  items: { orderBy: { sortOrder: "asc" as const } },
  runs: { orderBy: { startedAt: "desc" as const }, take: 14 },
  _count: { select: { runs: true, timeBlocks: true } },
} as const;

export const PATCH = withApi({
  method: "PATCH",
  params,
  body: routineUpdateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const existing = await prisma.routine.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true },
    });
    assertOwnership(existing, user.id);

    const routine = await prisma.routine.update({
      where: { id: existing!.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.timeOfDay !== undefined ? { timeOfDay: body.timeOfDay } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.icon !== undefined ? { icon: body.icon } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
      include: routineInclude,
    });

    return routine;
  },
});

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const existing = await prisma.routine.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true },
    });
    assertOwnership(existing, user.id);

    // Items and runs cascade. TimeBlocks are SetNull and survive as manual
    // blocks — a schedule the user already committed to shouldn't vanish
    // because the template that suggested it was deleted.
    await prisma.routine.delete({ where: { id: existing!.id } });

    return { id: existing!.id, deleted: true };
  },
});
