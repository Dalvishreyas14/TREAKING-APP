import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";

/**
 * PATCH /api/v1/goals/:id/milestones/:milestoneId
 * DELETE /api/v1/goals/:id/milestones/:milestoneId
 *
 * Status drives progress here for the same reason it does in the parent PATCH:
 * the two are a pair, and the UI only ever edits `status`.
 */

const params = z.object({ id: z.string().min(1), milestoneId: z.string().min(1) });

const body = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  detail: z.string().trim().max(2000).nullable().optional(),
  targetDate: z.coerce.date().nullable().optional(),
  status: z.enum(["PENDING", "IN_PROGRESS", "DONE", "BLOCKED"]).optional(),
  progress: z.coerce.number().min(0).max(100).optional(),
});

async function loadMilestone(milestoneId: string, goalId: string, userId: string) {
  const milestone = await prisma.goalMilestone.findUnique({
    where: { id: milestoneId },
    select: {
      id: true,
      goalId: true,
      status: true,
      goal: { select: { userId: true } },
    },
  });

  if (!milestone || milestone.goalId !== goalId || milestone.goal.userId !== userId) {
    throw ApiError.notFound("Milestone not found");
  }
  return milestone;
}

export const PATCH = withApi({
  method: "PATCH",
  params,
  body,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const existing = await loadMilestone(params.milestoneId, params.id, user.id);

    const nextStatus = body.status ?? existing.status;
    const nextProgress = body.progress ?? (nextStatus === "DONE" ? 100 : 0);

    const milestone = await prisma.goalMilestone.update({
      where: { id: existing.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.detail !== undefined ? { detail: body.detail } : {}),
        ...(body.targetDate !== undefined ? { targetDate: body.targetDate } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        progress: nextStatus === "DONE" ? 100 : nextProgress,
        completedAt: nextStatus === "DONE" ? new Date() : null,
      },
      include: { _count: { select: { tasks: true } } },
    });

    return milestone;
  },
});

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const existing = await loadMilestone(params.milestoneId, params.id, user.id);
    await prisma.goalMilestone.delete({ where: { id: existing.id } });
    return { id: existing.id, deleted: true };
  },
});
