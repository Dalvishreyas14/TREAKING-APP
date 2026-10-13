/**
 * What a weekly plan has actually achieved.
 *
 * This module is the single definition of "actual" and "progress" for a plan. It
 * is pure — no Prisma, no clock, no I/O — because these numbers are read by the
 * board, the dashboard panel, the analytics chart and the weekly review, and four
 * implementations of the same subtraction is how a tracker starts lying.
 *
 * The inputs are deliberately narrow and pre-filtered by the caller. Whoever loads
 * them owns the range query; this function owns the arithmetic. That split is what
 * lets the maths be tested without a database and reused by a page and an API
 * route without either duplicating it.
 *
 * ## Where "actual" comes from
 *
 * `HOURS` sums `FocusSession.actualSeconds` for tasks in the plan. That is the only
 * honest source available, and it is worth being explicit about why:
 * `Task.actualMinutes` exists as a column but is never written by any code path in
 * the app — focus completion updates `FocusSession` and `UserStats.focusMinutes`,
 * never the task — so reading it would report zero hours for every plan forever.
 * The same reasoning appears in `src/app/(app)/study/page.tsx`, which prefers focus
 * sessions over self-reported timers for exactly this reason.
 *
 * The consequence is stated in the UI rather than hidden: time worked without
 * starting a timer contributes nothing. That is a true statement about the data,
 * not an approximation of it.
 */

import { daysElapsed, windowPace, type WeekBounds } from "@/lib/weekly-plans/week";

/** Mirrors the Prisma enum. Duplicated as a union so this module needs no client import. */
export type PlanTargetType = "HOURS" | "SESSIONS" | "TASKS" | "COUNT";
export type PlanCategory = "STUDY" | "FITNESS" | "PERSONAL" | "WORK" | "PROJECT" | "CUSTOM";

/** The minimal plan shape the arithmetic needs. */
export interface PlanTarget {
  targetType: PlanTargetType;
  /**
   * Required, not optional, even though `COUNT`, `HOURS` and `TASKS` ignore it.
   *
   * It is required because a default would be a claim: defaulting to `CUSTOM` would
   * silently make every `SESSIONS` plan unmeasurable, and defaulting to `FITNESS`
   * would silently measure study weeks against habit logs. Making the caller state
   * which measurement applies is what keeps `SESSIONS` honest.
   */
  category: PlanCategory;
  targetValue: number;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
}

export interface PlanTaskInput {
  id: string;
  status: string;
  completedAt: Date | null;
}

export interface PlanHabitLogInput {
  habitId: string;
  date: Date;
  completed: boolean;
  /** `HabitLog.value`, i.e. pages/km/ml/min as the habit configured it. */
  value: number;
}

export interface PlanFocusSessionInput {
  taskId: string | null;
  startedAt: Date;
  actualSeconds: number;
  /** False while a session is still running; those contribute nothing. */
  ended: boolean;
}

export interface PlanProgressInput {
  plan: PlanTarget;
  bounds: WeekBounds;
  /** Today, UTC midnight. Passed in so the result is deterministic under test. */
  today: Date;
  tasks: PlanTaskInput[];
  habits: PlanHabitLogInput[];
  focusSessions: PlanFocusSessionInput[];
  /**
   * User-reported progress for a `COUNT` plan. Null means "not reported", which is
   * deliberately distinct from 0 — a plan the user has not ticked off yet has not
   * made no progress, it has an unknown amount.
   */
  manualActual?: number | null;
}

/** Derived numbers for one plan. Every field is directly displayable. */
export interface PlanProgress {
  /** The unit the target is denominated in, for labelling. */
  unit: "hours" | "sessions" | "tasks" | "count";
  /** Achieved amount, rounded to at most one decimal place. */
  actual: number;
  target: number;
  remaining: number;
  /** `actual / target` as a 0-1 fraction, or null when there is no target to hit. */
  percent: number | null;
  /** Days of the window already elapsed, and how many remain. */
  elapsed: number;
  remainingDays: number;
  totalDays: number;
  /** How far through the window the calendar is, or null before it opens. */
  pace: number | null;
  /** `pace` minus `percent`, the signal that says ahead or behind. */
  aheadBy: number | null;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
  /** False when the target cannot be measured from data at all. */
  measurable: boolean;
  /**
   * Why `measurable` is false, in words the UI can show. Empty when it is true.
   * A `COUNT` plan carries no measurement path, and saying so beats reporting a
   * percentage the app invented.
   */
  reason: string;
}

const MINUTES_PER_HOUR = 60;
const SECONDS_PER_HOUR = 3600;

/** Round to one decimal, avoiding the float noise that `7.3 + 0.7` exposes. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Sum the focused seconds that belong to this plan and fell inside its window.
 *
 * Only *ended* sessions count. A running session has `actualSeconds` still at its
 * default 0, so counting it would add nothing today and would make the figure jump
 * once it ends — a progress bar that moves on its own looks broken.
 */
