import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { todayUtc, dateOnly } from "@/lib/date";
import { LIMITS } from "@/lib/rate-limit";
import { habitLogSchema } from "@/lib/validation/schemas";

/**
 * POST /api/v1/habits/:id/log
 *
 * The single most frequent write in the product, so it is an upsert against the
 * `(habitId, date)` unique index rather than a create: tapping a habit three
 * times in a row must land on one row, not three.
 *
 * Completion is derived here rather than trusted from the request. A BOOLEAN
 * habit is done at any value above zero; a COUNT habit is done when the value
 * reaches its target. Letting the client send `completed: true` for a habit at
 * 0 of 30 would corrupt every streak and completion figure downstream.
 */

const params = z.object({ id: z.string().min(1) });

export const POST = withApi({
  method: "POST",
  params,
  body: habitLogSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const habit = await prisma.habit.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true, type: true, targetValue: true, isActive: true },
    });
    assertOwnership(habit, user.id, "That habit no longer exists.");

    if (!habit!.isActive) {
      throw ApiError.conflict("That habit is archived. Restore it before logging.");
    }

    /**
     * `HabitLog.date` is a `@db.Date` column, so it has to be pinned to UTC
     * midnight or the row lands on the wrong calendar day for most of the world.
     * A caller sending a full timestamp still means "that day", so the time of
     * day is discarded rather than the request being rejected.
     *
     * Backfilling yesterday is legitimate — it is how you log a walk you already
     * took. Logging into the future is not, because it would inflate a streak
     * before the day has happened.
     */
    const date = dateOnly(body.date);
    const today = todayUtc();
    if (date.getTime() > today.getTime()) {
      throw ApiError.validation("You cannot log a habit for a future day.", {
        date: "Pick today or an earlier day.",
      });
    }

    const isBoolean = habit!.type === "BOOLEAN";
    const value = isBoolean ? (body.value > 0 ? 1 : 0) : body.value;
    const target = habit!.targetValue > 0 ? habit!.targetValue : 1;
    const completed = isBoolean ? value > 0 : value >= target;

    const log = await prisma.habitLog.upsert({
      where: { habitId_date: { habitId: habit!.id, date } },
      create: {
        userId: user.id,
        habitId: habit!.id,
        date,
        value,
        completed,
        note: body.note ?? null,
      },
      update: {
        value,
        completed,
        ...(body.note !== undefined ? { note: body.note ?? null } : {}),
      },
      select: { id: true, habitId: true, date: true, value: true, completed: true },
    });

    return log;
  },
});
