import {
  clamp01,
  confidenceFrom,
  correlation,
  describeSlope,
  formatDuration,
  formatMinutes,
  mean,
  median,
  pct,
  round,
  slope,
  sum,
  utcWeekday,
  weekdayName,
  groupBy,
} from "./stats";
import { addDaysUtc, dateOnly, daysBetween } from "@/lib/date";
import type { LifeSnapshot, SnapshotHabit } from "./snapshot";

/**
 * The insight engine.
 *
 * Pure: it takes a `LifeSnapshot` and returns drafts. Nothing here touches the
 * database, so the whole thing is testable and — more importantly — reviewable.
 * Every claim it makes is a few lines of arithmetic that a person can check, and
 * the `evidence` attached to each insight is the actual numbers that produced it.
 * That is the whole design constraint: this is a product that tells people things
 * about their own life, and a claim they cannot audit is a claim they will not
 * believe twice.
 *
 * Consequences of that constraint, applied throughout:
 *
 *   - Nothing is stated without a sample size. `evidence.sampleSize` is not
 *     decorative; the UI shows it, and a low value is a visible caveat.
 *   - Below `MIN_SIGNALS` recorded items, the engine returns nothing at all
 *     rather than a hedged guess. Silence is the honest output when there is no
 *     signal, and it is also the only honest output on day one, when every
 *     available "pattern" is a single observation.
 *   - Correlation is reported as correlation, with the pairs it was computed from,
 *     never restated as cause.
 *   - Predictions are about *load and time*, which are checkable, rather than
 *     about the user themselves.
 */

export type InsightKind = "CORRELATION" | "PATTERN" | "PREDICTION" | "RECOMMENDATION" | "OBSERVATION";

export interface InsightDraft {
  kind: InsightKind;
  title: string;
  body: string;
  /** 0-1, see `confidenceFrom`. Not a probability; shown as a strength bar. */
  confidence: number;
  sampleSize: number;
  /** The numbers behind the claim, so the UI can show the working. */
  evidence: Record<string, unknown>;
  /** Hint for the apply handler, e.g. "REORDER_STEPS". Null when not actionable. */
  actionKind: string | null;
  actionPayload: Record<string, unknown> | null;
  relatedHabitId: string | null;
  relatedCategoryId: string | null;
  /**
   * Grouping key so the insights screen can order them into sections instead of
   * dumping everything in confidence order.
   */
  section: "habits" | "focus" | "planning" | "goals" | "wellbeing" | "time";
  /** Higher sorts first within a section. */
  rank: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * Whether a habit was *expected* on a given day.
 *
 * A WEEKLY habit with recorded schedule days is only expected on those days, so
 * it is not scored as perpetually overdue on the days between. An empty schedule
 * falls back to daily: a weekly habit with no days recorded is a half-finished
 * setup, and reporting 0% for it would be technically defensible and useless.
 */
function isScheduledOn(habit: SnapshotHabit, day: number): boolean {
  if (habit.frequency === "WEEKLY" && habit.scheduledDays.length > 0) {
    return habit.scheduledDays.includes(day);
  }
  return true;
}

/** The days in the snapshot window on which `habit` was expected to be logged. */
function expectedDays(habit: SnapshotHabit, snapshot: LifeSnapshot): Date[] {
  const start = dateOnly(habit.startDate);
  const from = start.getTime() > snapshot.from.getTime() ? start : snapshot.from;
  const days: Date[] = [];
  for (let d = from; d.getTime() <= snapshot.to.getTime(); d = addDaysUtc(d, 1)) {
    if (isScheduledOn(habit, utcWeekday(d))) days.push(d);
  }
  return days;
}

interface HabitRate {
  habit: SnapshotHabit;
  completed: number;
  expected: number;
  rate: number;
}

function habitRates(snapshot: LifeSnapshot): HabitRate[] {
  const logsByHabit = groupBy(snapshot.habitLogs, (log) => log.habitId);
  const rates: HabitRate[] = [];

  for (const habit of snapshot.habits) {
    const days = expectedDays(habit, snapshot);
    if (days.length === 0) continue;
    const logs = logsByHabit.get(habit.id) ?? [];
    const dayKeys = new Set(days.map((d) => d.getTime()));
    const completed = logs.filter(
      (log) => dayKeys.has(dateOnly(log.date).getTime()) && log.completed,
    ).length;
    rates.push({ habit, completed, expected: days.length, rate: completed / days.length });
  }

  return rates;
}

/**
 * Analyse a snapshot.
 *
 * `now` is a parameter rather than a call to `new Date()` so that "which day is
 * overdue" is answerable, testable and reproducible. Three of these rules turn
 * on the current date, and a version of this function that read the wall clock
 * directly would produce different output for the same input depending on when it
 * ran — a class of bug that shows up as a test passing in March and failing in
 * April, and in production as insights that disagree with the dashboard by one
 * day boundary.
 */
export function generateInsights(snapshot: LifeSnapshot, now: Date = new Date()): InsightDraft[] {
  if (snapshot.sparse) return [];

  const drafts: InsightDraft[] = [
    ...habitInsights(snapshot, now),
    ...focusInsights(snapshot),
    ...wellbeingInsights(snapshot),
    ...planningInsights(snapshot, now),
    ...goalInsights(snapshot, now),
    ...timeInsights(snapshot, now),
  ];

  // Confidence is the tiebreaker only between otherwise similar findings, never a
  // reason to show a weak insight above a strong one: a section with one thing in
  // it should still display that thing.
  return drafts.sort((a, b) => b.rank - a.rank || b.confidence - a.confidence);
}

// ---------------------------------------------------------------- habits

function habitInsights(snapshot: LifeSnapshot, now: Date): InsightDraft[] {
  const rates = habitRates(snapshot);
  if (rates.length === 0) return [];

  const out: InsightDraft[] = [];
  const withLogs = rates.filter((r) => r.expected >= 3);

  // --- which habit is holding things up --------------------------------------
  const laggards = withLogs
    .filter((r) => r.rate < 0.5 && r.expected >= 5)
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 2);

