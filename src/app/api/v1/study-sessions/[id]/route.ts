import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { isoDayToDateOnly } from "@/lib/planner/server";
import {
  assertStudyLinkOwnership,
  conflictWarning,
  findSessionConflict,
  getUserTimezone,
  logStudyHabit,
  serialiseSession,
  studySessionSelect,
  syncStudyReminder,
} from "@/lib/study/server";
import { resolveStudyDuration, studySessionUpdateSchema } from "@/lib/validation/schemas";

/**
 * PATCH /api/v1/study-sessions/:id   DELETE /api/v1/study-sessions/:id
 *
 * Editing and deleting one occurrence of a schedule.
 *
 * Two rules make these safe:
 *
 *  - **Editing an occurrence of a series marks it an exception.** The series
 *    is the rule; an occurrence the user has edited on its own is no longer
 *    covered by that rule, and the next series-wide edit must leave it alone.
 *
 *  - **Deleting an occurrence of a series leaves a tombstone.** Without one the
 *    next generation pass would put the session straight back, and the user
 *    would be deleting the same Tuesday for ever.
 *
 * Moving a session to a different day is *not* here. That is a reschedule, and
 * it has its own endpoint, because a reschedule closes the old slot and opens
 * a new one rather than pretending the session was always there.
 */

const params = z.object({ id: z.string().min(1) });

export const PATCH = withApi({
  method: "PATCH",
  params,
  body: studySessionUpdateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const existing = await prisma.studySession.findUnique({
      where: { id: params.id },
      select: studySessionSelect,
    });
    assertOwnership(existing, user.id, "That session no longer exists.");
    const source = existing!;

    // The day is compared as an ISO string: `source.date` is a `@db.Date` and
    // `body.date` is a calendar day, and the two are the same day when their
    // ISO forms match.
    const sourceIsoDay = source.date.toISOString().slice(0, 10);
    if (body.date !== undefined && body.date !== sourceIsoDay && source.seriesId) {
      throw ApiError.badRequest(
        "This session belongs to a repeating schedule. Use reschedule to move it.",
      );
    }

    if (source.status === "COMPLETED" && body.status === undefined) {
      throw ApiError.badRequest(
        "A completed session is a record. Mark it as missed if it did not happen.",
      );
    }

    await assertStudyLinkOwnership(user.id, body.habitId, body.categoryId);

    const startMinutes = body.startMinutes ?? source.startMinutes;
    let durationMinutes = source.durationMinutes;
    if (body.durationMinutes !== undefined || body.endMinutes !== undefined) {
      const resolved = resolveStudyDuration(
        startMinutes,
        body.durationMinutes,
        body.endMinutes,
      );
      if ("error" in resolved) {
        throw ApiError.validation(resolved.error, { [resolved.field]: resolved.error });
      }
      durationMinutes = resolved.durationMinutes;
    }

    const date = body.date !== undefined ? isoDayToDateOnly(body.date) : source.date;
    const reminderLeadMinutes =
      body.reminderLeadMinutes !== undefined
        ? body.reminderLeadMinutes
        : source.reminderLeadMinutes;

    const conflict = await findSessionConflict(
      user.id,
      date.toISOString().slice(0, 10),
      startMinutes,
      durationMinutes,
      source.id,
    );
    const warning = conflictWarning(conflict);

    const status = body.status ?? source.status;
    const becomingComplete = status === "COMPLETED" && source.status !== "COMPLETED";

    const timezone = await getUserTimezone(user.id);

    const updated = await prisma.$transaction(async (tx) => {
      const session = await tx.studySession.update({
        where: { id: source.id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.subject !== undefined ? { subject: body.subject } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.color !== undefined ? { color: body.color } : {}),
          date,
          startMinutes,
          durationMinutes,
          reminderLeadMinutes,
          ...(body.habitId !== undefined ? { habitId: body.habitId } : {}),
          ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
          status,
          ...(status === "COMPLETED" && source.status !== "COMPLETED"
            ? { completedAt: new Date() }
            : {}),
          ...(status !== "COMPLETED" ? { completedAt: null } : {}),
          // An occurrence the user has edited on its own is no longer covered
          // by the series rule.
          ...(source.seriesId && !source.isException ? { isException: true } : {}),
        },
        select: studySessionSelect,
      });

      if (becomingComplete) {
        await logStudyHabit(tx, {
          id: session.id,
          userId: user.id,
          title: session.title,
          habitId: session.habitId,
          date: session.date,
          minutes: session.actualMinutes > 0 ? session.actualMinutes : session.durationMinutes,
        });
      }

      await syncStudyReminder(tx, { id: user.id, timezone }, {
        targetId: session.id,
        title: `${session.title} starts soon`,
        body: `${session.subject} · ${session.date.toISOString().slice(0, 10)}`,
        isoDay: session.date.toISOString().slice(0, 10),
        daysOfWeek: [],
        startMinutes: session.startMinutes,
        leadMinutes: session.reminderLeadMinutes,
        recurring: false,
      });

      return session;
    });

    return { session: serialiseSession(updated), warning };
  },
});

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const existing = await prisma.studySession.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true, seriesId: true, date: true, title: true },
    });
    assertOwnership(existing, user.id, "That session no longer exists.");

    await prisma.$transaction(async (tx) => {
      await tx.studySession.delete({ where: { id: existing!.id } });

      // A deleted occurrence of a series must stay deleted.
      if (existing!.seriesId) {
        await tx.studySeriesSkip.upsert({
          where: {
            seriesId_date: { seriesId: existing!.seriesId, date: existing!.date },
          },
          create: { seriesId: existing!.seriesId, date: existing!.date },
          update: {},
        });
      }

      await tx.reminder.deleteMany({
        where: { userId: user.id, targetType: "CUSTOM", targetId: existing!.id },
      });
    });

    return { id: existing!.id };
  },
});
