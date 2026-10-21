import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { todayUtc } from "@/lib/date";
import { LIMITS } from "@/lib/rate-limit";
import {
  assertStudyLinkOwnership,
  generateSeriesSchedule,
  getUserTimezone,
  serialiseSeries,
  seriesHorizonEnd,
  studySeriesSelect,
  syncStudyReminder,
} from "@/lib/study/server";
import { resolveStudyDuration, studySeriesCreateSchema } from "@/lib/validation/schemas";

/**
 * GET /api/v1/study-series   POST /api/v1/study-series
 *
 * The repeating rules behind the timetable.
 *
 * A series is a *rule*, not a day: "DSA, every Tuesday and Thursday at 7".
 * Creating one materialises the days it implies for the next six weeks, so
 * the week view has something concrete to draw, and the rule itself stays
 * editable in one place.
 */

export const GET = withApi({
  method: "GET",
  async handler({ user }) {
    const series = await prisma.studySeries.findMany({
      where: { userId: user.id },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      select: studySeriesSelect,
    });

    return { items: series.map(serialiseSeries) };
  },
});

export const POST = withApi({
  method: "POST",
  body: studySeriesCreateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, body }) {
    const resolved = resolveStudyDuration(
      body.startMinutes,
      body.durationMinutes,
      body.endMinutes,
    );
    if ("error" in resolved) {
      throw ApiError.validation(resolved.error, { [resolved.field]: resolved.error });
    }
    const durationMinutes = resolved.durationMinutes;

    await assertStudyLinkOwnership(user.id, body.habitId, body.categoryId);

    const horizonEnd = seriesHorizonEnd();
    const timezone = await getUserTimezone(user.id);

    const created = await prisma.$transaction(async (tx) => {
      const series = await tx.studySeries.create({
        data: {
          userId: user.id,
          title: body.title,
          subject: body.subject,
          notes: body.notes ?? null,
          color: body.color ?? "#C8F751",
          repeat: body.repeat,
          daysOfWeek: [...body.daysOfWeek].sort((a, b) => a - b),
          startMinutes: body.startMinutes,
          durationMinutes,
          reminderLeadMinutes: body.reminderLeadMinutes ?? null,
          habitId: body.habitId ?? null,
          categoryId: body.categoryId ?? null,
          generatedThrough: horizonEnd,
        },
        select: studySeriesSelect,
      });

      // The days it implies, from today onwards.
      await generateSeriesSchedule(tx, series, todayUtc(), horizonEnd);

      await syncStudyReminder(tx, { id: user.id, timezone }, {
        targetId: series.id,
        title: `${body.title} starts soon`,
        body: `${body.subject} · repeating`,
        isoDay: todayUtc().toISOString().slice(0, 10),
        daysOfWeek: series.daysOfWeek,
        startMinutes: series.startMinutes,
        leadMinutes: body.reminderLeadMinutes ?? null,
        recurring: true,
      });

      return series;
    });

    return serialiseSeries(created);
  },
});
