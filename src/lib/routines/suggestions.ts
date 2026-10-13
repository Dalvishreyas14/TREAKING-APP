import { daysBetween } from "@/lib/date";
import { formatDuration } from "@/lib/ai/stats";
import { median, round } from "@/lib/ai/stats";

/**
 * What a routine's own history says about it.
 *
 * The rules are the same ones the insights engine uses, and deliberately so: a
 * number without its sample size is a horoscope, and a suggestion a user can
 * check and disagree with is worth more than a fluent one. Every suggestion here
 * carries the runs it was read from, and most of them refuse to appear at all
 * until there are enough of them.
 *
 * Pure and database-free so it can be tested against exact histories, including
 * the awkward ones — three runs, all on the same Tuesday — where the useful
 * behaviour is to say nothing.
 */

export interface RoutineHistoryRun {
  startedAt: Date;
  completedAt: Date | null;
  completedItems: number;
  totalItems: number;
}

export interface RoutineHistoryStep {
  id: string;
  title: string;
  estimatedMinutes: number | null;
}

export type RoutineSuggestionTone = "praise" | "warn" | "info";

export interface RoutineSuggestion {
  /** Stable within a routine, so the UI can key on it. */
  id: string;
  tone: RoutineSuggestionTone;
  title: string;
  body: string;
  /** The working, surfaced the same way an insight surfaces its. */
  evidence: Record<string, unknown>;
  confidence: number;
}

/**
 * Fewest closed runs before this module will say anything at all.
 *
 * Three is the point where "you finished 2 of 3" starts to be a fact rather than
 * noise. Below it, a routine that has been tried twice looks exactly like one
 * that works, and the screen would be confidently wrong in both directions.
 */
const MIN_RUNS = 3;

/** Fewest runs before a time-of-day pattern is worth looking for. */
const MIN_RUNS_FOR_TIMING = 8;

/** How far back the "how often do you do this" question is asked. */
const CONSISTENCY_WINDOW_DAYS = 30;

function finished(run: RoutineHistoryRun): boolean {
  return run.completedAt !== null && run.totalItems > 0 && run.completedItems >= run.totalItems;
}

/** Elapsed minutes of a closed run, or null for one that was never closed. */
function durationMinutes(run: RoutineHistoryRun): number | null {
  if (!run.completedAt) return null;
  return Math.max(0, Math.round((run.completedAt.getTime() - run.startedAt.getTime()) / 60_000));
}

/**
 * The step people give up on.
 *
 * A run records a *count*, not which steps were ticked, so this is an inference
 * and is labelled as one: a sequence is done in order, so a run that stopped
 * after k steps stopped at the k+1st. With the median across runs it is a decent
 * read, but it is not a measurement, and the wording says "usually stops" rather
 * than "never does".
 */
function tailStep(
  steps: RoutineHistoryStep[],
  runs: RoutineHistoryRun[],
): { step: RoutineHistoryStep; stoppedAt: number; reached: number; closed: RoutineHistoryRun[] } | null {
  if (steps.length < 2) return null;

  // Only runs recorded against a routine of this same length. The run snapshots
  // how many steps the routine had at the time, so a run from before a step was
  // added or removed counts a different set of steps than the list above names —
  // and "you usually stop at step 3" would be pointing at the wrong step. If the
  // length has changed enough that few runs match, there is nothing to say.
  const closed = runs.filter((r) => r.completedAt !== null && r.totalItems === steps.length);
  if (closed.length < MIN_RUNS) return null;

  const typical = Math.round(median(closed.map((r) => r.completedItems)));
  if (typical >= steps.length - 1) return null;

  // Index `typical` is the first step *not* reached, so it is the one to name.
  const step = steps[typical];
  if (!step) return null;

  return { step, stoppedAt: typical + 1, reached: typical, closed };
}

/**
 * Elapsed time against the sum of the step estimates.
 *
 * A ratio rather than a difference, because the two are only comparable as one:
 * a routine estimated at 20 minutes that takes 30 is not "10 minutes slow", it is
 * half again, and that is the number worth revising the estimate against.
 */
