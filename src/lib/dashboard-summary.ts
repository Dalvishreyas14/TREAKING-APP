/**
 * Analytical panels for the dashboard, derived from a `LifeSnapshot`.
 *
 * These are deliberately pure functions over the snapshot rather than queries
 * inside the page component. The dashboard was previously a wall of direct
 * `prisma` calls, which meant the same number could be computed two different
 * ways in two different files and quietly disagree. Analysing the snapshot that
 * every other AI surface already reads keeps one definition of "this week".
 *
 * Three rules run through the whole module:
 *
 *   1. Below a minimum sample, return `null` and say what is missing. A
 *      correlation over four days is arithmetically computable and useless.
 *   2. Never imply causation. Everything here is phrased as "moves with",
 *      because that is the only claim the arithmetic supports.
 *   3. An unmeasured value is `null`, never 0. "No habits tracked" and "0%
 *      completion" are different facts and collapsing them tells a user their
 *      empty account is a failing one.
 */

import { correlation, confidenceFrom, mean } from "@/lib/ai/stats";
import type { LifeSnapshot } from "@/lib/ai/snapshot";
import { dateOnly } from "@/lib/date";
import { momentum, type Momentum } from "@/lib/progress";

/**
 * Paired observations needed before a correlation is reported. Twelve is the
 * same floor `confidenceFrom` defaults to, chosen so a "weekday vs weekend"
 * claim has enough points on each side to mean anything.
 */
export const MIN_PAIR_SAMPLES = 12;

/** Below this |r| the two series are treated as unrelated, whatever p would say. */
export const MIN_CORRELATION = 0.25;

function dayKey(date: Date): number {
  return dateOnly(date).getTime();
}

// ---------------------------------------------------------------- goal panel

export interface GoalPanelEntry {
  id: string;
  title: string;
  status: string;
  /** What the user says. */
  stated: number;
  /** What the work says, or null when nothing is attached. */
  derived: number | null;
  /** Stated minus derived. */
  drift: number | null;
  isDrifting: boolean;
  taskCount: number;
  doneTaskCount: number;
  milestoneCount: number;
  doneMilestoneCount: number;
}

export interface GoalPanel {
  entries: GoalPanelEntry[];
  statedAverage: number;
  derivedAverage: number | null;
  /** How many goals are live, i.e. worth showing at all. */
  activeCount: number;
  driftingCount: number;
}

/**
 * States each goal twice — as the user rated it and as its work measures out —
 * and flags the gap. A goal at 90% with every task still open is a real and
 * common situation, and hiding it behind one number is how a tracker starts
 * lying to its owner.
 */
export function goalPanel(snapshot: LifeSnapshot): GoalPanel {
  const entries: GoalPanelEntry[] = snapshot.goals.map((g) => ({
    id: g.id,
    title: g.title,
    status: g.status,
    stated: g.progress,
    derived: g.derived.derivedPercent,
    drift: g.derived.driftFromStated,
    isDrifting: g.derived.isDrifting,
    taskCount: g.taskCount,
    doneTaskCount: g.doneTaskCount,
    milestoneCount: g.milestoneCount,
    doneMilestoneCount: g.doneMilestoneCount,
  }));

  const live = entries.filter((e) => e.status === "ACTIVE");
  const measured = live.filter((e) => e.derived !== null);

  return {
    entries: live,
    statedAverage:
      live.length === 0
        ? 0
        : Math.round(live.reduce((sum, e) => sum + e.stated, 0) / live.length),
    // Averaged over the measured goals only. Including unmeasured ones as zero
    // would report a brand new account as "0% across all your goals".
    derivedAverage:
      measured.length === 0
        ? null
        : Math.round(measured.reduce((sum, e) => sum + e.derived!, 0) / measured.length),
    activeCount: live.length,
    driftingCount: live.filter((e) => e.isDrifting).length,
  };
}

// ------------------------------------------------------------- project panel

export interface ProjectPanelEntry {
  id: string;
  name: string;
  status: string;
  goalTitle: string | null;
  taskCount: number;
  doneTaskCount: number;
  percent: number;
  /** Total focus seconds attributed to this project in the window. */
  focusSeconds: number;
  momentum: Momentum;
}

export interface ProjectPanel {
  entries: ProjectPanelEntry[];
  /** Share of window focus that landed on a project at all. */
  attributedFocusSeconds: number;
  unattributedFocusSeconds: number;
}

