import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { weeklyPlanCreateSchema } from "@/lib/validation/schemas";
import {
  assertPlanParentOwnership,
  loadNewPlan,
  loadPlansInRange,
  ownedHabitIds,
  ownedTaskIds,
  partitionOwned,
  planDayOnly,
} from "@/lib/weekly-plans/server";
import { weekBounds } from "@/lib/weekly-plans/week";

/**
 * GET /api/v1/weekly-plans?week=...    POST /api/v1/weekly-plans
 *
 * Listing is by week, not by "all plans". A user's plans are unbounded — someone
 * planning a year ahead has dozens — and a list that grows forever is a list that
 * stops being readable. The board asks for the week it is showing.
 *
 * `week` is a `yyyy-MM-dd` day inside the desired week rather than a week-start
 * anchor, so "show me the week containing the 14th" works without the client
 * having to know whether weeks start on Monday or Sunday. The server derives the
 * bounds using the user's own `weekStartsOn`.
 */

const listQuery = z.object({
  /** Any day inside the week of interest. Defaults to today. */
  week: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-09-27")
    .optional(),
});

/** Load the user's week convention. Defaults to Monday, as `User.weekStartsOn` does. */
async function weekStartsOnFor(userId: string): Promise<number> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { weekStartsOn: true },
  });
  return row?.weekStartsOn ?? 1;
}

export const GET = withApi({
  method: "GET",
  query: listQuery,
  async handler({ user, query }) {
    const weekStartsOn = await weekStartsOnFor(user.id);
    const anchor = query.week ? planDayOnly(query.week) : new Date();

    // Computed here rather than in the client because the answer depends on a
    // user preference the client has no business deciding. Two people whose weeks
    // start on different days get different windows from the same anchor.
    const bounds = weekBounds(anchor, weekStartsOn);
    const plans = await loadPlansInRange(user.id, bounds.start, bounds.end);

    return {
      week: {
        start: bounds.start.toISOString().slice(0, 10),
        end: bounds.end.toISOString().slice(0, 10),
        startsOn: weekStartsOn,
      },
      items: plans,
    };
  },
});

export const POST = withApi({
  method: "POST",
  body: weeklyPlanCreateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, body }) {
    await assertPlanParentOwnership(user.id, body.goalId, body.projectId);

    // Ownership of the linked work is checked in bulk before anything is written,
    // so the plan and its links are created in one transaction against ids already
    // known to be the user's.
    const [taskIds, habitIds] = await Promise.all([
      ownedTaskIds(user.id, body.taskIds ?? []),
      ownedHabitIds(user.id, body.habitIds ?? []),
    ]);

    const plan = await prisma.$transaction(async (tx) =>
      tx.weeklyPlan.create({
        data: {
          userId: user.id,
          name: body.name,
          description: body.description ?? null,
          category: body.category,
          targetType: body.targetType,
          targetValue: body.targetValue,
          startDate: planDayOnly(body.startDate),
          endDate: planDayOnly(body.endDate),
          goalId: body.goalId ?? null,
          projectId: body.projectId ?? null,
          days: body.days?.length ? { create: body.days } : undefined,
          tasks: taskIds.length
            ? { create: taskIds.map((taskId, index) => ({ taskId, sortOrder: index })) }
            : undefined,
          habits: habitIds.length
            ? { create: habitIds.map((habitId) => ({ habitId })) }
            : undefined,
        },
        select: { id: true },
      }),
    );

    // Re-read rather than assembled from the create payload, so the progress
    // figures on this response come from the same code path the page uses.
    const loaded = await loadNewPlan(user.id, plan.id);

    return {
      ...loaded,
      // Named rather than dropped. Ids the caller sent that are not the user's are
      // reported back so the UI can say which were skipped instead of silently
      // creating a plan with fewer tasks than the user asked for.
      rejectedTaskIds: partitionOwned(body.taskIds ?? [], taskIds).rejected,
      rejectedHabitIds: partitionOwned(body.habitIds ?? [], habitIds).rejected,
    };
  },
});