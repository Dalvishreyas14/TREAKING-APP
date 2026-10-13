import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import {
  assertLinkOwnership,
  assertNoConflict,
  blockInstants,
  dateOnlyToIsoDay,
  serialiseBlock,
} from "@/lib/planner/server";
import { timeBlockUpdateSchema } from "@/lib/validation/schemas";

/**
 * PATCH /api/v1/time-blocks/:id    DELETE /api/v1/time-blocks/:id
 *
 * A PATCH is resolved against the block's *current* values rather than treated as
 * a partial write, because the conflict check needs a complete range. Sending
 * only `startMinutes` has to be checked against the duration the block already
 * has, and sending only `durationMinutes` against the time it already starts at.
 * Merging first and checking the merge is the only way that works.
 */

const params = z.object({ id: z.string().min(1) });

const blockSelect = {
  id: true,
  title: true,
  date: true,
  startAt: true,
  endAt: true,
  source: true,
  color: true,
  notes: true,
  locked: true,
  taskId: true,
  habitId: true,
  task: { select: { id: true, title: true, status: true } },
  habit: { select: { id: true, name: true, color: true } },
} as const;

async function loadOwned(userId: string, id: string) {
  const block = await prisma.timeBlock.findUnique({
    where: { id },
    select: { id: true, userId: true, date: true, startAt: true, endAt: true },
  });
  assertOwnership(block, userId, "That block no longer exists.");
  return block!;
}

export const PATCH = withApi({
  method: "PATCH",
  params,
  body: timeBlockUpdateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const existing = await loadOwned(user.id, params.id);

    /*
     * Resolve the target day and time. `date` is a `yyyy-MM-dd` string, so when
     * the patch omits it the existing column is converted back rather than read
     * as a wall clock — the two are the same day by construction, but asking the
     * existing row and re-deriving both keeps one source of truth for the merge.
     */
    const nextDay = body.date ?? dateOnlyToIsoDay(existing.date);
    const nextStart = body.startMinutes ?? existing.startAt.getHours() * 60 + existing.startAt.getMinutes();
    const nextDuration =
      body.durationMinutes ??
      Math.max(
        Math.round((existing.endAt.getTime() - existing.startAt.getTime()) / 60_000),
        5,
      );

    if (body.taskId !== undefined || body.habitId !== undefined) {
      await assertLinkOwnership(
        user.id,
        body.taskId === undefined ? null : body.taskId,
        body.habitId === undefined ? null : body.habitId,
      );
    }

    await assertNoConflict(user.id, nextDay, nextStart, nextDuration, existing.id);

    const { date, startAt, endAt } = blockInstants(nextDay, nextStart, nextDuration);

    const block = await prisma.timeBlock.update({
      where: { id: existing.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.locked !== undefined ? { locked: body.locked } : {}),
        ...(body.taskId !== undefined ? { taskId: body.taskId } : {}),
        ...(body.habitId !== undefined ? { habitId: body.habitId } : {}),
        // The derived trio is written together, never individually, so the `date`
        // column can never disagree with the instants it labels.
        date,
        startAt,
        endAt,
      },
      select: blockSelect,
    });

    return serialiseBlock(block);
  },
});

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const existing = await loadOwned(user.id, params.id);

    /*
     * Unlike a habit, a time block has no history worth preserving: it is a
     * plan, not a record of something that happened, and the day it occupied is
     * only meaningful while it is there. So this is a real delete, not an
     * archive — a planner full of tombstones would be unusable.
     *
     * Anything that *did* happen is recorded elsewhere: `FocusSession` holds the
     * actual minutes worked, and `HabitLog` the completions.
     */
    await prisma.timeBlock.delete({ where: { id: existing.id } });

    return { deleted: true, id: existing.id };
  },
});