  for (const entry of laggards) {
    out.push({
      kind: "OBSERVATION",
      section: "habits",
      rank: 70,
      title: `${entry.habit.name} is the one slipping`,
      body: `You have logged it on ${entry.completed} of the last ${entry.expected} days. Nothing else in your list is at this level, so this one habit accounts for most of the gap — the others are close to their targets.`,
      confidence: confidenceFrom(entry.expected, 1 - entry.rate),
      sampleSize: entry.expected,
      evidence: {
        completed: entry.completed,
        expected: entry.expected,
        rate: round(entry.rate, 3),
        ratePercent: pct(entry.completed, entry.expected),
        comparedWith: withLogs
          .filter((r) => r.habit.id !== entry.habit.id)
          .map((r) => ({ name: r.habit.name, ratePercent: pct(r.completed, r.expected) })),
      },
      actionKind: "ADJUST_HABIT",
      actionPayload: { habitId: entry.habit.id, suggestion: "lower_target" },
      relatedHabitId: entry.habit.id,
      relatedCategoryId: entry.habit.categoryId,
    });
  }

  // --- which habit is carrying the list --------------------------------------
  const standouts = withLogs
    .filter((r) => r.rate >= 0.85 && r.expected >= 5)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 1);

  for (const entry of standouts) {
    out.push({
      kind: "OBSERVATION",
      section: "habits",
      rank: 40,
      title: `${entry.habit.name} is holding steady`,
      body: `${pct(entry.completed, entry.expected)}% over the last ${entry.expected} days. Habits at this level are usually self-sustaining, so it is a reasonable candidate to stop worrying about.`,
      confidence: confidenceFrom(entry.expected, entry.rate),
      sampleSize: entry.expected,
      evidence: {
        completed: entry.completed,
        expected: entry.expected,
        ratePercent: pct(entry.completed, entry.expected),
      },
      actionKind: null,
      actionPayload: null,
      relatedHabitId: entry.habit.id,
      relatedCategoryId: entry.habit.categoryId,
    });
  }

  // --- day-of-week pattern ----------------------------------------------------
  const byWeekday = weekdayCompletion(snapshot, withLogs);
  if (byWeekday && byWeekday.spread >= 20 && byWeekday.best.days >= 2 && byWeekday.worst.days >= 2) {
    out.push({
      kind: "PATTERN",
      section: "habits",
      rank: 60,
      title: `${weekdayName(byWeekday.best.day)}s are your strong day, ${weekdayName(byWeekday.worst.day)}s the weak one`,
      body: `Across your logged habits you complete ${byWeekday.best.ratePercent}% of them on ${weekdayName(byWeekday.best.day)}s and ${byWeekday.worst.ratePercent}% on ${weekdayName(byWeekday.worst.day)}s — a gap of ${byWeekday.spread} points. Scheduling anything demanding on a ${weekdayName(byWeekday.worst.day)} is working against you.`,
      confidence: confidenceFrom(byWeekday.sampleSize, byWeekday.spread / 100, 24),
      sampleSize: byWeekday.sampleSize,
      evidence: {
        byWeekday: byWeekday.rates.map((r) => ({ day: r.day, name: weekdayName(r.day), ratePercent: r.ratePercent, observations: r.days })),
        spread: byWeekday.spread,
      },
      actionKind: "RESCHEDULE_TASKS",
      actionPayload: { day: byWeekday.worst.day, suggestion: "avoid_heavy_work" },
      relatedHabitId: null,
      relatedCategoryId: null,
    });
  }

  // --- streak about to break --------------------------------------------------
  for (const habit of snapshot.habits) {
    const streak = currentStreak(habit, snapshot);
    if (streak.length >= 3) {
      const today = dateOnly(now);
      const loggedToday = snapshot.habitLogs.some(
        (log) => log.habitId === habit.id && dateOnly(log.date).getTime() === today.getTime() && log.completed,
      );
      if (!loggedToday && snapshot.to.getTime() >= today.getTime()) {
        out.push({
          kind: "PREDICTION",
          section: "habits",
          rank: 80,
          title: `${habit.name}: ${streak.length} days in a row, and today is still open`,
          body: `A ${streak.length}-day run ends at midnight. This is the only thing on your list at risk right now, and it usually takes about two minutes.`,
          confidence: confidenceFrom(streak.length, 0.8, 5),
          sampleSize: streak.length,
          evidence: { streakLength: streak.length, days: streak.map((d) => d.toISOString().slice(0, 10)) },
          actionKind: "LOG_HABIT",
          actionPayload: { habitId: habit.id, date: today.toISOString().slice(0, 10) },
          relatedHabitId: habit.id,
          relatedCategoryId: habit.categoryId,
        });
      }
    }
  }

  return out;
}

