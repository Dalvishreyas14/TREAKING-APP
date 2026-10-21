import "server-only";

import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { addDaysUtc, dateOnly, startOfWeekUtc, todayUtc } from "@/lib/date";
import { habitCompletion, type HabitRuleType } from "@/lib/habits/rules";
import { blockInstants, dateOnlyToIsoDay, isoDayToDateOnly } from "@/lib/planner/server";
import { STUDY_HORIZON_WEEKS } from "@/lib/study/presets";
import { findOverlap, formatClock } from "@/lib/study/schedule";
import { Prisma } from "@/generated/prisma/client";

/**
 * Server-side plumbing for the study timetable.
 *
 * The shape of this feature follows the fitness one closely, because the
 * fitness planner already solved the hard parts of the same problem: a
 * recurring rule that produces concrete occurrences, without ever duplicating
 * one and without rewriting history the user has already acted on.
 *
 * The two rules that keep it honest:
 *
 *  1. **A series is the plan, the sessions are the record.** Editing a series
 *     rewrites the future occurrences it owns. Completing, skipping or
 *     rescheduling a session is a fact about the past and is never rewritten by
 *     a later edit to the rule.
 *
 *  2. **Generation is idempotent.** A day that already has a session for the
 *     series, or that has been explicitly skipped, never gets a second one. The
 *     unique index on `(seriesId, date)` is the database-level guarantee; the
 *     checks below are the application-level one that also understands skips.
 */

/** The shared read shape for a study session. */
export const studySessionSelect = {
  id: true,
  userId: true,
  seriesId: true,
  title: true,
  subject: true,
  notes: true,
  color: true,
  date: true,
  startMinutes: true,
  durationMinutes: true,
  status: true,
  actualMinutes: true,
  reminderLeadMinutes: true,
  habitId: true,
  categoryId: true,
  isException: true,
  startedAt: true,
  completedAt: true,
  rescheduledFromDate: true,
  series: {
    select: {
      id: true,
      title: true,
      subject: true,
      repeat: true,
      daysOfWeek: true,
    },
  },
} satisfies Prisma.StudySessionSelect;

export type StudySessionDetail = Prisma.StudySessionGetPayload<{
  select: typeof studySessionSelect;
}>;

/**
 * Strip a session down to the JSON-safe shape the client receives.
 *
 * `date` goes out as a bare `yyyy-MM-dd`. Serialised as a full ISO timestamp it
 * would carry a time the client would then reinterpret in its own zone, which
 * is how a session silently moves from Monday to Sunday for half the world.
 */
export function serialiseSession(session: StudySessionDetail) {
  return {
    id: session.id,
    seriesId: session.seriesId,
    title: session.title,
    subject: session.subject,
    notes: session.notes,
    color: session.color,
    date: dateOnlyToIsoDay(session.date),
    startMinutes: session.startMinutes,
    durationMinutes: session.durationMinutes,
    endMinutes: session.startMinutes + session.durationMinutes,
    status: session.status,
    actualMinutes: session.actualMinutes,
    reminderLeadMinutes: session.reminderLeadMinutes,
    habitId: session.habitId,
    categoryId: session.categoryId,
    isException: session.isException,
    startedAt: session.startedAt ? session.startedAt.toISOString() : null,
    completedAt: session.completedAt ? session.completedAt.toISOString() : null,
    rescheduledFromDate: session.rescheduledFromDate
      ? dateOnlyToIsoDay(session.rescheduledFromDate)
      : null,
    series: session.series
      ? {
          id: session.series.id,
          title: session.series.title,
          subject: session.series.subject,
          repeat: session.series.repeat,
          daysOfWeek: session.series.daysOfWeek,
        }
      : null,
  };
}

export type SerialisedStudySession = ReturnType<typeof serialiseSession>;

/** The shared read shape for a series. */
export const studySeriesSelect = {
  id: true,
  userId: true,
  title: true,
  subject: true,
  notes: true,
  color: true,
  repeat: true,
  daysOfWeek: true,
  startMinutes: true,
  durationMinutes: true,
  reminderLeadMinutes: true,
  habitId: true,
  categoryId: true,
  isActive: true,
  generatedThrough: true,
  habit: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
} satisfies Prisma.StudySeriesSelect;

