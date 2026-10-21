import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { todayUtc } from "@/lib/date";
import { LIMITS } from "@/lib/rate-limit";
import {
  applySeriesToFuture,
  assertStudyLinkOwnership,
  generateSeriesSchedule,
  getUserTimezone,
  serialiseSeries,
  seriesHorizonEnd,
  studySeriesSelect,
  syncStudyReminder,
} from "@/lib/study/server";
import { resolveStudyDuration, studySeriesUpdateSchema } from "@/lib/validation/schemas";

/**
 * PATCH /api/v1/study-series/:id   DELETE /api/v1/study-series/:id
 *
 * Editing and removing a repeating rule.
 *
 * A series edit rewrites the *future* of the schedule and nothing else. The
 * days the user has already lived are left exactly as they are - a session
 * they completed, or one they edited on its own, is a record of what happened
 * and outranks the rule. That split is the whole difference between a timetable
 * and a script that rewrites the past.
 *
 * Setting the repeat to "does not repeat" pauses the series: the future
 * occurrences are removed and the rule stops generating. Reactivate it and the
 * days come back.
 */

const params = z.object({ id: z.string().min(1) });

export const PATCH = withApi({
  method: "PATCH",
  params,
  body: studySeriesUpdateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const existing = await prisma.studySeries.findUnique({
      where: { id: params.id },
      select: studySeriesSelect,
    });
    assertOwnership(existing, user.id, "That schedule no longer exists.");
    const source = existing!;

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

    const repeat = body.repeat ?? source.repeat;
    const daysOfWeek = body.daysOfWeek
      ? [...new Set(body.daysOfWeek)].sort((a, b) => a - b)
      : source.daysOfWeek;

    // "Every week" is a single day. If the user switched to it without saying
    // which day, keep the one the series already had rather than guessing a
    // new one and moving their study.
    const effectiveDays = repeat === "WEEKLY" ? daysOfWeek.slice(0, 1) : daysOfWeek;

    const reminderLeadMinutes =
      body.reminderLeadMinutes !== undefined
        ? body.reminderLeadMinutes
        : source.reminderLeadMinutes;

    const horizonEnd = seriesHorizonEnd();
    const today = todayUtc();
    const timezone = await getUserTimezone(user.id);

    const updated = await prisma.$transaction(async (tx) => {
      const series = await tx.studySeries.update({
        where: { id: source.id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.subject !== undefined ? { subject: body.subject } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.color !== undefined ? { color: body.color } : {}),
          repeat,
          daysOfWeek: effectiveDays,
          startMinutes,
          durationMinutes,
          reminderLeadMinutes,
          ...(body.habitId !== undefined ? { habitId: body.habitId } : {}),
          ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
        select: studySeriesSelect,
      });

      if (repeat === "NONE") {
        // The rule stops repeating. Its future days are removed, and each one
        // leaves a tombstone so the rule cannot bring it back.
        const future = await tx.studySession.findMany({
          where: {
            seriesId: series.id,
            date: { gte: today },
            isException: false,
            status: "PLANNED",
          },
          select: { id: true, date: true },
        });
        for (const session of future) {
          await tx.studySession.delete({ where: { id: session.id } });
          await tx.studySeriesSkip.upsert({
            where: { seriesId_date: { seriesId: series.id, date: session.date } },
            create: { seriesId: series.id, date: session.date },
            update: {},
          });
        }
        await tx.studySeries.update({
          where: { id: series.id },
          data: { isActive: false },
        });
      } else if (series.isActive) {
        await applySeriesToFuture(
          tx,
          series.id,
          {
            id: series.id,
            userId: user.id,
            title: series.title,
            subject: series.subject,
            notes: series.notes,
            color: series.color,
            repeat: series.repeat,
            daysOfWeek: series.daysOfWeek,
            startMinutes: series.startMinutes,
            durationMinutes: series.durationMinutes,
            reminderLeadMinutes: series.reminderLeadMinutes,
            habitId: series.habitId,
            categoryId: series.categoryId,
          },
          today,
          horizonEnd,
        );
      } else {
        // Reactivated: the days it implies come back, except the ones the user
        // deleted or that were tombstoned earlier.
        await generateSeriesSchedule(
          tx,
          {
            id: series.id,
            userId: user.id,
            title: series.title,
            subject: series.subject,
            notes: series.notes,
            color: series.color,
            repeat: series.repeat,
            daysOfWeek: series.daysOfWeek,
            startMinutes: series.startMinutes,
            durationMinutes: series.durationMinutes,
            reminderLeadMinutes: series.reminderLeadMinutes,
            habitId: series.habitId,
            categoryId: series.categoryId,
          },
          today,
          horizonEnd,
        );
      }

      await syncStudyReminder(tx, { id: user.id, timezone }, {
        targetId: series.id,
        title: `${series.title} starts soon`,
        body: `${series.subject} · repeating`,
        isoDay: today.toISOString().slice(0, 10),
        daysOfWeek: series.daysOfWeek,
        startMinutes: series.startMinutes,
        leadMinutes: series.reminderLeadMinutes,
        recurring: true,
      });

      return tx.studySeries.findUniqueOrThrow({
        where: { id: series.id },
        select: studySeriesSelect,
      });
    });

    return serialiseSeries(updated);
  },
});

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const existing = await prisma.studySeries.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true },
    });
    assertOwnership(existing, user.id, "That schedule no longer exists.");

    await prisma.$transaction(async (tx) => {
      // History outlives the rule. A session the user already completed - or
      // one in the past - is detached from the series rather than deleted with
      // it, because deleting a rule must not erase the record of the work it
      // produced.
      await tx.studySession.updateMany({
        where: { seriesId: existing!.id, status: { in: ["COMPLETED", "MISSED"] } },
        data: { seriesId: null },
      });

      // The sessions and the tombstones that are still ahead go with it: the
      // rule is what created them, and leaving them behind would strand days
      // that belong to nothing.
      await tx.studySeries.delete({ where: { id: existing!.id } });
      await tx.reminder.deleteMany({
        where: { userId: user.id, targetType: "CUSTOM", targetId: existing!.id },
      });
    });

    return { id: existing!.id, deleted: true };
  },
});