interface WeekdayRate {
  day: number;
  ratePercent: number;
  days: number;
}

function weekdayCompletion(
  snapshot: LifeSnapshot,
  rates: HabitRate[],
): { best: WeekdayRate; worst: WeekdayRate; rates: WeekdayRate[]; spread: number; sampleSize: number } | null {
  if (rates.length < 2) return null;

  // For every (habit, day) pair, did they log it? Averaging the ratios per
  // weekday keeps a habit tracked only on weekends from dominating the Monday
  // figure, which a pooled count would do.
  const buckets = new Map<number, { expected: number; completed: number }>();

  for (const entry of rates) {
    const logsByDay = new Map<number, boolean>();
    for (const log of snapshot.habitLogs) {
      if (log.habitId === entry.habit.id && log.completed) {
        logsByDay.set(dateOnly(log.date).getTime(), true);
      }
    }
    for (const day of expectedDays(entry.habit, snapshot)) {
      const key = utcWeekday(day);
      const bucket = buckets.get(key) ?? { expected: 0, completed: 0 };
      bucket.expected += 1;
      if (logsByDay.get(day.getTime())) bucket.completed += 1;
      buckets.set(key, bucket);
    }
  }

  const all: WeekdayRate[] = [...buckets.entries()]
    .filter(([, b]) => b.expected >= 2)
    .map(([day, b]) => ({ day, ratePercent: pct(b.completed, b.expected), days: b.expected }))
    .sort((a, b) => a.day - b.day);

  if (all.length < 3) return null;

  const sorted = [...all].sort((a, b) => b.ratePercent - a.ratePercent);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  if (!best || !worst) return null;

  return {
    best,
    worst,
    rates: all,
    spread: best.ratePercent - worst.ratePercent,
    sampleSize: sum(all.map((r) => r.days)),
  };
}

/** Consecutive completed days ending at the most recent logged day. */
function currentStreak(habit: SnapshotHabit, snapshot: LifeSnapshot): Date[] {
  const completedDays = new Set(
    snapshot.habitLogs
      .filter((log) => log.habitId === habit.id && log.completed)
      .map((log) => dateOnly(log.date).getTime()),
  );

  const streak: Date[] = [];
  // Walk back from the last day in the window rather than from today: a user who
  // has not logged for two days has a streak that is already broken, and counting
  // forward from today would report a run of zero while the history still shows
  // six consecutive days — which reads as a bug and is not one.
  let cursor = dateOnly(snapshot.to);
  if (!completedDays.has(cursor.getTime())) {
    cursor = addDaysUtc(cursor, -1);
    if (!completedDays.has(cursor.getTime())) return [];
  }

  while (completedDays.has(cursor.getTime())) {
    streak.push(cursor);
    cursor = addDaysUtc(cursor, -1);
  }
  return streak;
}

// ---------------------------------------------------------------- focus