export type StudySeriesDetail = Prisma.StudySeriesGetPayload<{
  select: typeof studySeriesSelect;
}>;

export function serialiseSeries(series: StudySeriesDetail) {
  return {
    id: series.id,
    title: series.title,
    subject: series.subject,
    notes: series.notes,
    color: series.color,
    repeat: series.repeat,
    daysOfWeek: series.daysOfWeek,
    startMinutes: series.startMinutes,
    durationMinutes: series.durationMinutes,
    endMinutes: series.startMinutes + series.durationMinutes,
    reminderLeadMinutes: series.reminderLeadMinutes,
    habitId: series.habitId,
    categoryId: series.categoryId,
    isActive: series.isActive,
    habit: series.habit,
    category: series.category,
  };
}

export type SerialisedStudySeries = ReturnType<typeof serialiseSeries>;

/** The fields generation needs. Narrower than the full select on purpose. */
export interface SeriesForGeneration {
  id: string;
  userId: string;
  title: string;
  subject: string;
  notes: string | null;
  color: string;
  repeat: string;
  daysOfWeek: number[];
  startMinutes: number;
  durationMinutes: number;
  reminderLeadMinutes: number | null;
  habitId: string | null;
  categoryId: string | null;
}

/**
 * Create the concrete sessions a series implies for every day in
 * `[from, through]` that does not already have one.
 *
 * Idempotent by `(seriesId, date)`: a day that already has a session is left
 * alone, and a day the user explicitly deleted is skipped for good. Running
 * this on every read of the timetable is therefore safe.
 *
 * The whole range is loaded in two queries rather than two per day. A six-week
 * horizon is 42 days, and a per-day existence check would turn one page load
 * into eighty-odd queries for a single series.
 */
export async function generateSeriesSchedule(
  tx: Prisma.TransactionClient,
  series: SeriesForGeneration,
  from: Date,
  through: Date,
): Promise<void> {
  if (series.repeat === "NONE" || series.daysOfWeek.length === 0) return;

  const start = dateOnly(from);
  const end = dateOnly(through);
  if (start.getTime() > end.getTime()) return;

  const wanted = new Set(series.daysOfWeek);
  const [existing, skipped] = await Promise.all([
    tx.studySession.findMany({
      where: { seriesId: series.id, date: { gte: start, lte: end } },
      select: { date: true },
    }),
    tx.studySeriesSkip.findMany({
      where: { seriesId: series.id, date: { gte: start, lte: end } },
      select: { date: true },
    }),
  ]);

  const taken = new Set<number>();
  for (const row of existing) taken.add(row.date.getTime());
  for (const row of skipped) taken.add(row.date.getTime());

  const missing: Date[] = [];
  for (let cursor = start; cursor.getTime() <= end.getTime(); cursor = addDaysUtc(cursor, 1)) {
    if (!wanted.has(cursor.getUTCDay())) continue;
    if (taken.has(cursor.getTime())) continue;
    missing.push(cursor);
  }

  if (missing.length === 0) return;

  await tx.studySession.createMany({
    data: missing.map((date) => ({
      userId: series.userId,
      seriesId: series.id,
      title: series.title,
      subject: series.subject,
      notes: series.notes,
      color: series.color,
      date,
      startMinutes: series.startMinutes,
      durationMinutes: series.durationMinutes,
      reminderLeadMinutes: series.reminderLeadMinutes,
      habitId: series.habitId,
      categoryId: series.categoryId,
      status: "PLANNED" as const,
    })),
    // The unique index on `(seriesId, date)` is the real guarantee. This makes a
    // repeated day in the payload a no-op rather than an error.
    skipDuplicates: true,
  });
}

/**
 * The last day the timetable materialises sessions for.
 *
 * A rolling six-week window, anchored on the Monday of the current week. It is
 * a *window* rather than a date the series grows towards without limit, so a
 * series with a slot every day produces a bounded number of rows no matter how
 * often the page is loaded.
 */
export function seriesHorizonEnd(today: Date = todayUtc()): Date {
  return addDaysUtc(startOfWeekUtc(today), STUDY_HORIZON_WEEKS * 7 - 1);
}