/**
 * Per-project progress, the goal it serves, the focus time it absorbed and
 * whether that throughput is rising.
 *
 * Focus is attributed by the session's own `projectId` when it has one, and
 * otherwise by the project the session's task belongs to. Unattributed time is
 * reported rather than spread evenly, because "60% of your focus went nowhere
 * in particular" is information worth having.
 */
export function projectPanel(snapshot: LifeSnapshot): ProjectPanel {
  const windowDays = Math.max(
    1,
    Math.round((snapshot.to.getTime() - snapshot.from.getTime()) / 86_400_000) + 1,
  );

  // The project's own tasks, never the whole snapshot. Handing every project the
  // full task list reports the user's total throughput as if each project had
  // earned it, so a user with one active project and a pile of unrelated tasks
  // would see that project credited with all of them.
  const projectMomentum = (projectId: string): Momentum => {
    const project = snapshot.projects.find((p) => p.id === projectId);
    const sessions = snapshot.focusSessions.filter(
      (f) => f.projectId === projectId && f.actualSeconds > 0,
    );
    return momentum({
      tasks: project?.tasks ?? [],
      focusSessions: sessions,
      windowDays,
      now: snapshot.to,
    });
  };

  const entries: ProjectPanelEntry[] = snapshot.projects.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    goalTitle: p.goalTitle,
    taskCount: p.taskCount,
    doneTaskCount: p.doneTaskCount,
    percent:
      p.taskCount === 0 ? 0 : Math.round((p.doneTaskCount / p.taskCount) * 100),
    focusSeconds: p.focusSeconds,
    momentum: projectMomentum(p.id),
  }));

  const attributed = entries.reduce((sum, e) => sum + e.focusSeconds, 0);

  // Both sides of this subtraction are seconds, over the same window. It was
  // previously a count of sessions minus a sum of seconds, which went negative
  // on any user with long sessions and was then clamped to zero - hiding the
  // unattributed time rather than reporting it.
  const total = snapshot.focusSessions.reduce(
    (sum, f) =>
      f.actualSeconds > 0 && f.startedAt >= snapshot.from && f.startedAt <= snapshot.to
        ? sum + f.actualSeconds
        : sum,
    0,
  );

  return {
    entries,
    attributedFocusSeconds: attributed,
    unattributedFocusSeconds: Math.max(total - attributed, 0),
  };
}

// ----------------------------------------------------------- track summaries

export interface TrackSummary {
  kind: "FITNESS" | "STUDY";
  habitCount: number;
  /** Share of scheduled habit-days completed, or null when unmeasured. */
  completion: number | null;
  /** Minutes of time blocked for this track in the window. */
  blockedMinutes: number;
  /** True when the track has nothing attached and the panel should stay quiet. */
  empty: boolean;
}

/**
 * Fitness and study, both of which the app models as habits under a category
 * rather than as their own tables. Summarised here so the dashboard can show
 * them without duplicating the derivation the dedicated pages already own.
 */
export function trackSummary(
  snapshot: LifeSnapshot,
  kind: "FITNESS" | "STUDY",
): TrackSummary {
  const habits = snapshot.habits.filter(
    (h) => h.categoryId !== null && h.categoryKind === kind,
  );
  const ids = new Set(habits.map((h) => h.id));

  const logs = snapshot.habitLogs.filter((l) => ids.has(l.habitId));
  const completed = logs.filter((l) => l.completed).length;

  // Blocked time is matched on the block title because a TimeBlock carries no
  // category of its own; only counts of blocks whose title matches a habit of
  // this track are counted, and anything unrecognised is left out.
  const titles = new Set(habits.map((h) => h.name.toLowerCase()));
  const blocked = snapshot.timeBlocks.filter((b) =>
    titles.has(b.title.trim().toLowerCase()),
  );

  return {
    kind,
    habitCount: habits.length,
    completion: logs.length === 0 ? null : Math.round((completed / logs.length) * 100),
    blockedMinutes: Math.round(
      blocked.reduce(
        (sum, b) => sum + (b.endAt.getTime() - b.startAt.getTime()) / 60_000,
        0,
      ),
    ),
    empty: habits.length === 0,
  };
}

// ------------------------------------------------------------- correlations

export interface CorrelationEntry {
  id: string;
  left: string;
  right: string;
  /** Pearson r, -1 to 1. */
  r: number;
  sampleSize: number;
  confidence: number;
  direction: "together" | "apart";
}