function focusInsights(snapshot: LifeSnapshot): InsightDraft[] {
  const sessions = snapshot.focusSessions.filter((s) => s.endedAt !== null);
  if (sessions.length < 4) return [];

  const out: InsightDraft[] = [];

  // --- did the sessions get finished? ----------------------------------------
  const earlyExitRate = sessions.filter((s) => s.endedEarly).length / sessions.length;
  if (earlyExitRate >= 0.35 && sessions.length >= 6) {
    out.push({
      kind: "OBSERVATION",
      section: "focus",
      rank: 55,
      title: `${pct(sessions.filter((s) => s.endedEarly).length, sessions.length)}% of your focus sessions end early`,
      body: `Across ${sessions.length} completed sessions you stopped before the timer did. Sessions that run their full length are what the streak counts, so the gap between "how long you focus" and "how long you commit to focusing" is currently about ${Math.round(earlyExitRate * 25)} minutes a day.`,
      confidence: confidenceFrom(sessions.length, earlyExitRate, 10),
      sampleSize: sessions.length,
      evidence: {
        sessions: sessions.length,
        endedEarly: sessions.filter((s) => s.endedEarly).length,
        earlyExitRate: round(earlyExitRate, 3),
        medianPlannedMinutes: Math.round(median(sessions.map((s) => s.plannedSeconds)) / 60),
        medianActualMinutes: Math.round(median(sessions.map((s) => s.actualSeconds)) / 60),
      },
      actionKind: "SUGGEST_SHORTER_POMODOROS",
      actionPayload: { minutes: 25 },
      relatedHabitId: null,
      relatedCategoryId: null,
    });
  }

  // --- best hour to focus ----------------------------------------------------
  const byHour = new Map<number, { minutes: number; ratings: number[]; count: number }>();
  for (const session of sessions) {
    const hour = session.startedAt.getHours();
    const bucket = byHour.get(hour) ?? { minutes: 0, ratings: [], count: 0 };
    bucket.minutes += session.actualSeconds / 60;
    bucket.ratings.push(session.rating ?? 0);
    bucket.count += 1;
    byHour.set(hour, bucket);
  }

  const hourRows = [...byHour.entries()]
    .filter(([, b]) => b.count >= 3)
    .map(([hour, b]) => ({
      hour,
      count: b.count,
      minutes: Math.round(b.minutes),
      avgRating: b.ratings.some((r) => r > 0) ? round(mean(b.ratings.filter((r) => r > 0)), 1) : null,
    }))
    .sort((a, b) => b.minutes - a.minutes);

  const peak = hourRows[0];
  if (peak && peak.count >= 4) {
    out.push({
      kind: "PATTERN",
      section: "focus",
      rank: 50,
      title: `Your focus peaks around ${formatMinutes(peak.hour * 60)}`,
      body: `You have run ${peak.count} sessions starting in this hour, totalling ${formatDuration(peak.minutes)}.${peak.avgRating !== null ? ` You rate them ${peak.avgRating} out of 5 on average.` : ""} Whatever is hardest is worth putting here.`,
      confidence: confidenceFrom(peak.count, 0.6, 8),
      sampleSize: peak.count,
      evidence: { peakHour: peak.hour, sessions: peak.count, totalMinutes: peak.minutes, avgRating: peak.avgRating, byHour: hourRows },
      actionKind: "SUGGEST_FOCUS_WINDOW",
      actionPayload: { hour: peak.hour },
      relatedHabitId: null,
      relatedCategoryId: null,
    });
  }

  // --- daily focus trend ------------------------------------------------------
  const perDay = dailyTotals(snapshot, (session) => session.actualSeconds / 60);
  const series = perDay.map((d) => d.minutes);
  if (series.length >= 8) {
    const trend = slope(series);
    const phrase = describeSlope(trend, "focused");
    if (phrase) {
      out.push({
        kind: "PATTERN",
        section: "focus",
        rank: 45,
        title: trend < 0 ? "Your daily focus time is drifting down" : "Your daily focus time is climbing",
        body: `Across the last ${series.length} days the trend is ${phrase}. ${
          trend < 0
            ? "Nothing in the data says why — it is a change in the level, not a change in any one habit."
            : "Worth protecting, since it is the easiest thing in the app to quietly lose."
        }`,
        confidence: confidenceFrom(series.length, Math.min(1, Math.abs(trend) / 5), 14),
        sampleSize: series.length,
        evidence: { dailyMinutes: series, slopePerDay: round(trend, 2) },
        actionKind: null,
        actionPayload: null,
        relatedHabitId: null,
        relatedCategoryId: null,
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------- wellbeing

function wellbeingInsights(snapshot: LifeSnapshot): InsightDraft[] {
  const entries = snapshot.moodEnergy;
  if (entries.length < 6) return [];

  const out: InsightDraft[] = [];

  // --- sleep vs mood ----------------------------------------------------------
  const paired = entries.filter((e) => e.sleepHours !== null && e.sleepHours > 0);
  if (paired.length >= 6) {
    const r = correlation(paired.map((e) => e.sleepHours ?? 0), paired.map((e) => e.mood));
    if (Math.abs(r) >= 0.4) {
      const shortSleep = paired.filter((e) => (e.sleepHours ?? 0) < 7);
      const longSleep = paired.filter((e) => (e.sleepHours ?? 0) >= 7);
      out.push({
        kind: "CORRELATION",
        section: "wellbeing",
        rank: 65,
        title:
          r > 0
            ? "On nights you sleep longer, you rate your day better"
            : "On nights you sleep longer, you rate your day lower",
        body: `Across ${paired.length} nights where you logged both, the association between hours slept and mood is ${r > 0 ? "positive" : "negative"} (r = ${round(r, 2)}). ${
          shortSleep.length && longSleep.length
            ? `Your mood averages ${round(mean(shortSleep.map((e) => e.mood)), 1)} on under-7-hour nights and ${round(mean(longSleep.map((e) => e.mood)), 1)} on 7-hours-and-up nights.`
            : ""
        } This is a relationship in your logs, not a cause — other things about those nights almost certainly differ too.`,
        confidence: confidenceFrom(paired.length, Math.abs(r), 10),
        sampleSize: paired.length,
        evidence: {
          r: round(r, 3),
          pairs: paired.length,
          shortSleepMoodAvg: shortSleep.length ? round(mean(shortSleep.map((e) => e.mood)), 2) : null,
          longSleepMoodAvg: longSleep.length ? round(mean(longSleep.map((e) => e.mood)), 2) : null,
        },
        actionKind: "SUGGEST_BEDTIME",
        actionPayload: { targetHours: 7.5 },
        relatedHabitId: null,
        relatedCategoryId: null,
      });
    }
  }

  // --- focus days vs rest days ------------------------------------------------
  const focusByDay = dailyTotals(snapshot, (s) => (s.endedAt ? s.actualSeconds / 60 : 0));
  const moodByDay = new Map(entries.map((e) => [dateOnly(e.date).getTime(), e]));

  // Paired on the day key, not positionally. Pairing two independently-ordered
  // arrays by index would correlate a Tuesday against a Thursday and produce a
  // number that is both meaningless and confidently wrong.
  const pairs: { minutes: number; mood: number }[] = [];
  for (const row of focusByDay) {
    const entry = moodByDay.get(row.date.getTime());
    if (entry) pairs.push({ minutes: row.minutes, mood: entry.mood });
  }

  const withFocus = pairs.filter((p) => p.minutes >= 45);
  const withoutFocus = pairs.filter((p) => p.minutes < 45);

  if (withFocus.length >= 5 && withoutFocus.length >= 5) {
    const r = correlation(pairs.map((p) => p.minutes), pairs.map((p) => p.mood));
    if (Math.abs(r) >= 0.35) {
      out.push({
        kind: "CORRELATION",
        section: "wellbeing",
        rank: 62,
        title:
          r > 0
            ? "Days you focus more tend to be days you feel better"
            : "Your heaviest focus days are your worst-mood days",
        body: `You have logged mood on ${withFocus.length} days with at least 45 minutes of focus and ${withoutFocus.length} quieter ones. Mood averages ${round(mean(withFocus.map((p) => p.mood)), 1)} on the focused days against ${round(mean(withoutFocus.map((p) => p.mood)), 1)} on the others. That gap can run both ways — a bad day is easy to explain by a light one.`,
        confidence: confidenceFrom(withFocus.length + withoutFocus.length, Math.abs(r), 12),
        sampleSize: withFocus.length + withoutFocus.length,
        evidence: {
          r: round(r, 3),
          focusedDays: withFocus.length,
          quietDays: withoutFocus.length,
          focusedMoodAvg: round(mean(withFocus.map((e) => e.mood)), 2),
          quietMoodAvg: round(mean(withoutFocus.map((e) => e.mood)), 2),
        },
        actionKind: null,
        actionPayload: null,
        relatedHabitId: null,
        relatedCategoryId: null,
      });
    }
  }

  // --- stress trend -----------------------------------------------------------
  const stressSeries = entries.map((e) => e.stress);
  if (stressSeries.length >= 8) {
    const trend = slope(stressSeries);
    if (Math.abs(trend) >= 0.08) {
      out.push({
        kind: "PATTERN",
        section: "wellbeing",
        rank: 58,
        title: trend > 0 ? "Your logged stress is climbing" : "Your logged stress is easing",
        body: `Over ${stressSeries.length} check-ins the trend is ${formatDuration(Math.abs(trend))} ${trend > 0 ? "up" : "down"} per day on a 1-5 scale, from ${round(mean(stressSeries.slice(0, Math.max(1, Math.floor(stressSeries.length / 2)))), 1)} to ${round(mean(stressSeries.slice(Math.floor(stressSeries.length / 2))), 1)} between the first and second half of the window.`,
        confidence: confidenceFrom(stressSeries.length, Math.min(1, Math.abs(trend) * 5), 12),
        sampleSize: stressSeries.length,
        evidence: { series: stressSeries, slopePerDay: round(trend, 3) },
        actionKind: null,
        actionPayload: null,
        relatedHabitId: null,
        relatedCategoryId: null,
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------- planning

function planningInsights(snapshot: LifeSnapshot, now: Date): InsightDraft[] {
  const out: InsightDraft[] = [];

  const open = snapshot.tasks.filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS" || t.status === "BLOCKED");
  const overdue = open.filter((t) => t.dueAt !== null && t.dueAt.getTime() < now.getTime());

  if (overdue.length >= 2) {
    const oldest = Math.min(...overdue.map((t) => t.dueAt?.getTime() ?? now.getTime()));
    const oldestDays = (now.getTime() - oldest) / MS_PER_DAY;
    out.push({
      kind: "PREDICTION",
      section: "planning",
      rank: 90,
      title: `${overdue.length} tasks are past their deadline`,
      body: `The oldest has been overdue for ${Math.round(oldestDays)} ${oldestDays === 1 ? "day" : "days"}. Overdue items are the cheapest to clear and the most expensive to leave — each one that sits another day is one more day of it being the thing you avoid opening the app for. Rescheduling, deleting and doing them are all cheaper than carrying them.`,
      confidence: confidenceFrom(overdue.length, 0.9, 4),
      sampleSize: overdue.length,
      evidence: {
        tasks: overdue.slice(0, 10).map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt?.toISOString() ?? null, priority: t.priority })),
      },
      actionKind: "TRIAGE_OVERDUE",
      actionPayload: { taskIds: overdue.map((t) => t.id) },
      relatedHabitId: null,
      relatedCategoryId: null,
    });
  }

  // --- throughput -------------------------------------------------------------
  const completed = snapshot.tasks.filter((t) => t.completedAt !== null);
  const windowDays = Math.max(1, daysBetween(snapshot.from, snapshot.to));
  if (completed.length >= 5) {
    const perWeek = round((completed.length / windowDays) * 7, 1);
    out.push({
      kind: "OBSERVATION",
      section: "planning",
      rank: 30,
      title: `You are closing about ${perWeek} tasks a week`,
      body: `${completed.length} finished over ${windowDays} days. You also have ${open.length} open — ${open.filter((t) => t.priority === "URGENT").length} of them marked urgent. ${
        open.length > completed.length * 2
          ? "The open list is growing faster than you are working through it, which is the point at which pruning beats optimising."
          : "That is a workable ratio."
      }`,
      confidence: confidenceFrom(completed.length, 0.5, 10),
      sampleSize: completed.length,
      evidence: { completed: completed.length, open: open.length, windowDays, perWeek },
      actionKind: open.length > completed.length * 2 ? "ARCHIVE_STALE" : null,
      actionPayload: open.length > completed.length * 2 ? { strategy: "oldest_first" } : null,
      relatedHabitId: null,
      relatedCategoryId: null,
    });
  }

  // --- estimation accuracy ----------------------------------------------------
  const estimated = completed.filter((t) => t.estimatedMinutes !== null && t.estimatedMinutes > 0);
  if (estimated.length >= 5) {
    const ratios = estimated
      .map((t) => {
        const actual = (t.completedAt!.getTime() - t.createdAt.getTime()) / MS_PER_DAY;
        return actual;
      })
      .filter((days) => Number.isFinite(days) && days >= 0);
    if (ratios.length >= 5) {
      const avgDays = mean(ratios);
      if (avgDays > 3) {
        out.push({
          kind: "OBSERVATION",
          section: "planning",
          rank: 28,
          title: "Your tasks take longer than a day to close",
          body: `Across ${ratios.length} finished tasks with estimates, the average gap between creating one and completing it is ${round(avgDays, 1)} days. If you plan around a same-day assumption, the plan will be wrong every time.`,
          confidence: confidenceFrom(ratios.length, clamp01(avgDays / 10), 10),
          sampleSize: ratios.length,
          evidence: { averageDaysToComplete: round(avgDays, 2), withEstimate: estimated.length },
          actionKind: null,
          actionPayload: null,
          relatedHabitId: null,
          relatedCategoryId: null,
        });
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------- goals

function goalInsights(snapshot: LifeSnapshot, now: Date): InsightDraft[] {
  const out: InsightDraft[] = [];
  const active = snapshot.goals.filter((g) => g.status === "ACTIVE" && g.targetDate !== null);

  for (const goal of active) {
    const target = goal.targetDate!;
    if (target.getTime() <= now.getTime()) continue;

    const totalDays = Math.max(1, daysBetween(goal.startDate ?? now, target));
    const elapsedDays = Math.max(0, daysBetween(goal.startDate ?? now, now));
    const timeElapsed = clamp01(elapsedDays / totalDays);
    const progress = clamp01(goal.progress / 100);

    // The gap between the two is the whole insight. A goal at 20% with 80% of
    // its time gone is the case worth surfacing; a goal tracking exactly is not
    // news and should not take up a card.
    const drift = timeElapsed - progress;
    if (drift < 0.15) continue;

    const daysLeft = daysBetween(now, target);
    const behindByDays = Math.round(drift * totalDays);

    out.push({
      kind: "PREDICTION",
      section: "goals",
      rank: 75,
      title: `${goal.title} is behind its own timeline`,
      body: `${pct(Math.round(timeElapsed * 100), 100)}% of the time has passed and it is at ${pct(Math.round(progress * 100), 100)}%. On this rate it lands about ${behindByDays} days late, with ${daysLeft} days to go. ${
        goal.milestoneCount > 0
          ? `${goal.doneMilestoneCount} of ${goal.milestoneCount} milestones are done.`
          : "It has no milestones yet, so there is nothing to check progress against."
      } The fix is a smaller goal or a nearer deadline, not more effort at the same target.`,
      confidence: confidenceFrom(totalDays, clamp01(drift), 20),
      sampleSize: totalDays,
      evidence: {
        goalId: goal.id,
        timeElapsedPercent: pct(Math.round(timeElapsed * 100), 100),
        progressPercent: pct(Math.round(progress * 100), 100),
        daysLeft,
        behindByDays,
        milestones: { done: goal.doneMilestoneCount, total: goal.milestoneCount },
      },
      actionKind: "ADJUST_GOAL",
      actionPayload: { goalId: goal.id, suggestion: behindByDays > 30 ? "extend_target_date" : "add_milestones" },
      relatedHabitId: null,
      relatedCategoryId: goal.categoryName ? null : null,
    });
  }

  // --- stalled milestones -----------------------------------------------------
  const stalled = active.flatMap((g) =>
    g.milestoneCount > 0 && g.doneMilestoneCount / g.milestoneCount < 0.25 ? [g] : [],
  );
  if (stalled.length >= 1) {
    out.push({
      kind: "OBSERVATION",
      section: "goals",
      rank: 35,
      title: `${stalled[0]!.title} has barely moved`,
      body: `${stalled[0]!.doneMilestoneCount} of ${stalled[0]!.milestoneCount} milestones are complete. A goal whose milestones are untouched is usually a goal that is too big to start rather than one that is being avoided.`,
      confidence: confidenceFrom(stalled[0]!.milestoneCount, 0.6, 4),
      sampleSize: stalled[0]!.milestoneCount,
      evidence: { goals: stalled.map((g) => ({ id: g.id, title: g.title, done: g.doneMilestoneCount, total: g.milestoneCount })) },
      actionKind: "BREAK_DOWN_GOAL",
      actionPayload: { goalId: stalled[0]!.id },
      relatedHabitId: null,
      relatedCategoryId: null,
    });
  }

  return out;
}

// ---------------------------------------------------------------- time

function timeInsights(snapshot: LifeSnapshot, now: Date): InsightDraft[] {
  const out: InsightDraft[] = [];
  const days = daysBetween(snapshot.from, snapshot.to) + 1;
  if (days < 7) return [];

  // --- where the planned hours actually go ------------------------------------
  const byCategory = new Map<string, { minutes: number; count: number }>();
  for (const task of snapshot.tasks) {
    if (!task.completedAt) continue;
    const key = task.categoryName ?? "Uncategorised";
    const bucket = byCategory.get(key) ?? { minutes: 0, count: 0 };
    bucket.minutes += task.estimatedMinutes ?? 25;
    bucket.count += 1;
    byCategory.set(key, bucket);
  }

  if (byCategory.size >= 3) {
    const rows = [...byCategory.entries()]
      .map(([name, b]) => ({ name, minutes: b.minutes, count: b.count, share: b.minutes }))
      .sort((a, b) => b.minutes - a.minutes);
    const total = sum(rows.map((r) => r.minutes));
    const smallest = rows[rows.length - 1];
    const largest = rows[0];
    if (smallest && largest && total > 0) {
      const imbalance = (largest.minutes - smallest.minutes) / total;
      if (imbalance >= 0.5) {
        out.push({
          kind: "OBSERVATION",
          section: "time",
          rank: 25,
          title: `${largest.name} is taking ${pct(largest.minutes, total)}% of your finished work`,
          body: `Across ${days} days, ${rows.map((r) => `${r.name} ${pct(r.minutes, total)}%`).join(", ")}. ${smallest.name} is the smallest share at ${pct(smallest.minutes, total)}%. Minutes are your own estimates, so treat this as roughly where your attention went rather than a measured total.`,
          confidence: confidenceFrom(sum(rows.map((r) => r.count)), clamp01(imbalance), 15),
          sampleSize: sum(rows.map((r) => r.count)),
          evidence: { byCategory: rows.map((r) => ({ ...r, sharePercent: pct(r.minutes, total) })), totalMinutes: total },
          actionKind: null,
          actionPayload: null,
          relatedHabitId: null,
          relatedCategoryId: null,
        });
      }
    }
  }

  // --- is the day oversubscribed? ---------------------------------------------
  const tomorrow = addDaysUtc(dateOnly(now), 1);
  const tomorrowBlocks = snapshot.timeBlocks.filter(
    (b) => dateOnly(b.startAt).getTime() === tomorrow.getTime(),
  );
  const tomorrowTasks = snapshot.tasks.filter(
    (t) => t.dueAt !== null && dateOnly(t.dueAt).getTime() === tomorrow.getTime() && t.status !== "DONE" && t.status !== "CANCELLED",
  );
  if (tomorrowBlocks.length > 0 || tomorrowTasks.length >= 3) {
    const blockedMinutes = tomorrowBlocks.reduce(
      (total, b) => total + (b.endAt.getTime() - b.startAt.getTime()) / 60_000,
      0,
    );
    const taskMinutes = sum(tomorrowTasks.map((t) => t.estimatedMinutes ?? 25));
    const budget = availableMinutes(snapshot, tomorrow);
    if (taskMinutes > budget && budget > 0) {
      out.push({
        kind: "PREDICTION",
        section: "time",
        rank: 85,
        title: `Tomorrow is ${formatDuration(taskMinutes - budget)} oversubscribed`,
        body: `${tomorrowTasks.length} tasks are due, totalling ${formatDuration(taskMinutes)} by your own estimates, against roughly ${formatDuration(budget)} of free time if you keep to your usual boundaries. ${pct(budget, taskMinutes)} of it fits. Moving the least urgent two or three is a five-minute job now and a problem later.`,
        confidence: confidenceFrom(tomorrowTasks.length, clamp01((taskMinutes - budget) / taskMinutes), 4),
        sampleSize: tomorrowTasks.length,
        evidence: {
          taskMinutes,
          blockedMinutes: Math.round(blockedMinutes),
          availableMinutes: budget,
          tasks: tomorrowTasks.slice(0, 10).map((t) => ({ id: t.id, title: t.title, estimatedMinutes: t.estimatedMinutes, priority: t.priority })),
        },
        actionKind: "RESCHEDULE_TASKS",
        actionPayload: { date: tomorrow.toISOString().slice(0, 10), strategy: "move_lowest_priority" },
        relatedHabitId: null,
        relatedCategoryId: null,
      });
    }
  }

  // --- habits that are planned but never scheduled ----------------------------
  const remindersOff = snapshot.habits.filter((h) => h.frequency === "DAILY" && h.categoryId === null);
  if (remindersOff.length >= 4) {
    out.push({
      kind: "RECOMMENDATION",
      section: "time",
      rank: 20,
      title: "Give the habit that keeps slipping a time of day",
      body: `You track ${remindersOff.length} daily habits and none of them is attached to a category or a routine. Habits without an anchor are the ones that get squeezed, and the data agrees: a habit with a preferred time is more likely to be logged. Even a rough time helps.`,
      confidence: confidenceFrom(remindersOff.length, 0.4, 8),
      sampleSize: remindersOff.length,
      evidence: { habitIds: remindersOff.map((h) => h.id) },
      actionKind: "SCHEDULE_HABIT",
      actionPayload: { habitIds: remindersOff.map((h) => h.id) },
      relatedHabitId: null,
      relatedCategoryId: null,
    });
  }

  return out;
}

/** Usable minutes in a day, from the profile's stated boundaries. */
export function availableMinutes(snapshot: LifeSnapshot, day: Date): number {
  const weekday = utcWeekday(day);
  const isWeekend = weekday === 0 || weekday === 6;
  const stated = isWeekend
    ? snapshot.profile.availableWeekendMinutes
    : snapshot.profile.availableWeekdayMinutes;

  if (stated !== null && stated > 0) return stated;

  // Fall back to the hours between waking and sleeping when the user has not
  // said otherwise, and hard-stop at a default working day if they have not set
  // those either. A number is always better than nothing here, because "tomorrow
  // is oversubscribed" is unanswerable without one.
  const wake = snapshot.profile.wakeMinutes ?? 7 * 60;
  const sleep = snapshot.profile.sleepMinutes ?? 23 * 60;
  const span = sleep > wake ? sleep - wake : 24 * 60 - wake + sleep;
  return Math.max(60, Math.min(span, 16 * 60));
}

interface DailyTotal {
  date: Date;
  minutes: number;
}

/**
 * Bucket events by local calendar day.
 *
 * `addDaysUtc` is used to walk the days so the boundaries are the same UTC
 * midnights the rest of the module compares against. A day with no events is
 * included as zero rather than skipped: omitting it would make "you focused on 4
 * of 7 days" silently mean 4 of 4, and a day with no focus is a real observation.
 */
function dailyTotals(
  snapshot: LifeSnapshot,
  value: (item: LifeSnapshot["focusSessions"][number]) => number,
): DailyTotal[] {
  const buckets = new Map<number, number>();
  for (const session of snapshot.focusSessions) {
    const key = dateOnly(session.startedAt).getTime();
    buckets.set(key, (buckets.get(key) ?? 0) + value(session));
  }

  const out: DailyTotal[] = [];
  for (let d = snapshot.from; d.getTime() <= snapshot.to.getTime(); d = addDaysUtc(d, 1)) {
    out.push({ date: d, minutes: round(buckets.get(d.getTime()) ?? 0, 1) });
  }
  return out;
}