function paceSuggestion(
  steps: RoutineHistoryStep[],
  runs: RoutineHistoryRun[],
): RoutineSuggestion | null {
  const estimated = steps.reduce((n, s) => n + (s.estimatedMinutes ?? 0), 0);
  if (estimated <= 0) return null;

  const durations = runs
    .filter((r) => finished(r))
    .map(durationMinutes)
    .filter((m): m is number => m !== null && m > 0);
  if (durations.length < MIN_RUNS) return null;

  const typical = Math.round(median(durations));
  const ratio = typical / estimated;
  // Silence when the estimate is roughly right. A ratio near 1 is the routine
  // working as designed and there is nothing for the user to act on, so claiming
  // "you beat your own estimate" for a run that landed within ten minutes of plan
  // would be technically true and practically noise. The band is ±25%, which is
  // wide enough to ignore ordinary variance in how long a person takes.
  if (ratio >= 0.75 && ratio <= 1.25) return null;

  const slower = ratio > 1;
  return {
    id: "pace",
    tone: slower ? "info" : "praise",
    title: slower ? "Your estimate is short" : "You beat your own estimate",
    body: slower
      ? `Finished runs take about ${formatDuration(typical)}, against ${formatDuration(estimated)} estimated across ${steps.length} steps. Raising the estimates would make the planner stop promising a shorter morning than you get.`
      : `You finish in about ${formatDuration(typical)}, comfortably inside the ${formatDuration(estimated)} the steps add up to. The estimate is safe to plan against.`,
    evidence: {
      finishedRuns: durations.length,
      medianMinutes: typical,
      estimatedMinutes: estimated,
      ratio: round(ratio, 2),
    },
    // Confidence rises with the sample and with how far from 1 the ratio sits, so
    // a 1.34x finding on six runs reads as weaker than a 1.9x finding on twenty.
    confidence: Math.min(0.95, 0.4 + durations.length * 0.03 + Math.abs(ratio - 1) * 0.6),
  };
}

function timingSuggestion(runs: RoutineHistoryRun[]): RoutineSuggestion | null {
  if (runs.length < MIN_RUNS_FOR_TIMING) return null;

  // Bucket by the hour of day the run started, in the server's local zone, which
  // is the hour the user experienced it in.
  const buckets = new Map<number, { total: number; done: number }>();
  for (const run of runs) {
    const hour = run.startedAt.getHours();
    const bucket = buckets.get(hour) ?? { total: 0, done: 0 };
    bucket.total += 1;
    if (finished(run)) bucket.done += 1;
    buckets.set(hour, bucket);
  }

  const usable = [...buckets.entries()].filter(([, b]) => b.total >= 2);
  if (usable.length < 2) return null;

  const ranked = usable
    .map(([hour, b]) => ({ hour, rate: b.done / b.total, total: b.total }))
    .sort((a, b) => b.rate - a.rate);

  const best = ranked[0]!;
  const worst = ranked[ranked.length - 1]!;
  if (best.rate - worst.rate < 0.3) return null;

  const label = (hour: number) => {
    const twelve = hour % 12 === 0 ? 12 : hour % 12;
    return `${twelve}${hour < 12 ? "am" : "pm"}`;
  };

  return {
    id: "timing",
    tone: "info",
    title: `You do this best around ${label(best.hour)}`,
    body: `${Math.round(best.rate * 100)}% of runs started near ${label(best.hour)} were finished, against ${Math.round(worst.rate * 100)}% near ${label(worst.hour)}. ${worst.hour === 0 || worst.hour === 23 ? "Late" : "Midday"} starts are the ones worth moving.`,
    evidence: {
      byHour: ranked.map((r) => ({ hour: r.hour, finishRatePercent: Math.round(r.rate * 100), runs: r.total })),
      runs: runs.length,
    },
    confidence: Math.min(0.85, 0.35 + runs.length * 0.03),
  };
}

