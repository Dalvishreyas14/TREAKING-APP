import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { goalMilestoneCreateSchema } from "@/lib/validation/schemas";

/**
 * POST /api/v1/goals/:id/milestones
 *
 * `completedAt` and `progress` are derived from `status` on the way in, so a
 * milestone can't be DONE with 0% or carry a completion timestamp while still
 * PENDING. `GoalMilestone` has no `userId`, so ownership is checked through the
 * parent goal rather than the milestone row.
 */

const params = z.object({ id: z.string().min(1) });

const milestoneSelect = {
  id: true,
  goalId: true,
  title: true,
  detail: true,
  targetDate: true,
  status: true,
  progress: true,
  sortOrder: true,
  completedAt: true,
  _count: { select: { tasks: true } },
} as const;

export const POST = withApi({
  method: "POST",
  params,
  body: goalMilestoneCreateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const goal = await prisma.goal.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true },
    });
    assertOwnership(goal, user.id);

    const last = await prisma.goalMilestone.findFirst({
      where: { goalId: goal!.id },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const milestone = await prisma.goalMilestone.create({
      data: {
        goalId: goal!.id,
        title: body.title,
        detail: body.detail ?? null,
        targetDate: body.targetDate ?? null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
      select: milestoneSelect,
    });

    return milestone;
  },
});
