import { format } from "date-fns";

/**
 * Indian date presentation.
 *
 * Kept separate from `src/lib/date.ts` on purpose. That module answers "which
 * calendar day is this, as stored in a `@db.Date` column" and is therefore
 * aggressively UTC and deliberately unlocalised. This one answers "how do we
 * show that day to a person", which is a different question with a different
 * right answer depending on the reader. Mixing the two is how you end up with
 * `dateOnly()` localised and silently wrong for every query in the app.
 *
 * Conventions applied:
 *
 * - `dd/MM/yyyy` for numeric dates. Day before month, unlike the `MM/dd/yyyy`
 *   that `en-US` gives you, and unambiguous, which matters more than brevity
 *   when a date is read aloud or copied into a spreadsheet.
 * - Weeks start on Sunday. The ISO default of Monday is the odd one out here.
 * - Month and weekday names stay in English. These are the forms used in
 *   everyday Indian English, and translating them would break search, copy-paste
 *   and anyone who reads more than one script.
 *
 * Everything is built from explicit `date-fns` patterns rather than
 * `toLocaleDateString("en-IN", ...)`. The locale route looks tidier but its
 * output depends on the ICU data compiled into whichever Node build is running,
 * so a minor Node upgrade can quietly turn `27/09/2026` into `27 Sept 2026` and
 * nobody notices until a screenshot review. A pattern is a contract.
 */

/**
 * Format the *UTC* calendar fields of `date`, whatever the server's timezone is.
 *
 * `date-fns`' `format` reads local fields. For a value that came out of a
 * `@db.Date` column that is an off-by-one waiting to happen: a UTC midnight is
 * 20:00 the previous day in `America/New_York`, so `27/09/2026` renders as
 * `26/09/2026` and a strip cell quietly shows yesterday's logs. The same bug in
 * the other direction makes a "today" pill land on the wrong day.
 *
 * The fix is to shift the instant so its UTC fields *are* its local fields, then
 * format normally. `getTimezoneOffset()` is read per-date, so this stays correct
 * across DST boundaries rather than assuming a fixed offset.
 *
 * Note this anchors the display to the UTC day, not the viewer's local day. That
 * is deliberate and matches the rest of the app: the dashboard's numbers all
 * come from `todayUtc()` queries, so a header reading "28 September" above data
 * aggregated for the 27th would be the inconsistency worth avoiding. A user in
 * IST between midnight and 05:30 will see yesterday's date until the UTC day
 * rolls over; fixing that properly means moving `@db.Date` off UTC entirely,
 * which is a schema-wide decision, not a formatting one.
 */
function utcFormat(date: Date, pattern: string): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return format(new Date(date.getTime() + offsetMs), pattern);
}

/** Full numeric date: `27/09/2026`. */
export function formatIndianDate(date: Date): string {
  return utcFormat(date, "dd/MM/yyyy");
}

/** Spoken-form date for headings: `Sunday, 27 September 2026`. */
export function formatIndianLong(date: Date): string {
  return utcFormat(date, "EEEE, d MMMM yyyy");
}

/** Compact date for dense rows: `27 Sep 2026`. */
export function formatIndianMedium(date: Date): string {
  return utcFormat(date, "d MMM yyyy");
}

/** Three-letter weekday for the week strip: `Sun`. */
export function formatWeekdayShort(date: Date): string {
  return utcFormat(date, "EEE");
}

/** `27/09` — the numeric stamp used on strip cells. */
export function formatIndianShort(date: Date): string {
  return utcFormat(date, "dd/MM");
}

/**
 * Just the day number: `27`.
 *
 * For dense activity strips, where a fourteen-cell row has no room for a month
 * and the weekday is noise the reader already gets from the column position.
 * Reads the UTC day for the same reason every other formatter here does.
 */
export function formatDayOfMonth(date: Date): string {
  return utcFormat(date, "d");
}

/** Month and year, for a month heading: `September 2026`. */
export function formatMonthYear(date: Date): string {
  return utcFormat(date, "MMMM yyyy");
}

/** Day and month for a dense row: `12 Oct`, read from the UTC calendar day. */
export function formatDayMonth(date: Date): string {
  return utcFormat(date, "d MMM");
}

/** Full weekday and day for a heading: `Tuesday, 12 October`. */
export function formatWeekdayLong(date: Date): string {
  return utcFormat(date, "EEEE, d MMMM");
}

// ---------------------------------------------------------------------------
// Real instants
//
// The formatters above read the UTC calendar day, which is the right answer for
// a `@db.Date` column. A `DateTime` column is a different thing: it is a real
// moment, and the person reading it wants *their* wall clock, not a UTC one. The
// `Local*` names below say so at the call site, which is the only place anyone
// will notice a mistake.
// ---------------------------------------------------------------------------

/** `12 Oct` from a real instant, in the reader's own timezone. */
export function formatLocalDayMonth(date: Date): string {
  return format(date, "d MMM");
}

/** `4:05 PM` from a real instant, in the reader's own timezone. */
export function formatLocalClockTime(date: Date): string {
  return format(date, "h:mm a");
}

/** `16:05` from a real instant, for 24-hour layouts. */
export function formatLocalClock24(date: Date): string {
  return format(date, "HH:mm");
}

/** `Mon 4:05 PM`, for a sentence that needs the day and the time together. */
export function formatLocalWeekdayClock(date: Date): string {
  return format(date, "EEE h:mm a");
}

/**
 * The seven days of the week containing `anchor`, Sunday first.
 *
 * Returned as UTC midnights because that is the form the rest of the app queries
 * with. A week starting on Sunday is a *display* choice; a week stored as UTC
 * midnights is a *storage* choice, and the two must not be confused.
 */
export function indianWeek(anchor: Date): Date[] {
  const day = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()),
  );
  // getUTCDay is already 0 for Sunday, which is the desired week start.
  const back = day.getUTCDay();
  const start = new Date(day.getTime() - back * 86_400_000);

  return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 86_400_000));
}
