import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { isoDayToDateOnly } from "@/lib/planner/server";
import {
  conflictWarning,
  findSessionConflict,
  getUserTimezone,
  serialiseSession,
  studySessionSelect,
  syncStudyReminder,
} from "@/lib/study/server";
import {
  resolveStudyDuration,
  studySessionRescheduleSchema,
} from "@/lib/validation/schemas";

/**
 * POST /api/v1/study-sessions/:id/reschedule
 *
 * Move a planned session to a different day.
 *
 * Deliberately not the same as editing `date` on the session. A plain edit
 * moves the row, and the week then shows the session on its new day with no
 * trace of the old one - the slot looks as though it was never booked. A
 * reschedule closes the original slot as RESCHEDULED and creates a fresh
 * PLANNED copy, so the week can say "moved here from Tuesday" and the history
 * keeps the fact that the original slot was given up.
 *
 * Only a PLANNED or IN_PROGRESS session can be moved. A completed one is a
 * record, and rewriting where it happened would be falsifying history.
 */

const params = z.object({ id: z.string().min(1) });

export const POST = withApi({
  method: "POST",
  params,
  body: studySessionRescheduleSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const existing = await prisma.studySession.findUnique({
      where: { id: params.id },
      select: studySessionSelect,
    });
    assertOwnership(existing, user.id, "That session no longer exists.");
    const source = existing!;

    if (source.status !== "PLANNED" && source.status !== "IN_PROGRESS") {
      throw ApiError.badRequest("Only a planned session can be rescheduled.");
    }

    const startMinutes = body.startMinutes ?? source.startMinutes;
    const resolved = resolveStudyDuration(
      startMinutes,
      body.durationMinutes,
      body.endMinutes,
    );
    if ("error" in resolved) {
      throw ApiError.validation(resolved.error, { [resolved.field]: resolved.error });
    }
    const durationMinutes = resolved.durationMinutes;
    const date = isoDayToDateOnly(body.date);

    // A moved occurrence of a series keeps pointing at the series, so the day
    // it was moved from stays occupied by the original. If the series already
    // has a session on the new day there is nowhere for the copy to go.
    if (source.seriesId) {
      const clash = await prisma.studySession.findFirst({
        where: { seriesId: source.seriesId, date, id: { not: source.id } },
        select: { id: true },
      });
      if (clash) {
        throw ApiError.conflict("That day already has a session in this schedule.");
      }
    }

    const conflict = await findSessionConflict(
      user.id,
      body.date,
      startMinutes,
      durationMinutes,
      source.id,
    );
    const warning = conflictWarning(conflict);

    const timezone = await getUserTimezone(user.id);

    const copy = await prisma.$transaction(async (tx) => {
      await tx.studySession.update({
        where: { id: source.id },
        data: { status: "RESCHEDULED", completedAt: null, startedAt: null },
      });

      const created = await tx.studySession.create({
        data: {
          userId: user.id,
          seriesId: source.seriesId,
          title: source.title,
          subject: source.subject,
          notes: source.notes,
          color: source.color,
          date,
          startMinutes,
          durationMinutes,
          reminderLeadMinutes: source.reminderLeadMinutes,
          habitId: source.habitId,
          categoryId: source.categoryId,
          status: "PLANNED",
          // The copy is the user's own decision, so the series rule must not
          // rewrite it on the next edit.
          isException: true,
          rescheduledFromDate: source.date,
        },
        select: studySessionSelect,
      });

      await syncStudyReminder(tx, { id: user.id, timezone }, {
        targetId: created.id,
        title: `${created.title} starts soon`,
        body: `${created.subject} · ${body.date}`,
        isoDay: body.date,
        daysOfWeek: [],
        startMinutes: created.startMinutes,
        leadMinutes: created.reminderLeadMinutes,
        recurring: false,
      });

      return created;
    });

    return { session: serialiseSession(copy), warning };
  },
});
