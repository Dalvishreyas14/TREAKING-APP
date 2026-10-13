import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { loadNewPlan } from "@/lib/weekly-plans/server";

/**
 * PATCH / DELETE /api/v1/weekly-plans/:id/tasks/:taskId
 *
 * DELETE removes the join row only — the task itself survives, exactly as
 * `DELETE /api/v1/projects/:id/tasks/:linkId` does for a project. The task is
 * still on the user's task list and reachable from /tasks; the plan was only
 * asserting that it was intended for that week.
 *
 * PATCH moves the task between days within the plan. It edits the *link* and not
 * the task, because the day is this plan's claim about the work rather than a
 * property of the work: "Revise chapter 4 on Tuesday" is true of one plan's week
 * and false of another's, and writing it onto `Task` would make the first plan
 * silently rewrite the second. That is the same reason `dayOfWeek` is nullable on
 * the join — a task can belong to a week without being pinned to a day, and null
 * is how that state is represented rather than a gap to be backfilled.
 *
 * The path addresses the *task* id rather than a link id because the join is keyed
 * on `[weeklyPlanId, taskId]` and has no surrogate key of its own.
 */

const params = z.object({ id: z.string().min(1), taskId: z.string().min(1) });

const moveBody = z.object({
  /** null unschedules the task rather than leaving its previous day in place. */
  dayOfWeek: z.number().int().min(0).max(6).nullable(),
});

/**
 * Resolve the link and confirm the caller owns the plan it sits on.
 *
 * Both halves are checked together: the link must exist, belong to this plan, and
 * sit under a plan the caller owns. A link found by task id alone would let anyone
 * read or rewrite another account's weekly structure. Shared by both verbs so
 * DELETE and PATCH cannot drift apart on the ownership rule.
 */
async function ownedLink(userId: string, planId: string, taskId: string) {
  const link = await prisma.weeklyPlanTask.findUnique({
    where: { weeklyPlanId_taskId: { weeklyPlanId: planId, taskId } },
    select: { weeklyPlanId: true, dayOfWeek: true },
  });
  if (!link) {
    throw ApiError.notFound("That task is not in this plan.");
  }

  const plan = await prisma.weeklyPlan.findUnique({
    where: { id: link.weeklyPlanId },
    select: { userId: true },
  });
  if (!plan || plan.userId !== userId) {
    throw ApiError.notFound("That task is not in this plan.");
  }

  return link;
}

export const PATCH = withApi({
  method: "PATCH",
  params,
  body: moveBody,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const link = await ownedLink(user.id, params.id, params.taskId);

    await prisma.weeklyPlanTask.update({
      where: { weeklyPlanId_taskId: { weeklyPlanId: link.weeklyPlanId, taskId: params.taskId } },
      data: { dayOfWeek: body.dayOfWeek },
    });

    return loadNewPlan(user.id, link.weeklyPlanId);
  },
});

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const link = await ownedLink(user.id, params.id, params.taskId);

    await prisma.weeklyPlanTask.delete({
      where: { weeklyPlanId_taskId: { weeklyPlanId: link.weeklyPlanId, taskId: params.taskId } },
    });

    return {
      ...(await loadNewPlan(user.id, link.weeklyPlanId)),
      taskKept: true,
    };
  },
});