export function focusedHours(
  sessions: PlanFocusSessionInput[],
  bounds: WeekBounds,
): number {
  const from = bounds.start.getTime();
  const to = bounds.end.getTime() + 24 * 60 * 60 * 1000;
  const seconds = sessions
    .filter((s) => s.ended && s.taskId !== null)
    .filter((s) => s.startedAt.getTime() >= from && s.startedAt.getTime() < to)
    .reduce((total, s) => total + s.actualSeconds, 0);
  return seconds / SECONDS_PER_HOUR;
}

/**
 * Count the finished focus sessions that belong to this plan and fell inside its
 * window.
 *
 * The same filter as `focusedHours`, counted rather than summed, so a study plan
 * measured in sessions and a study plan measured in hours agree about what
 * happened — they read one set of rows and differ only in the arithmetic. Sharing
 * the predicate is deliberate: two independent implementations of "which sessions
 * count" is how two cards on the same page end up disagreeing.
 *
 * Named `focusSessionCount` rather than `focusSessions` because `focusSessions` is
 * already the input field name, and inside `measure` a bare `focusSessions(...)`
 * would resolve to the array rather than to this function.
 */
export function focusSessionCount(
  sessions: PlanFocusSessionInput[],
  bounds: WeekBounds,
): number {
  const from = bounds.start.getTime();
  const to = bounds.end.getTime() + 24 * 60 * 60 * 1000;
  return sessions.filter(
    (s) =>
      s.ended &&
      s.taskId !== null &&
      s.startedAt.getTime() >= from &&
      s.startedAt.getTime() < to,
  ).length;
}

/**
 * Count completed habit logs on the plan's habits within the window.
 *
 * A log counts when it is `completed` **or** carries a positive `value`, which is
 * the same rule `fitness/page.tsx` applies to its headline total. Matching it is
 * the point: a plan pointing at the "Gym" habit and the Fitness page pointing at
 * the same habit must not disagree about how many sessions it holds, because a
 * user comparing the two screens has no way to tell which one is wrong.
 *
 * So a 5km run logged short of a "done" tick counts as a session here. That is not
 * a loosening of this function to suit the plan — it is the same measurement the
 * Fitness page already publishes, and inventing a stricter rule for plans alone
 * would be the second source of truth this module exists to avoid.
 *
 * `completed` is still checked alongside `value` rather than ignored: a `COUNT`
 * habit can log a partial effort with `completed: false`, and `value > 0` is what
 * distinguishes real partial work from an empty row.
 */
export function habitSessions(
  logs: PlanHabitLogInput[],
  bounds: WeekBounds,
): number {
  const from = bounds.start.getTime();
  const to = bounds.end.getTime() + 24 * 60 * 60 * 1000;
  return logs.filter(
    (log) =>
      (log.completed || log.value > 0) &&
      log.date.getTime() >= from &&
      log.date.getTime() < to,
  ).length;
}

/** Completed linked tasks. Counted, not timed — `TASKS` targets are about finishing. */
export function completedTasks(tasks: PlanTaskInput[]): number {
  return tasks.filter((t) => t.status === "DONE").length;
}

/**
 * Derive everything displayable about a plan's progress.
 *
 * Two behaviours here are load-bearing and both exist to avoid a number that
 * means something other than what it appears to mean:
 *
 * 1. **Progress over 100% is allowed and not clamped.** Overshooting a weekly
 *    target is a good outcome, and clamping it to 100% discards the difference
 *    between "just met it" and "did 12 hours against a 5 hour plan". The bar
 *    renders full; the text says the real figure.
 * 2. **A zero or negative target yields `percent: null`, not `Infinity`.** A plan
 *    created without a target is a real state (structure before commitments), and
 *    the honest rendering is "no target set" rather than a division by zero.
 */
export function planProgress(input: PlanProgressInput): PlanProgress {
  const { plan, bounds, today } = input;
  const { elapsed, remaining: remainingDays, total } = daysElapsed(bounds, today);
  const pace = windowPace(bounds, today);

  const actual = measure(input);
  const target = plan.targetValue > 0 ? plan.targetValue : 0;
  const remaining = Math.max(target - actual, 0);
  const percent = target > 0 ? actual / target : null;

  return {
    unit: unitFor(plan.targetType),
    actual: round1(actual),
    target: round1(target),
    remaining: round1(remaining),
    percent,
    elapsed,
    remainingDays,
    totalDays: total,
    pace,
    aheadBy: percent !== null && pace !== null ? percent - pace : null,
    status: plan.status,
    measurable: measurable(plan),
    reason: reason(plan, actual),
  };
}

/**
 * The achieved amount in the plan's own unit.
 *
 * `SESSIONS` picks its source from the plan's category, because "session" means
 * two different things and neither is a generalisation of the other. A gym week is
 * counted by completed habit logs, the way the Fitness page counts. A study week is
 * counted by finished focus sessions, the way the Study page counts — and study
 * work is not something a habit log records, so measuring it against habits would
 * report zero however much was studied. Counting study hours against habit logs is
 * the exact mistake this branch exists to prevent.
 */