/**
 * Extend every active series' materialised schedule up to the rolling horizon.
 *
 * Only days *after* `generatedThrough` are filled, which is what stops a
 * session the user deleted from being recreated on the next page load. Called
 * on every timetable read; a no-op once the horizon is reached.
 */
export async function ensureSeriesSchedule(userId: string): Promise<void> {
  const series = await prisma.studySeries.findMany({
    where: { userId, isActive: true },
    select: studySeriesSelect,
  });
  if (series.length === 0) return;

  const today = todayUtc();
  const horizonEnd = seriesHorizonEnd(today);

  await prisma.$transaction(async (tx) => {
    for (const one of series) {
      const from = one.generatedThrough ? addDaysUtc(one.generatedThrough, 1) : today;
      if (from.getTime() > horizonEnd.getTime()) continue;

      await generateSeriesSchedule(tx, one, from, horizonEnd);
      await tx.studySeries.update({
        where: { id: one.id },
        data: { generatedThrough: horizonEnd },
      });
    }
  });
}

/**
 * Rewrite a series' future occurrences to match an edited series.
 *
 * This is the difference between editing one occurrence and editing the rule.
 * A series edit changes the plan, so every *future* occurrence it owns is
 * brought into line - and only the future:
 *
 *  - A day that is no longer in the pattern loses its session, and a tombstone
 *    is written so the next generation pass does not put it straight back.
 *  - A day that is still in the pattern keeps its session but takes the new
 *    title, time and colour.
 *  - A day newly added to the pattern gets a session.
 *
 * History is never touched. A session the user already completed, or that
 * carries `isException` because they edited it on its own, is left exactly as
 * it is - their record of what actually happened outranks the rule.
 */
export async function applySeriesToFuture(
  tx: Prisma.TransactionClient,
  seriesId: string,
  series: SeriesForGeneration,
  from: Date,
  through: Date,
): Promise<void> {
  const wanted = new Set(series.daysOfWeek);

  const future = await tx.studySession.findMany({
    where: {
      seriesId,
      date: { gte: from, lte: through },
      isException: false,
      status: "PLANNED",
    },
    select: { id: true, date: true },
  });

  const keep: string[] = [];
  for (const session of future) {
    if (wanted.has(session.date.getUTCDay())) {
      keep.push(session.id);
      continue;
    }
    await tx.studySession.delete({ where: { id: session.id } });
    await tx.studySeriesSkip.upsert({
      where: { seriesId_date: { seriesId, date: session.date } },
      create: { seriesId, date: session.date },
      update: {},
    });
  }

  if (keep.length > 0) {
    await tx.studySession.updateMany({
      where: { id: { in: keep } },
      data: {
        title: series.title,
        subject: series.subject,
        notes: series.notes,
        color: series.color,
        startMinutes: series.startMinutes,
        durationMinutes: series.durationMinutes,
        reminderLeadMinutes: series.reminderLeadMinutes,
        habitId: series.habitId,
        categoryId: series.categoryId,
      },
    });
  }

  await generateSeriesSchedule(tx, series, from, through);
}

/**
 * The first session that clashes with a candidate slot.
 *
 * Returns the conflicting session rather than throwing, because a clash is a
 * *warning* here rather than an error. The planner refuses to double-book a
 * day outright, but a study timetable is a plan the user is allowed to
 * overcommit on - the honest response is to say "this overlaps DSA" and let
 * them decide, not to refuse to record what they actually intend to do.
 */
export async function findSessionConflict(
  userId: string,
  isoDay: string,
  startMinutes: number,
  durationMinutes: number,
  ignoreId?: string,
): Promise<{ id: string; title: string; startMinutes: number; durationMinutes: number } | null> {
  const day = isoDayToDateOnly(isoDay);
  const sameDay = await prisma.studySession.findMany({
    where: { userId, date: day, status: { not: "RESCHEDULED" } },
    select: { id: true, title: true, startMinutes: true, durationMinutes: true },
  });

  return findOverlap({ startMinutes, durationMinutes }, sameDay, ignoreId);
}

