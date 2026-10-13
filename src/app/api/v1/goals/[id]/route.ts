import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { goalUpdateSchema } from "@/lib/validation/schemas";

/**
 * PATCH /api/v1/goals/:id    DELETE /api/v1/goals/:id
 *
 * The status/progress pairing is resolved here rather than in the client,
 * because it is an invariant of the data and not a UI nicety. `achievedAt` is
 * the field the dashboard's "recently achieved" list sorts on, so leaving it
 * stale would show a goal as won weeks after it was reopened.
 */

const params = z.object({ id: z.string().min(1) });

const goalInclude = {
  milestones: { orderBy: { sortOrder: "asc" as const } },
  checkIns: { orderBy: { createdAt: "desc" as const }, take: 5 },
  category: { select: { id: true, name: true, color: true, kind: true } },
  _count: { select: { tasks: true } },
} as const;

export const PATCH = withApi({
  method: "PATCH",
  params,
  body: goalUpdateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const existing = await prisma.goal.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true, status: true, progress: true },
    });
    assertOwnership(existing, user.id);

    const nextStatus = body.status ?? existing!.status;
    const nextProgress = body.progress ?? existing!.progress;

    // Achieved implies complete. Reopened (or un-achieved) implies a fresh
    // achievedAt, and a goal that is no longer achieved can't keep 100%.
    const progress =
      nextStatus === "ACHIEVED" ? 100 : nextStatus === "ACTIVE" ? Math.min(nextProgress, 99) : nextProgress;
    const achievedAt = nextStatus === "ACHIEVED" ? (existing!.status === "ACHIEVED" ? undefined : new Date()) : null;

    const goal = await prisma.goal.update({
      where: { id: existing!.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.horizon !== undefined ? { horizon: body.horizon } : {}),
        ...(body.icon !== undefined ? { icon: body.icon } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.startDate !== undefined ? { startDate: body.startDate } : {}),
        ...(body.targetDate !== undefined ? { targetDate: body.targetDate } : {}),
        ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        progress,
        ...(achievedAt === undefined ? {} : { achievedAt }),
      },
      include: goalInclude,
    });

    return goal;
  },
});

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const existing = await prisma.goal.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true },
    });
    assertOwnership(existing, user.id);

    // Milestones and check-ins cascade. Tasks are SetNull, so deleting a goal
    // never silently deletes work the user also tracks on its own.
    await prisma.goal.delete({ where: { id: existing!.id } });

    return { id: existing!.id, deleted: true };
  },
});
