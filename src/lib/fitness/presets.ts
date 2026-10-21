/**
 * Client-safe fitness constants.
 *
 * Deliberately not in `./server.ts`, which is `server-only` and would drag the
 * Prisma client into a client bundle. These are plain data shared by the weekly
 * planner UI and (where useful) the seed.
 */

/**
 * The muscle-group presets offered when scheduling a day.
 *
 * These are labels, not the `MuscleGroup` enum. A training week groups muscles
 * the way a person says them out loud — "Chest", "Triceps", "Abs", "Mobility" —
 * which is finer-grained than the exerciselibrary's enum (where Biceps and
 * Triceps both live under ARMS). The planner lets a user pick from this list or
 * type their own, and the labels are stored as strings on the workout.
 */
export const MUSCLE_GROUP_PRESETS = [
  "Chest",
  "Back",
  "Shoulders",
  "Biceps",
  "Triceps",
  "Legs",
  "Glutes",
  "Abs",
  "Core",
  "Cardio",
  "Full Body",
  "Mobility",
  "Rest Day",
] as const;

export type MuscleGroupPreset = (typeof MUSCLE_GROUP_PRESETS)[number];

/**
 * The seven weekdays, Monday first.
 *
 * `index` is the stored `WorkoutRoutineDay.weekday` (0 = Monday .. 6 = Sunday),
 * so a component never has to convert. This is the one place the Monday-first
 * convention is spelled out; everything else reads it from here.
 */
export const WEEKDAYS = [
  { index: 0, short: "Mon", long: "Monday" },
  { index: 1, short: "Tue", long: "Tuesday" },
  { index: 2, short: "Wed", long: "Wednesday" },
  { index: 3, short: "Thu", long: "Thursday" },
  { index: 4, short: "Fri", long: "Friday" },
  { index: 5, short: "Sat", long: "Saturday" },
  { index: 6, short: "Sun", long: "Sunday" },
] as const;

/** Short weekday label (`Mon`) for a stored weekday index. */
export function weekdayShort(weekday: number): string {
  return WEEKDAYS[((weekday % 7) + 7) % 7]!.short;
}

/** Long weekday label (`Monday`) for a stored weekday index. */
export function weekdayLong(weekday: number): string {
  return WEEKDAYS[((weekday % 7) + 7) % 7]!.long;
}

/** Sensible default names offered when a user creates a routine day. */
export const WORKOUT_NAME_PRESETS = [
  "Push",
  "Pull",
  "Legs",
  "Upper",
  "Lower",
  "Full Body",
  "Cardio",
  "Mobility",
  "Rest",
] as const;