/** The warning text for a clash, or null when there is none. */
export function conflictWarning(
  conflict: { title: string; startMinutes: number; durationMinutes: number } | null,
): string | null {
  if (!conflict) return null;
  const from = formatClock(conflict.startMinutes);
  const to = formatClock(conflict.startMinutes + conflict.durationMinutes);
  return `That overlaps “${conflict.title}” (${from} – ${to}).`;
}

/**
 * Log the linked habit for a finished study session.
 *
 * The habit decides whether it is done, not the session. A BOOLEAN habit is
 * done at any value above zero; a DURATION habit is done when the minutes
 * reach its target. Those are the same rules the habit screen uses, which is
 * why they live in one place.
 *
 * Two guards make this safe to call more than once:
 *
 *  - A log that already carries this session id is left alone, so finishing the
 *    same session twice cannot credit the habit twice.
 *  - A hand-written log for that habit and day is never overwritten. The
 *    session is linked to it so it is accounted for, but the number the user
 *    typed stays the number the user typed.
 *
 * A log written by *another* session on the same day keeps the larger of the
 * two values rather than being replaced, because the day really did include
 * both sessions and one row per habit per day is what keeps the streak honest.
 */
export async function logStudyHabit(
  tx: Prisma.TransactionClient,
  session: {
    id: string;
    userId: string;
    title: string;
    habitId: string | null;
    date: Date;
    /**
     * The minutes to credit. The focus timer knows the real elapsed time;
     * a session the user ticked off by hand falls back to its planned length,
     * because "I did this session" is a claim about the whole session.
     */
    minutes: number;
  },
): Promise<void> {
  if (!session.habitId) return;
  // Nothing was focused, so there is nothing to log. A session that was opened
  // and closed without studying must not tick a habit.
  if (session.minutes <= 0) return;

  const habit = await tx.habit.findUnique({
    where: { id: session.habitId },
    select: {
      id: true,
      userId: true,
      type: true,
      targetValue: true,
      isActive: true,
      schedule: { select: { dayOfWeek: true } },
    },
  });
  if (!habit || habit.userId !== session.userId || !habit.isActive) return;

  const type = habit.type as HabitRuleType;
  const { value, completed } = habitCompletion(type, session.minutes, habit.targetValue);

  // A habit with a custom schedule only counts on the days it is scheduled
  // for. "Revise DSA" on Monday, Wednesday and Friday is not a habit that
  // silently counts on a Tuesday as well.
  const scheduledDays = habit.schedule.map((s) => s.dayOfWeek);
  const onSchedule =
    scheduledDays.length === 0 || scheduledDays.includes(session.date.getUTCDay());

  const existing = await tx.habitLog.findUnique({
    where: { habitId_date: { habitId: habit.id, date: session.date } },
    select: { id: true, value: true, completed: true, studySessionId: true },
  });

  if (existing) {
    if (existing.studySessionId === session.id) return;

    if (!existing.studySessionId) {
      // A hand-written log. Link it so the guard knows this session is
      // accounted for, but never overwrite what the user entered.
      await tx.habitLog.update({
        where: { id: existing.id },
        data: { studySessionId: session.id },
      });
      return;
    }

    // Another session already fed this habit today. One row per habit per day
    // is what keeps the streak honest, so the larger total wins rather than a
    // second row being added.
    const merged = Math.max(existing.value, value);
    await tx.habitLog.update({
      where: { id: existing.id },
      data: {
        value: merged,
        completed: onSchedule && habitCompletion(type, merged, habit.targetValue).completed,
        studySessionId: existing.studySessionId,
      },
    });
    return;
  }

  await tx.habitLog.create({
    data: {
      userId: session.userId,
      habitId: habit.id,
      date: session.date,
      value,
      completed: completed && onSchedule,
      note: `Study session: ${session.title}`,
      studySessionId: session.id,
    },
  });
}

/**
 * The user's timezone, for reminders.
 *
 * The session guard does not carry it, and a reminder without one would be
 * scheduled against the server's zone rather than the user's own.
 */
export async function getUserTimezone(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  return user?.timezone ?? "UTC";
}

/**
 * The local instant a study session starts, and the instant its reminder is due.
 *
 * Both are real instants rather than wall-clock strings, because the reminder
 * engine works in instants and works in local time on purpose - a 7pm session
 * has to stay at 7pm across a daylight-saving boundary.
 */
