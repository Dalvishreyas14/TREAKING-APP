import { withApi } from "@/lib/api/with-api";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import {
  assertLinkOwnership,
  assertNoConflict,
  blockInstants,
  isoDayToDateOnly,
  serialiseBlock,
} from "@/lib/planner/server";
import {
  timeBlockCreateSchema,
  timeBlockListQuerySchema,
} from "@/lib/validation/schemas";

/**
 * GET /api/v1/time-blocks
 *
 * Returns blocks for a day, or an inclusive range when `to` is given. The day is
 * a `yyyy-MM-dd` string rather than a coerced `Date` for the reasons in
 * `timeBlockCreateSchema` — a nonexistent day must be rejected, not shifted.
 *
 * Blocks are fetched by the `date` column rather than by scanning `startAt`
 * between two instants, which is what the `@@index([userId, date])` on the model
 * is for. A range scan over `startAt` would also be wrong at the edges: a block
 * at 2am IST starts on the previous UTC day, so an instant-range query
 * systematically loses the first and last few hours of the day.
 */
export const GET = withApi({
  method: "GET",
  query: timeBlockListQuerySchema,
  async handler({ user, query }) {
    const from = isoDayToDateOnly(query.from);
    const to = query.to ? isoDayToDateOnly(query.to) : from;

    const blocks = await prisma.timeBlock.findMany({
      where: { userId: user.id, date: { gte: from, lte: to } },
      orderBy: { startAt: "asc" },
      select: {
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
      },
    });

    return { from: query.from, to: query.to ?? query.from, items: blocks.map(serialiseBlock) };
  },
});

/**
 * POST /api/v1/time-blocks
 *
 * Conflict checking and the link-ownership check both run before the write. They
 * are two small indexed reads against one day, and doing them first means a
 * rejected block leaves nothing behind — a partially-applied schedule is worse
 * than a clear rejection, because the user cannot tell which half happened.
 */
export const POST = withApi({
  method: "POST",
  body: timeBlockCreateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, body }) {
    await assertLinkOwnership(user.id, body.taskId, body.habitId);
    await assertNoConflict(user.id, body.date, body.startMinutes, body.durationMinutes);

    const { date, startAt, endAt } = blockInstants(
      body.date,
      body.startMinutes,
      body.durationMinutes,
    );

    const block = await prisma.timeBlock.create({
      data: {
        userId: user.id,
        title: body.title,
        date,
        startAt,
        endAt,
        color: body.color,
        notes: body.notes ?? null,
        locked: body.locked,
        taskId: body.taskId ?? null,
        habitId: body.habitId ?? null,
        // User-created blocks are MANUAL by definition. AI and ROUTINE are
        // written by the systems that generate them, and letting a client claim
        // one of those would make an unscheduled block indistinguishable from a
        // committed one downstream.
        source: "MANUAL",
      },
      select: {
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
      },
    });

    return serialiseBlock(block);
  },
});