function consistencySuggestion(
  runs: RoutineHistoryRun[],
  now: Date,
): RoutineSuggestion | null {
  if (runs.length < MIN_RUNS) return null;

  const from = new Date(now.getTime() - CONSISTENCY_WINDOW_DAYS * 86_400_000);
  const recent = runs.filter((r) => r.startedAt >= from);
  const days = new Set(recent.map((r) => daysBetween(from, r.startedAt)));
  const rate = Math.min(1, days.size / CONSISTENCY_WINDOW_DAYS);

  if (rate < 0.15) {
    return {
      id: "consistency",
      tone: "warn",
      title: "This one has gone quiet",
      body: `You have run it ${recent.length === 0 ? "not at all" : `${recent.length === 1 ? "once" : `${recent.length} times`}`} in the last ${CONSISTENCY_WINDOW_DAYS} days. Either it is too big for a morning, or the time it is attached to is wrong — the usual fix is fewer steps, not more motivation.`,
      evidence: { runsInWindow: recent.length, windowDays: CONSISTENCY_WINDOW_DAYS, distinctDays: days.size },
      confidence: 0.7,
    };
  }

  if (rate >= 0.6) {
    return {
      id: "consistency",
      tone: "praise",
      title: "This one is sticking",
      body: `${days.size} of the last ${CONSISTENCY_WINDOW_DAYS} days have a run on them. That is the sample size the other suggestions on this screen are resting on.`,
      evidence: { runsInWindow: recent.length, windowDays: CONSISTENCY_WINDOW_DAYS, distinctDays: days.size },
      confidence: 0.8,
    };
  }

  return null;
}

function tailSuggestion(
  steps: RoutineHistoryStep[],
  runs: RoutineHistoryRun[],
): RoutineSuggestion | null {
  const tail = tailStep(steps, runs);
  if (!tail) return null;

  const closed = tail.closed;
  const stoppedHere = closed.filter((r) => r.completedItems === tail.reached).length;

  return {
    id: "tail-step",
    tone: "warn",
    title: `Runs usually stop at "${tail.step.title}"`,
    body: `Of ${closed.length} closed runs, ${stoppedHere} finished exactly ${tail.reached} of ${steps.length} steps — so this is the one you reach least. Either it is the hardest step and belongs earlier, or it is not really part of this routine.`,
    evidence: {
      closedRuns: closed.length,
      stoppedAtStep: tail.stoppedAt,
      runsStoppingThere: stoppedHere,
      steps: steps.length,
    },
    confidence: Math.min(0.9, 0.45 + closed.length * 0.04),
  };
}

function completionSuggestion(runs: RoutineHistoryRun[]): RoutineSuggestion | null {
  const closed = runs.filter((r) => r.completedAt !== null && r.totalItems > 0);
  if (closed.length < MIN_RUNS) return null;

  const done = closed.filter(finished).length;
  const rate = done / closed.length;
  if (rate >= 0.8) return null; // Nothing to say; the praise case says it better.

  return {
    id: "completion",
    tone: "warn",
    title: "It is not getting finished",
    body: `${done} of ${closed.length} closed runs were completed. That is the habit to fix before anything else — a shorter routine that gets finished teaches more than a longer one that does not.`,
    evidence: {
      closedRuns: closed.length,
      completedRuns: done,
      finishRatePercent: Math.round(rate * 100),
    },
    confidence: Math.min(0.9, 0.4 + closed.length * 0.05),
  };
}

/**
 * Everything the history supports, most useful first.
 *
 * `now` is a parameter rather than `new Date()` so the output is a function of its
 * inputs, which is what makes the consistency window testable at all.
 */
export function suggestFromHistory(
  steps: RoutineHistoryStep[],
  runs: RoutineHistoryRun[],
  now: Date = new Date(),
): RoutineSuggestion[] {
  const order: Record<RoutineSuggestionTone, number> = { warn: 0, info: 1, praise: 2 };
  return [
    tailSuggestion(steps, runs),
    completionSuggestion(runs),
    consistencySuggestion(runs, now),
    paceSuggestion(steps, runs),
    timingSuggestion(runs),
  ]
    .filter((s): s is RoutineSuggestion => s !== null)
    .sort((a, b) => order[a.tone] - order[b.tone] || b.confidence - a.confidence);
}
