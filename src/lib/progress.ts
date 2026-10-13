/**
 * Progress and momentum across the Goal -> Project -> Task -> Focus hierarchy.
 *
 * Two different ideas of "progress" live in this app and they are deliberately
 * kept apart:
 *
 *   1. `Goal.progress` is a *stated* figure the user sets by hand ("I'm about 60%
 *      through this"). It is stored on the row on purpose, because subjective
 *      progress cannot be derived from a task list. See `app/api/v1/goals`.
 *   2. This module computes the *derived* figure: what share of the milestones
 *      and tasks behind a goal are actually closed.
 *
 * Reconciling them is the point. Where the two disagree the gap is surfaced
 * rather than one silently overwriting the other, because "my tasks all say done
 * but I still call this 40%" is a real and useful thing to be able to see.
 *
 * Project progress already has a derived implementation in `@/lib/projects/
 * progress`; that is re-exported here rather than reimplemented so there is
 * exactly one definition of it in the codebase.
 *
 * Everything here is a pure function over already-fetched rows, so it is
 * importable from a server component, an API route or a test without a client.
 */

import { progressFromTasks } from "@/lib/projects/progress";

export { progressFromTasks };
export type { ProjectProgress, ProjectTaskLinkLike } from "@/lib/projects/progress";

/** Milestone statuses that count as closed. A blocked milestone is not. */
const CLOSED_MILESTONE_STATUSES = new Set(["DONE"]);

export interface TaskRollupLike {
  status: string;
  completedAt?: Date | string | null;
}

export interface MilestoneRollupLike {
  status: string;
  completedAt?: Date | string | null;
}

export interface GoalWorkProgress {
  tasksDone: number;
  tasksTotal: number;
  tasksPercent: number | null;
  milestonesDone: number;
  milestonesTotal: number;
  milestonesPercent: number | null;
  /**
   * The blended derived figure, or `null` when there is nothing to measure.
   * `null` is not the same as 0: a goal with no milestones and no tasks has not
   * been shown to be un-started, it simply has no work attached yet, and
   * rendering it as "0% complete" would be asserting something untrue.
   */
  derivedPercent: number | null;
  /** Stated minus derived, in points. `null` when derived is unknown. */
  driftFromStated: number | null;
  /** True when the stated figure is at least this far from derived. */
  isDrifting: boolean;
}

/** How far stated and derived may sit apart before it is worth mentioning. */
export const DRIFT_THRESHOLD = 15;

function percent(done: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((done / total) * 100);
}

/**
 * Blends milestone and task progress into one derived number.
 *
 * Milestones are weighted slightly higher because they are the coarser unit of
 * intent: finishing every task under a milestone you never advanced is not the
 * same as advancing the milestone. A goal with only one of the two available
 * falls back to that one rather than averaging in a zero.
 */
export function goalWorkProgress(input: {
  statedPercent: number;
  tasks: TaskRollupLike[];
  milestones: MilestoneRollupLike[];
}): GoalWorkProgress {
  const tasks = input.tasks;
  const milestones = input.milestones;

  // CANCELLED and ARCHIVED tasks stay in the denominator. Dropping them would let
  // a cancelled task inflate the percentage by vanishing from the count.
  const tasksTotal = tasks.length;
  const tasksDone = tasks.filter((t) => t.status === "DONE").length;

  const milestonesTotal = milestones.length;
  const milestonesDone = milestones.filter((m) =>
    CLOSED_MILESTONE_STATUSES.has(m.status),
  ).length;

  const tasksPercent = percent(tasksDone, tasksTotal);
  const milestonesPercent = percent(milestonesDone, milestonesTotal);

  let derivedPercent: number | null = null;
  if (tasksPercent !== null && milestonesPercent !== null) {
    derivedPercent = Math.round(tasksPercent * 0.4 + milestonesPercent * 0.6);
  } else if (tasksPercent !== null) {
    derivedPercent = tasksPercent;
  } else if (milestonesPercent !== null) {
    derivedPercent = milestonesPercent;
  }

  const driftFromStated = derivedPercent === null ? null : input.statedPercent - derivedPercent;

  return {
    tasksDone,
    tasksTotal,
    tasksPercent,
    milestonesDone,
    milestonesTotal,
    milestonesPercent,
    derivedPercent,
    driftFromStated,
    isDrifting: driftFromStated !== null && Math.abs(driftFromStated) >= DRIFT_THRESHOLD,
  };
}

export type MomentumDirection = "up" | "down" | "flat" | "unknown";

export interface Momentum {
  /** Tasks completed in the trailing window. */
  completedRecent: number;
  /** Tasks completed in the window immediately before it. */
  completedPrior: number;
  /** recent / prior, or `null` when the prior window has nothing to divide by. */
  ratio: number | null;
  direction: MomentumDirection;
  focusMinutesRecent: number;
  focusMinutesPrior: number;
}

export interface MomentumLike {
  tasks: TaskRollupLike[];
  focusSessions: { startedAt: Date | string; actualSeconds: number }[];
  /** Trailing window length. Defaults to 7 days. */
  windowDays?: number;
  /** The `now` the windows are measured back from. Injectable for tests. */
  now?: Date;
}

const DAY_MS = 86_400_000;

function toMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function windowCount(
  rows: { at: Date | string }[],
  from: number,
  to: number,
): number {
  let n = 0;
  for (const row of rows) {
    const at = toMs(row.at);
    if (at >= from && at < to) n += 1;
  }
  return n;
}

/**
 * Sums the *duration* of the rows in a window, in minutes.
 *
 * Deliberately not `windowCount`. These two were originally the same function and
 * it made the dashboard report "1 min focused" for a 25-minute session, which is
 * the kind of quiet inaccuracy that undermines every other number beside it.
 * Sessions with no recorded time are skipped rather than counted as zero-minute
 * sessions, so an abandoned timer does not dilute the average.
 */
function windowFocusMinutes(
  rows: { startedAt: Date | string; actualSeconds: number }[],
  from: number,
  to: number,
): number {
  let seconds = 0;
  for (const row of rows) {
    const at = toMs(row.startedAt);
    if (at >= from && at < to && row.actualSeconds > 0) seconds += row.actualSeconds;
  }
  return Math.round(seconds / 60);
}

/**
 * Recent-vs-prior comparison, so a screen can say "you closed 7 last week, 2 the
 * week before" rather than only ever showing a total.
 *
 * The prior window is the control: a bare count of 7 completions means nothing
 * without knowing whether last week was 3. Where the prior window is empty the
 * ratio is `null` and the direction is reported as `unknown` unless there is
 * recent activity to describe, because "up from zero" is not a trend.
 */
export function momentum(input: MomentumLike): Momentum {
  const windowDays = input.windowDays ?? 7;
  const now = input.now ?? new Date();
  const nowMs = now.getTime();

  const recentFrom = nowMs - windowDays * DAY_MS;
  const priorFrom = nowMs - 2 * windowDays * DAY_MS;

  // Only closed tasks count, and they count on the day they were actually closed
  // rather than the day they were created, which is what makes the comparison
  // honest about *throughput* rather than intake.
  const closed = input.tasks.filter(
    (t) => t.status === "DONE" && t.completedAt != null,
  );
  const closedAt = closed.map((t) => ({ at: t.completedAt! }));

  const completedRecent = windowCount(closedAt, recentFrom, nowMs);
  const completedPrior = windowCount(closedAt, priorFrom, recentFrom);

  const focusRecent = windowFocusMinutes(input.focusSessions, recentFrom, nowMs);
  const focusPrior = windowFocusMinutes(input.focusSessions, priorFrom, recentFrom);

  let ratio: number | null = null;
  let direction: MomentumDirection = "unknown";

  if (completedPrior > 0) {
    ratio = completedRecent / completedPrior;
    // A 10% band either way is treated as flat, otherwise ordinary noise reads as
    // a trend and the dashboard starts asserting momentum that is not there.
    if (ratio >= 1.1) direction = "up";
    else if (ratio <= 0.9) direction = "down";
    else direction = "flat";
  } else if (completedRecent > 0) {
    // Something closed where the previous window had nothing: a genuine change,
    // reported as up without a fabricated ratio.
    direction = "up";
  }

  return {
    completedRecent,
    completedPrior,
    ratio,
    direction,
    focusMinutesRecent: focusRecent,
    focusMinutesPrior: focusPrior,
  };
}

export interface HierarchyRollup {
  goals: {
    id: string;
    statedPercent: number;
    progress: GoalWorkProgress;
    /** Projects and tasks reachable from this goal, for the tree view. */
    projects: { id: string; name: string; progress: ReturnType<typeof progressFromTasks> }[];
  }[];
  /** Aggregate across every goal passed in. */
  overall: {
    statedPercent: number;
    derivedPercent: number | null;
    drifting: number;
  };
}

/**
 * Rolls a set of goals up into the shape the dashboard and goal board both want.
 * Unmeasured goals are excluded from the overall derived average rather than
 * counted as zero, so a fresh account does not read as "0% across the board".
 */
export function hierarchyRollup(
  goals: {
    id: string;
    name?: string;
    progress: number;
    milestones: MilestoneRollupLike[];
    tasks: TaskRollupLike[];
    projects: { id: string; name: string; tasks: { task: { status: string } }[] }[];
  }[],
): HierarchyRollup {
  const mapped = goals.map((g) => {
    const progress = goalWorkProgress({
      statedPercent: g.progress,
      tasks: g.tasks,
      milestones: g.milestones,
    });
    return {
      id: g.id,
      statedPercent: g.progress,
      progress,
      projects: g.projects.map((p) => ({
        id: p.id,
        name: p.name,
        progress: progressFromTasks(p.tasks),
      })),
    };
  });

  const measured = mapped.filter((g) => g.progress.derivedPercent !== null);
  const stated = mapped.length
    ? Math.round(mapped.reduce((sum, g) => sum + g.statedPercent, 0) / mapped.length)
    : 0;
  const derived = measured.length
    ? Math.round(
        measured.reduce((sum, g) => sum + g.progress.derivedPercent!, 0) /
          measured.length,
      )
    : null;

  return {
    goals: mapped,
    overall: {
      statedPercent: stated,
      derivedPercent: derived,
      drifting: mapped.filter((g) => g.progress.isDrifting).length,
    },
  };
}
