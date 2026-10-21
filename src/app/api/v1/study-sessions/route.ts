import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { startOfWeekUtc, todayUtc } from "@/lib/date";
import { LIMITS } from "@/lib/rate-limit";
import { dateOnlyToIsoDay, isoDayToDateOnly } from "@/lib/planner/server";
import { shiftIsoDay, weekdayOfIsoDay } from "@/lib/study/schedule";
import {
  assertStudyLinkOwnership,
  conflictWarning,
  findSessionConflict,
  generateSeriesSchedule,
  getUserTimezone,
  seriesHorizonEnd,
  serialiseSession,
  serialiseSeries,
  studySessionSelect,
  studySeriesSelect,
  syncStudyReminder,
} from "@/lib/study/server";
import {
  resolveStudyDuration,
  studySessionCreateSchema,
  studySessionListQuerySchema,
} from "@/lib/validation/schemas";

/**
 * GET /api/v1/study-sessions   POST /api/v1/study-sessions
 *
 * The concrete study sessions - the days that are actually on the timetable.
 *
 * Creating one has two shapes. A one-off is a single `StudySession` with no
 * series behind it. A recurring one creates a `StudySeries` and materialises
 * its occurrences, so "every Tuesday at 7" is stored once as a rule and many
 * times as days. The two are the same thing to the user, which is why they
 * share an endpoint.
 */

export const GET = withApi({
  method: "GET",
  query: studySessionListQuerySchema,
  async handler({ user, query }) {
    // Default to the current week. A timetable that opened on a range of six
    // weeks would be a schedule, not a week.
    const weekStart = dateOnlyToIsoDay(startOfWeekUtc(todayUtc()));
    const from = query.from ?? weekStart;
    const to = query.to ?? shiftIsoDay(from, 6);

    const sessions = await prisma.studySession.findMany({
      where: {
        userId: user.id,
        date: { gte: isoDayToDateOnly(from), lte: isoDayToDateOnly(to) },
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ date: "asc" }, { startMinutes: "asc" }],
      select: studySessionSelect,
    });

    return { items: sessions.map(serialiseSession) };
  },
});

export const POST = withApi({
  method: "POST",
  body: studySessionCreateSchema,
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

    // A clash is a warning, not a refusal. The planner will not let you
    // double-book a day, but a study timetable is a plan the user is allowed to
    // overcommit on - the honest response is to say what it overlaps and let
    // them decide.
    const conflict = await findSessionConflict(
      user.id,
      body.date,
      body.startMinutes,
      durationMinutes,
    );
    const warning = conflictWarning(conflict);

    const date = isoDayToDateOnly(body.date);
    const timezone = await getUserTimezone(user.id);
    const horizonEnd = seriesHorizonEnd();

    // A repeat of "does not repeat" is a one-off session; anything else is a
    // series with the days it happens on.
    const repeat = body.series?.repeat ?? "NONE";

    if (repeat === "NONE") {
      const created = await prisma.$transaction(async (tx) => {
        const session = await tx.studySession.create({
          data: {
            userId: user.id,
            title: body.title,
            subject: body.subject,
            notes: body.notes ?? null,
            color: body.color ?? "#C8F751",
            date,
            startMinutes: body.startMinutes,
            durationMinutes,
            reminderLeadMinutes: body.reminderLeadMinutes ?? null,
            habitId: body.habitId ?? null,
            categoryId: body.categoryId ?? null,
            status: "PLANNED",
          },
          select: studySessionSelect,
        });

        await syncStudyReminder(tx, { id: user.id, timezone }, {
          targetId: session.id,
          title: `${body.title} starts soon`,
          body: `${body.subject} · ${body.date}`,
          isoDay: body.date,
          daysOfWeek: [],
          startMinutes: body.startMinutes,
          leadMinutes: body.reminderLeadMinutes ?? null,
          recurring: false,
        });

        return session;
      });

      return { session: serialiseSession(created), series: null, warning };
    }

    // "Every week" means the weekday of the day the user picked, so the first
    // session lands on the day they were looking at.
    const daysOfWeek =
      repeat === "WEEKLY"
        ? [weekdayOfIsoDay(body.date)]
        : Array.from(new Set(body.series?.daysOfWeek ?? [])).sort((a, b) => a - b);

    const result = await prisma.$transaction(async (tx) => {
      const series = await tx.studySeries.create({
        data: {
          userId: user.id,
          title: body.title,
          subject: body.subject,
          notes: body.notes ?? null,
          color: body.color ?? "#C8F751",
          repeat,
          daysOfWeek,
          startMinutes: body.startMinutes,
          durationMinutes,
          reminderLeadMinutes: body.reminderLeadMinutes ?? null,
          habitId: body.habitId ?? null,
          categoryId: body.categoryId ?? null,
          // The rolling horizon, always. A series whose first day is further
          // out than the horizon still gets that day materialised below; the
          // horizon then catches up with it as the weeks pass.
          generatedThrough: horizonEnd,
        },
        select: studySeriesSelect,
      });

      // Materialise from the day the user chose. A custom series whose days do
      // not include that weekday simply starts on its first chosen day from
      // then on, which is what "starts from Monday" means.
      await generateSeriesSchedule(tx, series, date, horizonEnd);

      const sessions = await tx.studySession.findMany({
        where: { seriesId: series.id, date: { gte: date, lte: horizonEnd } },
        orderBy: [{ date: "asc" }, { startMinutes: "asc" }],
        select: studySessionSelect,
      });

      await syncStudyReminder(tx, { id: user.id, timezone }, {
        targetId: series.id,
        title: `${body.title} starts soon`,
        body: `${body.subject} · every week`,
        isoDay: body.date,
        daysOfWeek,
        startMinutes: body.startMinutes,
        leadMinutes: body.reminderLeadMinutes ?? null,
        recurring: true,
      });

      return { series, sessions };
    });

    return {
      session: result.sessions[0] ? serialiseSession(result.sessions[0]) : null,
      series: serialiseSeries(result.series),
      sessions: result.sessions.map(serialiseSession),
      warning,
    };
  },
});
