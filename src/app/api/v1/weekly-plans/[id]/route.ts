import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { SESSION_CATEGORIES, weeklyPlanUpdateSchema } from "@/lib/validation/schemas";
import {
  assertPlanParentOwnership,
  loadNewPlan,
  loadPlan,
  planDayOnly,
} from "@/lib/weekly-plans/server";

/**
 * GET / PATCH / DELETE /api/v1/weekly-plans/:id
 *
 * Deleting a plan removes only its join rows. The tasks and habits it pointed at
 * belong to the user and are still reachable from /tasks and /habits, so a plan
 * is a *claim about a week*, not an owner of work. This mirrors the rule in
 * `projects/[id]/route.ts`, and for the same reason: a weekly plan deleted on
 * Sunday evening must not take Monday's coursework with it.
 *
 * The response reports how many links went away so the client can confirm it,
 * rather than deleting silently and leaving the user unsure whether their tasks
 * survived.
 */

const params = z.object({ id: z.string().min(1) });

/**
 * Confirm the plan exists and is the caller's before doing anything.
 *
 * Loaded by id rather than scoped in a WHERE clause because every route here
 * mutates by primary key, and `assertOwnership` returning 404 for both
 * "does not exist" and "not yours" is what stops this endpoint confirming that
 * another user's plan id is real.
 */
async function findOwnedPlan(userId: string, planId: string) {
  const plan = await prisma.weeklyPlan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      userId: true,
      targetType: true,
      category: true,
      startDate: true,
      endDate: true,
      _count: { select: { tasks: true, habits: true, days: true } },
    },
  });
  assertOwnership(plan, userId, "That weekly plan no longer exists.");
  return plan!;
}

export const GET = withApi({
  method: "GET",
  params,
  async handler({ user, params }) {
    return loadPlan(user.id, params.id);
  },
});

export const PATCH = withApi({
  method: "PATCH",
  params,
  body: weeklyPlanUpdateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const existing = await findOwnedPlan(user.id, params.id);

    // Both dates are checked together because a partial update can make an
    // already-valid window invalid: changing only `startDate` to a later day would
    // otherwise leave `endDate` behind it and produce a plan that ends before it
    // begins.
    const startDate = body.startDate ? planDayOnly(body.startDate) : existing.startDate;
    const endDate = body.endDate ? planDayOnly(body.endDate) : existing.endDate;
    if (endDate.getTime() < startDate.getTime()) {
      throw ApiError.validation("A plan cannot end before it starts.", {
        endDate: "Pick an end date on or after the start date",
      });
    }

    await assertPlanParentOwnership(user.id, body.goalId, body.projectId);

    const nextTargetType = body.targetType ?? existing.targetType;
    const nextCategory = body.category ?? existing.category;

    // Re-checked against the *effective* pair, not this request's fields alone. The
    // schema can only compare what was sent, so a PATCH that switches a plan to
    // SESSIONS without mentioning its category would slip past it — and a work plan
    // measured in sessions reads as a permanent zero with no way to tell why.
    // Resolving against the stored row catches both single-field routes as well.
    if (
      nextTargetType === "SESSIONS" &&
      !(SESSION_CATEGORIES as readonly string[]).includes(nextCategory)
    ) {
      throw ApiError.validation("Sessions can only be counted for a study or fitness plan.", {
        targetType: "Change the category, or pick a target this app can measure",
      });
    }

    await prisma.$transaction(async (tx) => {
      if (body.days !== undefined) {
        // Replaced wholesale rather than diffed. The schema's unique key is
        // [weeklyPlanId, dayOfWeek], so an upsert per day would leave a day the user
        // just removed still sitting in the table — and "Wednesday: rest" would
        // survive the user deleting it.
        await tx.weeklyPlanDay.deleteMany({ where: { weeklyPlanId: existing.id } });
        if (body.days.length) {
          await tx.weeklyPlanDay.createMany({
            data: body.days.map((day) => ({
              weeklyPlanId: existing.id,
              dayOfWeek: day.dayOfWeek,
              note: day.note ?? null,
            })),
          });
        }
      }

      await tx.weeklyPlan.update({
        where: { id: existing.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.category !== undefined ? { category: body.category } : {}),
          ...(body.targetType !== undefined ? { targetType: body.targetType } : {}),
          ...(body.targetValue !== undefined ? { targetValue: body.targetValue } : {}),
          // `manualActual` is only meaningful for a COUNT plan, so it is cleared
          // whenever the target type moves away from COUNT. Otherwise switching a
          // plan from COUNT to HOURS and back again would resurface a count the user
          // typed months ago as though it were current.
          ...(body.manualActual !== undefined
            ? { manualActual: body.manualActual }
            : nextTargetType !== "COUNT"
              ? { manualActual: null }
              : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.startDate !== undefined ? { startDate } : {}),
          ...(body.endDate !== undefined ? { endDate } : {}),
          ...(body.goalId !== undefined ? { goalId: body.goalId } : {}),
          ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
        },
        select: { id: true },
      });
    });

    return loadNewPlan(user.id, existing.id);
  },
});

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const existing = await findOwnedPlan(user.id, params.id);

    await prisma.weeklyPlan.delete({ where: { id: existing.id } });

    // The count is reported, not returned silently: the user is about to lose the
    // view of N tasks and M habits from this plan, and they are still on their task
    // list. Saying so is the difference between "my tasks vanished" and "the plan
    // did".
    return {
      id: existing.id,
      deleted: true,
      unlinkedTasks: existing._count.tasks,
      unlinkedHabits: existing._count.habits,
    };
  },
});