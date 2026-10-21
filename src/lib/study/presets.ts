/**
 * Client-safe study constants.
 *
 * Deliberately not in `./server.ts`, which is `server-only` and would drag the
 * Prisma client into a client bundle. These are plain data shared by the study
 * timetable UI and the seed.
 */

/**
 * The seven weekdays, Monday first.
 *
 * `jsDay` is the stored weekday index: 0 = Sunday .. 6 = Saturday, matching
 * `Date.getDay()` and the same convention as `HabitSchedule.dayOfWeek`,
 * `WeeklyPlanDay.dayOfWeek` and `WeeklyPlanTask.dayOfWeek`. The study timetable
 * links to habits and to weekly plans, so it has to agree with them.
 *
 * `WorkoutRoutineDay.weekday` disagrees - it counts 0 = Monday - and that is a
 * different feature with its own constant in `fitness/presets`. Two constants
 * exist rather than one shared one because the two features are read by
 * different people at different times, and a single shared constant would have
 * to pick a winner.
 */
export const STUDY_WEEKDAYS = [
  { jsDay: 1, short: "Mon", long: "Monday" },
  { jsDay: 2, short: "Tue", long: "Tuesday" },
  { jsDay: 3, short: "Wed", long: "Wednesday" },
  { jsDay: 4, short: "Thu", long: "Thursday" },
  { jsDay: 5, short: "Fri", long: "Friday" },
  { jsDay: 6, short: "Sat", long: "Saturday" },
  { jsDay: 0, short: "Sun", long: "Sunday" },
] as const;

/** Short weekday label (`Mon`) for a stored JS weekday index. */
export function weekdayShort(jsDay: number): string {
  return STUDY_WEEKDAYS.find((d) => d.jsDay === jsDay)?.short ?? "—";
}

/** Long weekday label (`Monday`) for a stored JS weekday index. */
export function weekdayLong(jsDay: number): string {
  return STUDY_WEEKDAYS.find((d) => d.jsDay === jsDay)?.long ?? "—";
}

/**
 * Subjects offered when creating a session.
 *
 * Free text is always allowed - this is a starting point, not a taxonomy. The
 * list matches the shape of the example timetable in the feature brief so a new
 * user can build a whole week without typing anything.
 */
export const STUDY_SUBJECT_PRESETS = [
  "DSA",
  "DBMS",
  "GATE C Programming",
  "Java",
  "SQL Practice",
  "Revision",
  "Practice Tests",
  "Reading",
  "Networking",
  "Operating Systems",
] as const;

/** Colours a session card can carry, matching the habit palette. */
export const STUDY_COLOR_PRESETS = [
  "#C8F751",
  "#7C6BFF",
  "#4ECDC4",
  "#FFB020",
  "#FF6B6B",
  "#5BA8FF",
] as const;

/**
 * How far ahead a recurring series is materialised.
 *
 * Six weeks is long enough to plan a term and short enough that a series the
 * user has quietly abandoned does not leave a year of empty rows behind. The
 * horizon rolls forward, so a series keeps producing sessions without the user
 * having to touch it.
 */
export const STUDY_HORIZON_WEEKS = 6;
