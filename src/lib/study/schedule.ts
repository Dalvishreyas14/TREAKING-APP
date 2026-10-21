/**
 * Study timetable arithmetic.
 *
 * Everything in this module is pure. It is the shared vocabulary between the
 * form that validates a session, the API that stores one, the page that renders
 * a week and the tests that check the rules - so a duration calculated on the
 * client and a duration calculated on the server are the same duration, and
 * neither of them can drift into a different answer.
 *
 * Two conventions run through it:
 *
 *  - A weekday index is a JS day index: 0 = Sunday .. 6 = Saturday. Same as
 *    `Date.getDay()`, same as `HabitSchedule.dayOfWeek`.
 *  - A time of day is minutes from local midnight. Never an instant. "Monday
 *    7pm" is a slot on the user's own clock and has to stay 7pm, whatever the
 *    server's zone is. Storing an instant would make a session in the far
 *    future drift by an hour twice a year and would make the weekly view lie
 *    about which column a session belongs in.
 */

import { STUDY_WEEKDAYS } from "@/lib/study/presets";

export const MINUTES_PER_DAY = 1440;

/** The four states a scheduled session can be shown in. */
export type SessionViewStatus = "UPCOMING" | "IN_PROGRESS" | "COMPLETED" | "MISSED";

/** The minimum a caller must know about a session to reason about it. */
export interface SchedulableSession {
  date: string;
  startMinutes: number;
  durationMinutes: number;
  status: string;
}

/**
 * The length of a session, in minutes.
 *
 * Returns null when the end is not after the start, because a session that
 * ends before it starts has no length and the honest answer is "this is not a
 * valid session" rather than a negative number that quietly becomes a positive
 * one somewhere downstream.
 *
 * A session is not allowed to run past midnight. A 23:00 - 01:00 session would
 * have to live on two columns of the weekly grid, and every consumer of this
 * function - the conflict check, the duration total, the card - would have to
 * carry that complexity. The limit is enforced at the edges of the day instead.
 */
export function durationFromTimes(startMinutes: number, endMinutes: number): number | null {
  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) return null;
  if (startMinutes < 0 || startMinutes >= MINUTES_PER_DAY) return null;
  if (endMinutes <= 0 || endMinutes > MINUTES_PER_DAY) return null;
  if (endMinutes <= startMinutes) return null;
  return endMinutes - startMinutes;
}

/**
 * Format minutes-from-midnight as a clock time, e.g. `1140` -> `7:00 PM`.
 *
 * 1440 is midnight at the end of a day and formats as `12:00 AM` rather than
 * `0:00 AM`, because a session that ends at midnight ends at the *end* of the
 * day and "12:00 AM" is the label people expect to see for it.
 */
