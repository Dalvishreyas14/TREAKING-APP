/**
 * Calendar dates.
 *
 * LIFEOS stores calendar dates — a habit log for "Tuesday", the day a time
 * block sits on, a review week — in `@db.Date` columns. Postgres has no date
 * type in Prisma's mapping, so those columns are `timestamp(0)` and Prisma
 * represents them as a JavaScript `Date` pinned to midnight **UTC**.
 *
 * That is the single most dangerous detail in the schema. `startOfDay` from
 * date-fns returns midnight in the *server's* local zone, which is a different
 * instant: in IST, local midnight is 18:30 UTC the previous day, so
 * `where: { date: startOfDay(now) }` silently matches nothing and the page
 * renders as though the user logged nothing. No error, no warning, just data
 * that has quietly disappeared.
 *
 * So: every read and write against a `@db.Date` column must go through this
 * module. Never mix in date-fns' `startOfDay`/`endOfDay` for those columns.
 * date-fns is still correct for formatting and for real instants such as
 * `TimeBlock.startAt`, which is a genuine timestamp rather than a date.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Midnight UTC on the calendar day containing `date`.
 *
 * This is the canonical form for a `@db.Date` column: what you write, what you
 * compare against, and what Prisma gives back.
 */
export function dateOnly(date: Date = new Date()): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
  );
}

/** The current calendar day in UTC, for `@db.Date` comparisons. */
export function todayUtc(): Date {
  return dateOnly(new Date());
}

/** `days` calendar days away from `from`, at UTC midnight. */
export function addDaysUtc(from: Date, days: number): Date {
  return new Date(dateOnly(from).getTime() + days * MS_PER_DAY);
}

/** Midnight UTC on the first day of the month containing `date`. */
export function startOfMonthUtc(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Midnight UTC on the Monday starting the week containing `date`. */
export function startOfWeekUtc(date: Date = new Date()): Date {
  const day = dateOnly(date);
  // getUTCDay is 0 for Sunday; shift so Monday is 0.
  const offset = (day.getUTCDay() + 6) % 7;
  return addDaysUtc(day, -offset);
}

/** Whole days from `from` to `to`, counted as calendar days. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((dateOnly(to).getTime() - dateOnly(from).getTime()) / MS_PER_DAY);
}

/**
 * Midnight UTC on the calendar day the user *sees* `date` on, from a real instant.
 *
 * This exists because the planner stores a day and a time in two different kinds
 * of column. `TimeBlock.date` is a `@db.Date` (UTC midnight) while
 * `TimeBlock.startAt` is a genuine instant, and a user who schedules something
 * for 2am is describing 2am on their own wall clock. Those two disagree for five
 * and a half hours a day in IST:
 *
 *   2:00am on Sunday the 27th (IST) is 20:30 UTC on Saturday the 26th.
 *   `dateOnly()` therefore files that block under the 26th, so it is created,
 *   stored, and then missing from the planner for the 27th it was made for.
 *
 * `dateOnly()` is not wrong — it is answering a different question, the one for
 * "what UTC day is this instant in", which is right for logs and streaks
 * written by the server. This is the question for "what day did the user mean",
 * which is what a time block needs. Use this one for anything a human picked a
 * time of day for.
 */
export function dateOnlyLocal(date: Date = new Date()): Date {
  return new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0),
  );
}

/**
 * The reverse: the UTC instant a local wall-clock time falls on.
 *
 * `new Date(y, m, d, h, min)` is already the right primitive and is not wrapped
 * in a helper here on purpose — it reads as the thing it does, and the one place
 * the planner builds a block out of separate date and time inputs calls it
 * directly with a comment.
 */

/** True when both instants land on the same local calendar day. */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return dateOnlyLocal(a).getTime() === dateOnlyLocal(b).getTime();
}

/*
 * ------------------------------------------------------------------
 * Real instants: local wall-clock input
 * ------------------------------------------------------------------
 *
 * A `<input type="datetime-local">` yields "2026-09-27T14:30" with no offset, and
 * the user means 2:30pm *where they are*. `new Date("2026-09-27T14:30")` parses
 * that as 14:30 UTC, so a task due at 2:30pm in IST fires at 8pm. These two
 * helpers are the only sanctioned bridge between a local wall-clock string and a
 * real timestamp, and they are deliberately not used for `@db.Date` columns —
 * those are the UTC functions above.
 */

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Format an instant as a `datetime-local` string in the *runtime's* local zone.
 * Used to populate the input; the value is what the user last saw, so reopening
 * the form must not shift it.
 */
export function toLocalDateTimeInput(date: Date = new Date()): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * Parse a `datetime-local` string as local wall-clock time.
 *
 * Returns null for anything unparseable rather than an Invalid Date, so callers
 * can skip the field instead of writing `Invalid Date` to the database.
 */
export function fromLocalDateTimeInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    s ? Number(s) : 0,
  );
  // A rolled-over date (Feb 30) means the input was not a real wall-clock time.
  return Number.isNaN(date.getTime()) ||
    date.getMonth() !== Number(mo) - 1 ||
    date.getDate() !== Number(d)
    ? null
    : date;
}
