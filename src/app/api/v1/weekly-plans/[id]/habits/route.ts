import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { loadNewPlan } from "@/lib/weekly-plans/server";

/**
 * POST /api/v1/weekly-plans/:id/habits
 *
 * Attaching the habits a plan is measured against — the "Gym" habit for a fitness
 * week, the "Reading" habit for a study plan. This is how a weekly plan connects
 * to the existing Fitness and Study surfaces, which are lenses over habits rather
 * than tables of their own.
 *
 * It is also how a `SESSIONS` target has anything to count, and which table that
 * target reads depends on the plan's category: a FITNESS plan counts this habit's
 * completed logs, while a STUDY plan counts finished focus sessions on its tasks and
 * ignores these links entirely. There is no `WorkoutSession` or `StudySession` row
 * in this schema and there should not be — `fitness/page.tsx` and `study/page.tsx`
 * already derive their numbers from `HabitLog` and `FocusSession` respectively, and a
 * plan pointed at the same habit reads the same logs rather than keeping a parallel
 * tally that could drift.
 *
 * Any owned habit may be linked to any plan. The link is a claim, not a type check:
 * a plan pointed at "Gym" counts that habit's logs, and the API does not second-guess
 * whether that is the sort of work the plan's category implies. `SESSIONS` is
 * refused at the plan level for categories with no measurement behind them, which is
 * the constraint that actually protects the number.
 *
 * Detaching removes the join row only. The habit and all its history survive.
 */

const params = z.object({ id: z.string().min(1) });

const linkBody = z.object({
  habitId: z.string().min(1, "Pick a habit"),
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

    const habit = await prisma.habit.findFirst({
      where: { id: body.habitId, userId: user.id },
      select: { id: true },
    });
    if (!habit) {
      throw ApiError.notFound("That habit no longer exists.");
    }

    const existing = await prisma.weeklyPlanHabit.findUnique({
      where: { weeklyPlanId_habitId: { weeklyPlanId: plan!.id, habitId: habit.id } },
      select: { weeklyPlanId: true },
    });
    if (existing) {
      throw ApiError.conflict("That habit is already in this plan.");
    }

    await prisma.weeklyPlanHabit.create({
      data: { weeklyPlanId: plan!.id, habitId: habit.id },
    });

    return loadNewPlan(user.id, plan!.id);
  },
});