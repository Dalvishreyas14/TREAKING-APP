/**
 * Week arithmetic for weekly plans.
 *
 * Everything here is `@db.Date` work, so it goes through `@/lib/date` rather than
 * date-fns. `startOfWeek` from date-fns returns midnight in the *server's* zone,
 * which in IST is 18:30 UTC the previous day — the wrong instant for a
 * `weekStart` column, and the same class of bug that module's header exists to
 * prevent.
 *
 * The week starts on the user's configured day (`User.weekStartsOn`, Monday by
 * default) rather than a hardcoded Monday. Two people who disagree about which
 * day a week begins on will disagree about which seven days this week covers, and
 * a plan that silently uses the wrong window reports progress for the wrong days.
 */

import { addDaysUtc, dateOnly, daysBetween, startOfWeekUtc, todayUtc } from "@/lib/date";

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A plan window as the `@db.Date` columns store it. */
export interface WeekBounds {
  /** UTC midnight on the first day. */
  start: Date;
  /** UTC midnight on the last day, inclusive. */
  end: Date;
}

/**
 * The seven days of the week containing `date`, honouring `weekStartsOn`.
 *
 * `weekStartsOn` is a JS day index (0 = Sunday), matching `User.weekStartsOn`.
 * The one supported value that differs from the Monday default is 0, so that case
 * is handled explicitly and anything else falls back to Monday rather than
 * producing a window that starts in the future.
 */
export function weekBounds(date: Date = new Date(), weekStartsOn = 1): WeekBounds {
  const day = dateOnly(date);
  // A Sunday-start week still has to be walked *back* to the Sunday, not taken
  // from today's date: `weekBounds(thursday)` with weekStartsOn 0 must return the
  // week beginning four days earlier, or "this week" silently becomes "from today
  // onwards" and the first part of the week reports no progress.
  if (weekStartsOn === 0) {
    const start = addDaysUtc(day, -day.getUTCDay());
    return { start, end: addDaysUtc(start, 6) };
  }
  const start = startOfWeekUtc(day);
  return { start, end: addDaysUtc(start, 6) };
}

/**
 * `offset` weeks from the week containing `date`.
 *
 * The offset is applied to the *start of the week* and the end re-derived, so
 * "last week" is always exactly seven days before this week and never drifts by
 * an hour the way repeatedly adding 7×24h to a local-midnight instant would.
 */
export function weekOffset(date: Date = new Date(), offset = 0, weekStartsOn = 1): WeekBounds {
  const { start } = weekBounds(date, weekStartsOn);
  const shifted = addDaysUtc(start, offset * 7);
  return { start: shifted, end: addDaysUtc(shifted, 6) };
}

/** Total calendar days in the window, inclusive of both ends. `end >= start` gives 7. */
export function windowLength(bounds: WeekBounds): number {
  return daysBetween(bounds.start, bounds.end) + 1;
}

/**
 * Days of the window that are already over, and how many remain.
 *
 * "Days active" is what makes a plan's pace readable: 3 of 5 hours done on day 1
 * of 7 is ahead, and the same 3 hours on day 6 is behind. Without the denominator
 * there is no pace, only a number.
 *
 * Clamped at both ends so a past plan reads as complete rather than negative, and
 * a future plan reads as "not started" rather than seven days that have not
 * happened yet. `today` is passed in rather than read from the clock so the maths
 * is testable and so a single render cannot straddle midnight UTC and disagree
 * with itself.
 */
export function daysElapsed(bounds: WeekBounds, today: Date = todayUtc()): {
  elapsed: number;
  remaining: number;
  total: number;
} {
  const total = windowLength(bounds);
  const elapsed = Math.min(Math.max(daysBetween(bounds.start, today) + 1, 0), total);
  return { elapsed, remaining: total - elapsed, total };
}

/**
 * How far through the window the calendar is, as a 0-1 fraction.
 *
 * Null before the window opens, rather than 0. A plan that starts next Monday has
 * not failed to make progress; reporting 0% for it would be a false signal, and
 * the pace line is exactly the place where a false signal is most costly.
 */
export function windowPace(bounds: WeekBounds, today: Date = todayUtc()): number | null {
  const { elapsed, total } = daysElapsed(bounds, today);
  if (elapsed <= 0) return null;
  return Math.min(elapsed / total, 1);
}

/**
 * Which weekday indices fall inside the window.
 *
 * `WeeklyPlanDay.dayOfWeek` is a JS day index (0 = Sunday), and the returned
 * `dayOfWeek` values are meant to be compared against it directly rather than
 * against a position within the window — so a plan starting on Wednesday still
 * reports Wednesday as 3, not as day 1.
 */
export function daysOfWeekIn(bounds: WeekBounds): number[] {
  const out: number[] = [];
  for (let i = 0; i < windowLength(bounds); i++) {
    out.push(addDaysUtc(bounds.start, i).getUTCDay());
  }
  return out;
}

/** True when `date` falls on or between the window's first and last day. */
export function withinWindow(date: Date, bounds: WeekBounds): boolean {
  const day = dateOnly(date).getTime();
  return day >= bounds.start.getTime() && day <= bounds.end.getTime();
}

/**
 * The calendar days of the window as `@db.Date` values, for range queries.
 *
 * `FocusSession` and `HabitLog` are real instants rather than `@db.Date`
 * columns, so callers must widen these to a half-open instant range themselves
 * (`start` at 00:00 UTC, `end` at the following midnight). Returning instants
 * here rather than days keeps that widening in one place.
 */
export function windowRange(bounds: WeekBounds): { from: Date; to: Date } {
  return { from: bounds.start, to: addDaysUtc(bounds.end, 1) };
}

/**
 * `2026-09-27` -> `Date` at UTC midnight, the form a `@db.Date` column holds.
 *
 * Mirrors `isoDayToDateOnly` in `@/lib/planner/server`. It is duplicated rather
 * than imported because the planner's copy is coupled to block-instant maths that
 * a plan has no use for, and reaching across feature boundaries for one line of
 * date parsing would couple them for no gain. Both must agree.
 */
export function isoDayToDateOnly(isoDay: string): Date {
  const [y, m, d] = isoDay.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

/** `Date` at UTC midnight -> `2026-09-27`. */
export function dateOnlyToIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}