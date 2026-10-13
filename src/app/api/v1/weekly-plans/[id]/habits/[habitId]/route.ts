import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { loadNewPlan } from "@/lib/weekly-plans/server";

/**
 * DELETE /api/v1/weekly-plans/:id/habits/:habitId
 *
 * Removes the join row only. The habit and every `HabitLog` it has ever recorded
 * stay exactly where they are — the same rule the tasks route follows, and for a
 * sharper reason here: those logs are the user's actual gym attendance and study
 * history, and detaching a habit from one week's plan must never take them.
 */

const params = z.object({ id: z.string().min(1), habitId: z.string().min(1) });

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const link = await prisma.weeklyPlanHabit.findUnique({
      where: { weeklyPlanId_habitId: { weeklyPlanId: params.id, habitId: params.habitId } },
      select: { weeklyPlanId: true },
    });

    if (!link) {
      throw ApiError.notFound("That habit is not in this plan.");
    }

    const plan = await prisma.weeklyPlan.findUnique({
      where: { id: link.weeklyPlanId },
      select: { userId: true },
    });
    if (!plan || plan.userId !== user.id) {
      throw ApiError.notFound("That habit is not in this plan.");
    }

    await prisma.weeklyPlanHabit.delete({
      where: { weeklyPlanId_habitId: { weeklyPlanId: link.weeklyPlanId, habitId: params.habitId } },
    });

    return {
      ...(await loadNewPlan(user.id, link.weeklyPlanId)),
      // Said out loud because the user has just removed the thing that was counting
      // their attendance. Without this, a fitness plan's session count silently
      // stops moving and looks like the app broke.
      habitKept: true,
    };
  },
});