/**
 * The pairs worth looking at, each chosen because a reader would have a reason
 * to suspect a link and the data can either back that up or not:
 *
 *   sleep   vs mood      - the classic, and the one most likely to be real
 *   focus   vs mood      - does deep work land on good days
 *   habits  vs mood      - does consistency track feeling better
 *   sleep   vs completion - does being rested predict getting things done
 *
 * Nothing here claims one causes the other. The labels read "moves with" for
 * exactly that reason, and a pair below the sample floor is omitted instead of
 * being shown as "no relationship", which is a different and less honest claim.
 */
export function correlationPanel(snapshot: LifeSnapshot): CorrelationEntry[] {
  const base = dayKey(snapshot.from);

  // --- build one value per day for each series -------------------------
  const focusByDay = new Map<number, number>();
  for (const f of snapshot.focusSessions) {
    if (f.actualSeconds <= 0) continue;
    const k = dayKey(f.startedAt);
    focusByDay.set(k, (focusByDay.get(k) ?? 0) + f.actualSeconds / 60);
  }

  const moodByDay = new Map<number, number[]>();
  const sleepByDay = new Map<number, number[]>();
  for (const m of snapshot.moodEnergy) {
    const k = dayKey(m.date);
    moodByDay.set(k, [...(moodByDay.get(k) ?? []), m.mood]);
    if (m.sleepHours !== null) {
      sleepByDay.set(k, [...(sleepByDay.get(k) ?? []), m.sleepHours]);
    }
  }

  const habitsByDay = new Map<number, { done: number; total: number }>();
  for (const log of snapshot.habitLogs) {
    const k = dayKey(log.date);
    const cell = habitsByDay.get(k) ?? { done: 0, total: 0 };
    cell.total += 1;
    if (log.completed) cell.done += 1;
    habitsByDay.set(k, cell);
  }

  // --- align onto the days where *both* series have a reading ------------
  interface Series {
    id: string;
    left: string;
    right: string;
    build: (day: number) => [number | null, number | null];
  }

  const series: Series[] = [
    {
      id: "sleep-mood",
      left: "Sleep",
      right: "Mood",
      build: (day) => {
        const s = sleepByDay.get(day);
        const m = moodByDay.get(day);
        if (!s?.length || !m?.length) return [null, null];
        return [mean(s), mean(m)];
      },
    },
    {
      id: "focus-mood",
      left: "Focus",
      right: "Mood",
      build: (day) => {
        const f = focusByDay.get(day);
        const m = moodByDay.get(day);
        if (f === undefined || !m?.length) return [null, null];
        return [f, mean(m)];
      },
    },
    {
      id: "habits-mood",
      left: "Habits",
      right: "Mood",
      build: (day) => {
        const h = habitsByDay.get(day);
        const m = moodByDay.get(day);
        if (!h || h.total === 0 || !m?.length) return [null, null];
        return [h.done / h.total, mean(m)];
      },
    },
    {
      id: "sleep-completion",
      left: "Sleep",
      right: "Habits",
      build: (day) => {
        const s = sleepByDay.get(day);
        const h = habitsByDay.get(day);
        if (!s?.length || !h || h.total === 0) return [null, null];
        return [mean(s), h.done / h.total];
      },
    },
  ];

  const results: CorrelationEntry[] = [];

  for (const s of series) {
    const xs: number[] = [];
    const ys: number[] = [];
    const lastDay = dayKey(snapshot.to);
    for (let day = base; day <= lastDay; day += 86_400_000) {
      const [x, y] = s.build(day);
      if (x === null || y === null) continue;
      xs.push(x);
      ys.push(y);
    }

    if (xs.length < MIN_PAIR_SAMPLES) continue;

    const r = correlation(xs, ys);
    if (Math.abs(r) < MIN_CORRELATION) continue;

    results.push({
      id: s.id,
      left: s.left,
      right: s.right,
      r: Math.round(r * 100) / 100,
      sampleSize: xs.length,
      confidence: Math.round(
        confidenceFrom(xs.length, Math.abs(r), MIN_PAIR_SAMPLES) * 100,
      ),
      direction: r > 0 ? "together" : "apart",
    });
  }

  // Strongest first, so a screen showing only the top two shows the most
  // defensible ones.
  return results.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
}
