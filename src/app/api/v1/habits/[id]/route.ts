import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { habitUpdateSchema } from "@/lib/validation/schemas";

/**
 * PATCH /api/v1/habits/:id   DELETE /api/v1/habits/:id
 *
 * DELETE archives rather than deletes, always. A habit's logs are the raw
 * material behind every streak, completion rate and insight in the product, and
 * they are not reproducible once gone. Archiving hides the habit from the daily
 * list while keeping the history intact, so the numbers stay honest.
 */

const params = z.object({ id: z.string().min(1) });

async function loadOwned(userId: string, id: string) {
  const habit = await prisma.habit.findUnique({
    where: { id },
    select: { id: true, userId: true, isActive: true, archivedAt: true },
  });
  assertOwnership(habit, userId, "That habit no longer exists.");
  return habit!;
}

export const PATCH = withApi({
  method: "PATCH",
  params,
  body: habitUpdateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const existing = await loadOwned(user.id, params.id);

    const habit = await prisma.$transaction(async (tx) => {
      const updated = await tx.habit.update({
        where: { id: existing.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.icon !== undefined ? { icon: body.icon } : {}),
          ...(body.color !== undefined ? { color: body.color } : {}),
          ...(body.type !== undefined ? { type: body.type } : {}),
          ...(body.difficulty !== undefined ? { difficulty: body.difficulty } : {}),
          ...(body.frequency !== undefined ? { frequency: body.frequency } : {}),
          ...(body.unit !== undefined ? { unit: body.unit } : {}),
          ...(body.targetValue !== undefined ? { targetValue: body.targetValue } : {}),
          ...(body.targetMinutes !== undefined ? { targetMinutes: body.targetMinutes } : {}),
          ...(body.timesPerPeriod !== undefined ? { timesPerPeriod: body.timesPerPeriod } : {}),
          ...(body.preferredMinutes !== undefined
            ? { preferredMinutes: body.preferredMinutes }
            : {}),
          ...(body.reminderEnabled !== undefined
            ? { reminderEnabled: body.reminderEnabled }
            : {}),
          ...(body.reminderMinutes !== undefined
            ? { reminderMinutes: body.reminderMinutes }
            : {}),
          ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
          ...(body.goalId !== undefined ? { goalId: body.goalId } : {}),
          /*
           * `isActive` and `archivedAt` are always written together, so the two
           * columns can never disagree. Restoring also clears the timestamp:
           * "archived at" is a fact about the past, and leaving it set while the
           * habit is live would make the two contradict each other.
           */
          ...(body.archived === undefined
            ? {}
            : body.archived
              ? { isActive: false, archivedAt: new Date() }
              : { isActive: true, archivedAt: null }),
        },
        select: {
          id: true,
          name: true,
          color: true,
          type: true,
          targetValue: true,
          frequency: true,
          isActive: true,
          archivedAt: true,
          updatedAt: true,
        },
      });

      /**
       * The schedule is replaced rather than merged, because "these are the days
       * this habit runs on" is a statement about the whole set. A merge would
       * leave a day the user just removed in place forever.
       */
      if (body.daysOfWeek !== undefined) {
        await tx.habitSchedule.deleteMany({ where: { habitId: existing.id } });
        if (body.daysOfWeek.length > 0) {
          await tx.habitSchedule.createMany({
            data: body.daysOfWeek.map((dayOfWeek) => ({
              habitId: existing.id,
              dayOfWeek,
            })),
            skipDuplicates: true,
          });
        }
      }

      return updated;
    });

    return habit;
  },
});

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const existing = await loadOwned(user.id, params.id);

    // Already archived: treat as idempotent rather than erroring, so a double
    // tap on a mobile connection cannot surface an error to the user.
    if (existing.archivedAt) {
      return { archived: true, alreadyArchived: true, id: existing.id };
    }

    await prisma.habit.update({
      where: { id: existing.id },
      data: { archivedAt: new Date(), isActive: false },
    });

    return { archived: true, alreadyArchived: false, id: existing.id };
  },
});
