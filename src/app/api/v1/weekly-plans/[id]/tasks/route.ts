import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { loadNewPlan } from "@/lib/weekly-plans/server";

/**
 * POST /api/v1/weekly-plans/:id/tasks
 *
 * Attaching tasks to a plan. Detaching is `DELETE /api/v1/weekly-plans/:id/tasks/:taskId`.
 *
 * Unlike `ProjectTask` there is no surrogate link id to address here, because the
 * join is keyed on `[weeklyPlanId, taskId]` — so unlinking addresses the *task* id
 * directly. Same rule as the planner's `assertLinkOwnership`: without checking the
 * task belongs to the caller, a plan id and a task id from two accounts could be
 * joined, and the plan would then report hours focused on somebody else's task.
 *
 * Detaching removes the join row only. The task survives: a plan is a claim about a
 * week, not an owner of work, and removing "Revise chapter 4" from next week's plan
 * must not remove it from the user's task list.
 */

const params = z.object({ id: z.string().min(1) });

const linkBody = z.object({
  taskId: z.string().min(1, "Pick a task"),
  /**
   * Optional weekday to pin the task to on attach. Omitted or null leaves it
   * unscheduled rather than guessing a day.
   */
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
});

export const POST = withApi({
  method: "POST",
  params,
  body: linkBody,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const plan = await prisma.weeklyPlan.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true },
    });
    assertOwnership(plan, user.id, "That weekly plan no longer exists.");

    const task = await prisma.task.findFirst({
      where: { id: body.taskId, userId: user.id },
      select: { id: true },
    });
    if (!task) {
      throw ApiError.notFound("That task no longer exists.");
    }

    // The composite primary key makes a duplicate a constraint violation, and a raw
    // Prisma code is not something to show a person. Reported as a conflict, with a
    // message that says what to do instead.
    const existing = await prisma.weeklyPlanTask.findUnique({
      where: { weeklyPlanId_taskId: { weeklyPlanId: plan!.id, taskId: task.id } },
      select: { weeklyPlanId: true },
    });
    if (existing) {
      throw ApiError.conflict("That task is already in this plan.");
    }

    const last = await prisma.weeklyPlanTask.findFirst({
      where: { weeklyPlanId: plan!.id },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    await prisma.weeklyPlanTask.create({
      data: {
        weeklyPlanId: plan!.id,
        taskId: task.id,
        // Appended rather than renumbering the whole set. Insert-at-position is not a
        // thing this screen asks for, and rewriting every link's sortOrder to insert
        // one row would make an unrelated concurrent edit clobber the ordering.
        sortOrder: (last?.sortOrder ?? -1) + 1,
        dayOfWeek: body.dayOfWeek ?? null,
      },
    });

    // Returned through the same serialisation the board uses, so the card's task
    // count and its progress come from one place and cannot disagree with the list.
    return loadNewPlan(user.id, plan!.id);
  },
});