export function formatClock(minutes: number): string {
  const safe = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(minutes)));
  const normalised = safe === MINUTES_PER_DAY ? 0 : safe;
  const hours24 = Math.floor(normalised / 60);
  const mins = normalised % 60;
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(mins).padStart(2, "0")} ${suffix}`;
}

/**
 * Parse a clock time into minutes from midnight.
 *
 * Accepts the 24-hour form an `<input type="time">` produces (`19:00`) and
 * the 12-hour form people write (`7:00 PM`), because both turn up: the input
 * gives one, and a seeded timetable or an imported plan gives the other.
 *
 * Returns null for anything unparseable rather than a zero, so a caller can
 * skip the field rather than scheduling a session at midnight because the
 * string was malformed.
 */
export function parseClock(value: string): number | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  const twelve = /^(\d{1,2}):(\d{2})\s*(am|pm)$/.exec(trimmed);
  if (twelve) {
    const hours = Number(twelve[1]);
    const minutes = Number(twelve[2]);
    const suffix = twelve[3];
    if (hours < 1 || hours > 12 || minutes > 59) return null;
    const base = (hours % 12) * 60 + minutes;
    return suffix === "pm" ? base + 12 * 60 : base;
  }

  const twentyFour = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (twentyFour) {
    const hours = Number(twentyFour[1]);
    const minutes = Number(twentyFour[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  return null;
}

/**
 * Do two sessions overlap?
 *
 * Touching is not overlapping: a session ending at 8pm and one starting at 8pm
 * are two sessions back to back, which is what a study timetable is full of.
 * Treating them as a clash would make an hour of study impossible to schedule.
 */
export function sessionsOverlap(
  a: { startMinutes: number; durationMinutes: number },
  b: { startMinutes: number; durationMinutes: number },
): boolean {
  const aEnd = a.startMinutes + a.durationMinutes;
  const bEnd = b.startMinutes + b.durationMinutes;
  return a.startMinutes < bEnd && b.startMinutes < aEnd;
}

/**
 * The first session in `others` that overlaps `candidate`.
 *
 * `ignoreId` is the session being edited, so nudging a session by a minute
 * does not make it collide with where it used to be.
 */
export function findOverlap<T extends { id: string; startMinutes: number; durationMinutes: number }>(
  candidate: { startMinutes: number; durationMinutes: number },
  others: T[],
  ignoreId?: string,
): T | null {
  for (const other of others) {
    if (ignoreId && other.id === ignoreId) continue;
    if (sessionsOverlap(candidate, other)) return other;
  }
  return null;
}

/**
 * The weekday index of a calendar day, as a JS day index.
 *
 * `2026-10-26` -> 1 (Monday). The string is parsed as a UTC date so the answer
 * does not depend on the machine's zone - a timetable that moved a session to
 * Sunday because the server happened to be in a negative offset would be a
 * bug nobody would notice until it happened to somebody in California.
 */
export function weekdayOfIsoDay(isoDay: string): number {
  const [y, m, d] = isoDay.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The ISO day of a given weekday inside a week that starts on `weekStart`.
 *
 * `weekStart` is the ISO day of the week's first day. The result is always
 * inside that week, whether the week starts on a Monday or a Sunday.
 */
export function isoDayOfWeekday(weekStart: string, jsDay: number): string {
  const startWeekday = weekdayOfIsoDay(weekStart);
  const offset = (jsDay - startWeekday + 7) % 7;
  const [y, m, d] = weekStart.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1, d + offset));
  return target.toISOString().slice(0, 10);
}

/**
 * Shift an ISO day by a number of calendar days.
 *
 * Done on UTC midnight throughout, so the result is the same calendar day
 * rather than the same number of milliseconds later.
 */
export function shiftIsoDay(isoDay: string, days: number): string {
  const [y, m, d] = isoDay.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The seven ISO days of the week starting on `weekStart`. */
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftIsoDay(weekStart, i));
}

/**
 * The state a session should be *shown* in.
 *
 * The stored status says what the user did; the clock says what is true now.
 * A session that is still `PLANNED` but whose slot has passed is missed, and
 * saying so is the whole point of a timetable - otherwise a week of abandoned
 * sessions reads exactly like a week of sessions that have not happened yet.
 *
 * A session that is `IN_PROGRESS` stays in progress however long ago it was
 * started, because the timer is the authority on that and the timer can be
 * left running overnight.
 */
export function deriveSessionStatus(
  session: { status: string; date: string; startMinutes: number; durationMinutes: number },
  now: { isoDay: string; minutes: number },
): SessionViewStatus {
  if (session.status === "COMPLETED") return "COMPLETED";
  if (session.status === "IN_PROGRESS") return "IN_PROGRESS";
  if (session.status === "MISSED") return "MISSED";
  if (session.status === "RESCHEDULED") return "MISSED";

  const endMinutes = session.startMinutes + session.durationMinutes;
  if (session.date < now.isoDay) return "MISSED";
  if (session.date > now.isoDay) return "UPCOMING";
  return now.minutes >= endMinutes ? "MISSED" : "UPCOMING";
}

/**
 * Group sessions by their ISO day.
 *
 * Days with no sessions are still present in the result, because the weekly
 * grid draws seven columns and an absent column would be a hole rather than an
 * empty day.
 */
export function groupSessionsByDay<T extends { date: string; startMinutes: number }>(
  sessions: T[],
  days: string[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>(days.map((day) => [day, []]));
  for (const session of sessions) {
    const bucket = grouped.get(session.date);
    if (bucket) bucket.push(session);
  }
  for (const bucket of grouped.values()) {
    bucket.sort((a, b) => a.startMinutes - b.startMinutes);
  }
  return grouped;
}

/**
 * The total minutes a set of sessions plans, and the minutes actually focused.
 *
 * The two are returned separately and never added together. "Two hours planned
 * and one hour and ten minutes done" is the sentence the study page needs; a
 * single blended number would hide exactly the difference the user cares about.
 */
export function plannedVersusActual(
  sessions: { durationMinutes: number; actualMinutes: number; status: string }[],
): { plannedMinutes: number; actualMinutes: number } {
  let plannedMinutes = 0;
  let actualMinutes = 0;
  for (const session of sessions) {
    plannedMinutes += session.durationMinutes;
    actualMinutes += session.actualMinutes;
  }
  return { plannedMinutes, actualMinutes };
}

/**
 * The completion rate of a set of sessions, as a percentage from 0 to 100.
 *
 * Only sessions that have already had their slot count towards the
 * denominator. A week of planned sessions that has not happened yet is not a
 * week of failures, and reporting 0% for it would be a false signal - so the
 * denominator is the number of sessions that are due, and a week with nothing
 * due reports null rather than a number.
 */
export function completionPercent(
  sessions: { status: string; date: string; startMinutes: number; durationMinutes: number }[],
  now: { isoDay: string; minutes: number },
): number | null {
  const due = sessions.filter((session) => {
    if (session.status === "RESCHEDULED") return false;
    const end = session.startMinutes + session.durationMinutes;
    if (session.date < now.isoDay) return true;
    if (session.date > now.isoDay) return false;
    return now.minutes >= end;
  });

  if (due.length === 0) return null;

  const completed = due.filter((session) => {
    const status = deriveSessionStatus(session, now);
    return status === "COMPLETED";
  }).length;

  return Math.round((completed / due.length) * 100);
}

/**
 * The weekday indices a repeat mode covers.
 *
 * `WEEKLY` is the single day the session was created on; `CUSTOM` is the set
 * the user picked. `NONE` covers nothing, because a session that does not
 * repeat has no series to speak of.
 */
export function repeatDays(repeat: string, dayOfWeek: number, customDays: number[] = []): number[] {
  if (repeat === "WEEKLY") return [dayOfWeek];
  if (repeat === "CUSTOM") {
    const unique = Array.from(new Set(customDays.filter((d) => d >= 0 && d <= 6)));
    return unique.sort((a, b) => a - b);
  }
  return [];
}

/**
 * The label a repeat mode gets in the UI.
 *
 * `Every week` and `Custom days` are the names the user chose, so they are the
 * names used here rather than something more precise that would need
 * explaining.
 */
export function repeatLabel(repeat: string, days: number[]): string {
  if (repeat === "WEEKLY") {
    const day = STUDY_WEEKDAYS.find((d) => d.jsDay === days[0]);
    return day ? `Every ${day.long}` : "Every week";
  }
  if (repeat === "CUSTOM") {
    if (days.length === 0) return "Custom days";
    if (days.length === 7) return "Every day";
    return days.map((d) => STUDY_WEEKDAYS.find((w) => w.jsDay === d)?.short ?? "?").join(", ");
  }
  return "Does not repeat";
}