export function sessionInstants(
  isoDay: string,
  startMinutes: number,
  leadMinutes: number | null,
): { startAt: Date; reminderAt: Date } {
  const { startAt } = blockInstants(isoDay, startMinutes, 0);
  const reminderAt =
    leadMinutes === null ? startAt : new Date(startAt.getTime() - leadMinutes * 60_000);
  return { startAt, reminderAt };
}

/**
 * Keep a study session's reminder in step with the session.
 *
 * The app has no worker, so a reminder fires when the notification list is
 * read. A one-off session gets a one-shot reminder; a series gets a single
 * weekly reminder carrying the series' weekdays, rather than one row per
 * occurrence - which would mean a pile of rows that all say the same thing.
 *
 * `targetId` is the session or series id, and `targetType` is always `CUSTOM`,
 * because neither a session nor a series is one of the kinds the reminder
 * system already knows how to link to.
 */
export async function syncStudyReminder(
  tx: Prisma.TransactionClient,
  user: { id: string; timezone: string },
  input: {
    targetId: string;
    title: string;
    body: string;
    isoDay: string;
    daysOfWeek: number[];
    startMinutes: number;
    leadMinutes: number | null;
    recurring: boolean;
  },
): Promise<void> {
  const existing = await tx.reminder.findFirst({
    where: { userId: user.id, targetType: "CUSTOM", targetId: input.targetId },
    select: { id: true },
  });

  if (input.leadMinutes === null) {
    if (existing) {
      await tx.reminder.delete({ where: { id: existing.id } });
    }
    return;
  }

  const { reminderAt } = sessionInstants(input.isoDay, input.startMinutes, input.leadMinutes);
  // A Json column cannot be written with a bare null - Prisma refuses the
  // ambiguity between "the JSON value null" and "SQL NULL" - so a one-off
  // reminder stores SQL NULL, which is what "no rule" means to the reminder
  // engine. See `clearableJson` in the notifications module.
  const recurrence = input.recurring
    ? { freq: "WEEKLY", interval: 1, byWeekday: [...input.daysOfWeek].sort((a, b) => a - b) }
    : Prisma.DbNull;

  const data = {
    type: "CUSTOM" as const,
    channel: "IN_APP" as const,
    title: input.title,
    body: input.body,
    scheduledFor: reminderAt,
    timezone: user.timezone,
    recurrence,
    enabled: true,
    targetType: "CUSTOM" as const,
    targetId: input.targetId,
  };

  if (existing) {
    await tx.reminder.update({ where: { id: existing.id }, data });
    return;
  }

  await tx.reminder.create({ data: { ...data, userId: user.id } });
}

/**
 * The next date on or after `fromIsoDay` that falls on one of `daysOfWeek`.
 *
 * Used to anchor a series' weekly reminder on a real occurrence rather than on
 * whatever day the series happened to be created.
 */
export function nextDateOnDays(fromIsoDay: string, daysOfWeek: number[]): string | null {
  if (daysOfWeek.length === 0) return null;
  const wanted = new Set(daysOfWeek);
  let cursor = fromIsoDay;
  for (let i = 0; i < 14; i += 1) {
    const jsDay = new Date(`${cursor}T00:00:00.000Z`).getUTCDay();
    if (wanted.has(jsDay)) return cursor;
    const [y, m, d] = cursor.split("-").map(Number) as [number, number, number];
    cursor = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Verify that a linked habit and category belong to this user.
 *
 * A crafted `habitId` would otherwise attach somebody else's habit to the
 * user's timetable, and the study page would then show its name.
 */export async function assertStudyLinkOwnership(
  userId: string,
  habitId?: string | null,
  categoryId?: string | null,
): Promise<void> {
  if (habitId) {
    const habit = await prisma.habit.findFirst({
      where: { id: habitId, userId },
      select: { id: true },
    });
    if (!habit) throw ApiError.badRequest("That habit no longer exists.");
  }
  if (categoryId) {
    const category = await prisma.category.findFirst({
      where: { id: categoryId, OR: [{ userId }, { userId: null }] },
      select: { id: true },
    });
    if (!category) throw ApiError.badRequest("That category no longer exists.");
  }
}