function measure(input: PlanProgressInput): number {
  const { plan, bounds, tasks, habits, focusSessions, manualActual } = input;
  switch (plan.targetType) {
    case "HOURS":
      return focusedHours(focusSessions, bounds);
    case "SESSIONS":
      switch (plan.category) {
        case "FITNESS":
          return habitSessions(habits, bounds);
        case "STUDY":
          return focusSessionCount(focusSessions, bounds);
        default:
          // Not measurable rather than wrongly measured. The caller surfaces this as
          // `measurable: false` with a reason; returning a plausible-looking number
          // here would be the worse failure, because nothing downstream would flag it.
          return 0;
      }
    case "TASKS":
      return completedTasks(tasks);
    case "COUNT":
      return manualActual ?? 0;
  }
}

function unitFor(type: PlanTargetType): PlanProgress["unit"] {
  switch (type) {
    case "HOURS":
      return "hours";
    case "SESSIONS":
      return "sessions";
    case "TASKS":
      return "tasks";
    case "COUNT":
      return "count";
  }
}

/** The categories whose `SESSIONS` target has a real measurement behind it. */
const SESSION_MEASURABLE: ReadonlySet<PlanCategory> = new Set(["FITNESS", "STUDY"]);

/**
 * Whether the app can measure this target from real data.
 *
 * Two cases cannot be measured:
 *
 * - `COUNT`, whose unit is whatever the user says it is — pages, reps, books — and
 *   which nothing in the schema records.
 * - `SESSIONS` on a category that is neither FITNESS nor STUDY. Habit logs and focus
 *   sessions are the only two things this app calls a session, and neither is a
 *   defensible stand-in for a work or personal week. The API refuses to create that
 *   combination; this exists so a plan that reached the table another way still says
 *   so out loud instead of showing a confident zero.
 */
function measurable(plan: PlanTarget): boolean {
  if (plan.targetType === "COUNT") return false;
  if (plan.targetType === "SESSIONS") return SESSION_MEASURABLE.has(plan.category);
  return true;
}

/**
 * The caveat a card must show, in a sentence fit for it.
 *
 * Two independent things can leave a card needing an explanation: the target
 * cannot be measured from real data at all, or nothing has happened yet. The
 * measurement caveat takes priority because it is true whether or not a number is
 * currently on screen — a `COUNT` plan showing "120 / 300" is still a number the
 * user typed, and a card that only disclosed that when the count was 0 would be
 * lying exactly when the figure looks most authoritative.
 *
 * Returns "" when there is nothing worth explaining, so the caller can render it
 * unconditionally and it simply disappears.
 */
function reason(plan: PlanTarget, actual: number): string {
  if (actual > 0 && measurable(plan)) return "";
  switch (plan.targetType) {
    case "COUNT":
      // Stated whether or not a figure is on screen: a `COUNT` plan reading
      // "120 / 300" is still a number the user typed, and disclosing that only
      // while it reads 0 would be lying exactly when the figure looks most
      // authoritative.
      return "Add your own count — this app cannot measure it for you.";
    case "HOURS":
      return "No focus time logged on this plan's tasks yet. Start a focus session to count here.";
    case "SESSIONS":
      // Stated per category, because "your habits" is only true of a fitness plan and
      // would send a study-week user to a habit tracker to fix a focus timer.
      switch (plan.category) {
        case "FITNESS":
          return "No completed sessions on this plan's habits yet.";
        case "STUDY":
          return "No finished focus sessions on this plan's tasks yet. Start one to count here.";
        default:
          // Unmeasurable, not merely empty. Offering this at all is a mistake, and
          // saying why is more useful than a zero that looks like a missed week.
          return "Sessions are only measured for study and fitness plans. Change the target type to count something this app can read.";
      }
    case "TASKS":
      return "No linked tasks finished yet.";
  }
}

/**
 * Minutes -> hours, for a plan whose tasks estimate their own time.
 *
 * Not used by `planProgress` (which reads real elapsed seconds) but needed where
 * a plan wants to suggest a target: summing `Task.estimatedMinutes` is the only
 * honest way to suggest "5 hours" without inventing a number.
 */
export function estimatedHoursFromTasks(tasks: { estimatedMinutes: number | null }[]): number {
  const minutes = tasks.reduce(
    (total, t) => total + (t.estimatedMinutes ?? 0),
    0,
  );
  return round1(minutes / MINUTES_PER_HOUR);
}

/**
 * How far along the plan is, in words.
 *
 * Two things matter more than the percentage: being behind the calendar, and
 * having an unmeasurable target. Both are surfaced as text rather than left for
 * the reader to infer from a bar.
 */
export function paceLabel(progress: PlanProgress): string {
  if (!progress.measurable) {
    return "Measured by you";
  }
  if (progress.elapsed === 0) {
    return "Not started";
  }
  if (progress.percent === null) {
    return "No target set";
  }
  if (progress.remainingDays === 0) {
    return progress.percent >= 1 ? "Met" : "Ended short";
  }
  if (progress.aheadBy === null) return "In progress";
  // A 10-point cushion, matching the rule in `goals/page.tsx`. Tighter than that
  // and a plan sitting exactly on pace gets flagged, which trains people to
  // ignore the flag.
  if (progress.aheadBy > 0.1) return "Ahead of pace";
  if (progress.aheadBy < -0.1) return "Behind pace";
  return "On pace";
}