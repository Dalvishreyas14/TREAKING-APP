import { formatDuration, mean, median, pct, round, sum, utcWeekday, weekdayName } from "./stats";
import { addDaysUtc, dateOnly, daysBetween, startOfMonthUtc, startOfWeekUtc } from "@/lib/date";
import { formatDayMonth, formatIndianDate, formatMonthYear } from "@/lib/format/date";
import { availableMinutes } from "./insights";
import type { LifeSnapshot, SnapshotHabit } from "./snapshot";

/**
 * Weekly and monthly reports.
 *
 * Same contract as the insights engine: pure, arithmetic, and every number
 * traceable. A report is the one screen a user is most likely to screenshot and
 * come back to, which makes it the worst possible place to be approximately
 * right.
 *
 * The `metrics`/`highlights`/`misses`/`patterns` fields on `WeeklyReview` and
 * `MonthlyReport` are `Json` columns, so this module defines their shapes
 * explicitly. Types on JSON columns are enforced nowhere by the database, which
 * means they have to be pinned here or a later refactor will quietly change the
 * shape and every historical row becomes unreadable.
 */

export interface ReportMetrics {
  tasksCompleted: number;
  tasksCreated: number;
  tasksStillOpen: number;
  tasksOverdue: number;
  habitLogs: number;
  habitExpected: number;
  habitRatePercent: number;
  focusSessions: number;
  focusMinutes: number;
  focusMinutesPerDay: number;
  planningMinutes: number;
  journalEntries: number;
  journalWords: number;
  moodAverage: number | null;
  energyAverage: number | null;
  stressAverage: number | null;
  sleepAverage: number | null;
  activeGoals: number;
  goalsClosed: number;
  activeProjects: number;
  projectsClosed: number;
  routinesCompleted: number;
}

export interface ReportSection {
  kind: "PATTERN" | "CORRELATION" | "OBSERVATION" | "RECOMMENDATION";
  title: string;
  body: string;
  confidence: number;
  sampleSize: number;
}

export interface WeeklyReportDraft {
  weekStart: Date;
  weekEnd: Date;
  periodLabel: string;
  summary: string;
  metrics: ReportMetrics;
  highlights: ReportSection[];
  misses: ReportSection[];
  patterns: ReportSection[];
  recommendations: ReportSection[];
  /** Comparison against the previous window, for the "vs last week" column. */
  deltas: Record<string, number | null>;
}

export interface MonthlyReportDraft {
  monthStart: Date;
  monthEnd: Date;
  monthLabel: string;
  summary: string;
  metrics: ReportMetrics;
  achievements: ReportSection[];
  habitStats: { habitId: string; name: string; ratePercent: number; completed: number; expected: number }[];
  goalStats: { goalId: string; title: string; progressPercent: number; status: string; milestones: string }[];
  focusStats: { day: string; minutes: number; sessions: number }[];
  timeStats: { byCategory: { name: string; minutes: number; sharePercent: number }[]; totalMinutes: number };
  lifeBalance: { area: string; sharePercent: number }[];
  missed: ReportSection[];
  recommendations: ReportSection[];
}

// ------------------------------------------------------------------ weekly

/**
 * Thousands separator for counts inside generated report prose.
 *
 * `Number.prototype.toLocaleString()` with no locale resolves against whichever
 * ICU build the Node process was compiled with, so a Node upgrade can silently
 * rewrite `1,840` as `1 840` inside an already-stored report. Grouping by hand
 * from an explicit pattern keeps the stored text stable.
 */
function groupedInteger(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  const digits = String(Math.abs(rounded));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}`;
}

export function buildWeeklyReport(snapshot: LifeSnapshot, now: Date = new Date()): WeeklyReportDraft {
  const weekStart = startOfWeekUtc(now);
  const weekEnd = addDaysUtc(weekStart, 6);
  const dayCount = daysBetween(weekStart, weekEnd) + 1;

  const metrics = computeMetrics(snapshot, weekStart, weekEnd, now, dayCount);

  const highlights = buildHighlights(snapshot, metrics);
  const misses = buildMisses(snapshot, metrics, now);
  const patterns = buildPatterns(snapshot);
  const recommendations = buildRecommendations(snapshot, metrics, patterns);

  const deltas = buildDeltas(snapshot, weekStart, metrics);

  return {
    weekStart,
    weekEnd,
    periodLabel: `${formatDayMonth(weekStart)} – ${formatDayMonth(weekEnd)}`,
    summary: summarise(metrics, misses, patterns, dayCount),
    metrics,
    highlights,
    misses,
    patterns,
    recommendations,
    deltas,
  };
}

function computeMetrics(
  snapshot: LifeSnapshot,
  from: Date,
  to: Date,
  now: Date,
  dayCount: number,
): ReportMetrics {
  const inRange = (d: Date | null) =>
    d !== null && d.getTime() >= from.getTime() && d.getTime() <= endOfDay(to);

  const completed = snapshot.tasks.filter((t) => t.completedAt !== null && inRange(t.completedAt));
  const created = snapshot.tasks.filter((t) => inRange(t.createdAt));
  const open = snapshot.tasks.filter(
    (t) => t.status === "TODO" || t.status === "IN_PROGRESS" || t.status === "BLOCKED",
  );
  const overdue = open.filter((t) => t.dueAt !== null && t.dueAt.getTime() < now.getTime());

  const logs = snapshot.habitLogs.filter((l) => inRange(l.date) && l.completed);
  const expected = habitExpected(snapshot, from, to);

  const sessions = snapshot.focusSessions.filter((s) => s.endedAt !== null && inRange(s.startedAt));
  const focusMinutes = Math.round(sum(sessions.map((s) => s.actualSeconds)) / 60);

  const blocks = snapshot.timeBlocks.filter((b) => inRange(b.date));
  const planningMinutes = Math.round(
    sum(blocks.map((b) => (b.endAt.getTime() - b.startAt.getTime()) / 60_000)),
  );

  const journal = snapshot.journal.filter((j) => inRange(j.date));
  const mood = snapshot.moodEnergy.filter((e) => inRange(e.date));
  const sleep = mood.filter((e) => e.sleepHours !== null && e.sleepHours > 0);

  const goalsClosed = snapshot.goals.filter(
    (g) => g.status === "ACHIEVED" && g.targetDate !== null && inRange(g.targetDate),
  ).length;
  const projectsClosed = snapshot.projects.filter(
    (p) => p.status === "COMPLETED" && p.dueAt !== null && inRange(p.dueAt),
  ).length;

  return {
    tasksCompleted: completed.length,
    tasksCreated: created.length,
    tasksStillOpen: open.length,
    tasksOverdue: overdue.length,
    habitLogs: logs.length,
    habitExpected: expected,
    habitRatePercent: pct(logs.length, expected),
    focusSessions: sessions.length,
    focusMinutes,
    focusMinutesPerDay: round(focusMinutes / dayCount, 1),
    planningMinutes,
    journalEntries: journal.length,
    journalWords: sum(journal.map((j) => j.wordCount)),
    moodAverage: mood.length ? round(mean(mood.map((e) => e.mood)), 2) : null,
    energyAverage: mood.length ? round(mean(mood.map((e) => e.energy)), 2) : null,
    stressAverage: mood.length ? round(mean(mood.map((e) => e.stress)), 2) : null,
    sleepAverage: sleep.length ? round(mean(sleep.map((e) => e.sleepHours!)), 2) : null,
    activeGoals: snapshot.goals.filter((g) => g.status === "ACTIVE").length,
    goalsClosed,
    activeProjects: snapshot.projects.filter((p) => p.status === "ACTIVE" || p.status === "PLANNING").length,
    projectsClosed,
    routinesCompleted: sum(snapshot.routines.map((r) => r.completedRunCount)),
  };
}

function endOfDay(day: Date): number {
  return dateOnly(day).getTime() + 86_400_000 - 1;
}

/**
 * How many habit logs the week asked for.
 *
 * Counted per habit from its own schedule, so a Mon/Wed/Fri habit contributes
 * three expectations to a week rather than seven. Getting this wrong makes every
 * rate in the report wrong by a constant factor, which is worse than an obviously
 * wrong number because it looks plausible.
 */
function habitExpected(snapshot: LifeSnapshot, from: Date, to: Date): number {
  let total = 0;
  for (const habit of snapshot.habits) {
    const start = dateOnly(habit.startDate);
    for (let d = from; d.getTime() <= to.getTime(); d = addDaysUtc(d, 1)) {
      if (start.getTime() > d.getTime()) continue;
      if (habit.frequency === "WEEKLY" && habit.scheduledDays.length > 0) {
        if (habit.scheduledDays.includes(utcWeekday(d))) total += 1;
      } else {
        total += 1;
      }
    }
  }
  return total;
}

// ------------------------------------------------------------------ sections

function buildHighlights(snapshot: LifeSnapshot, m: ReportMetrics): ReportSection[] {
  const out: ReportSection[] = [];

  if (m.tasksCompleted >= 3) {
    out.push({
      kind: "OBSERVATION",
      title: `${m.tasksCompleted} tasks closed`,
      body: `That is about ${round(m.tasksCompleted / 7, 1)} a day. You created ${m.tasksCreated} over the same week, so the list ${m.tasksCreated <= m.tasksCompleted ? "shrank" : "grew by " + (m.tasksCreated - m.tasksCompleted)}.`,
      confidence: Math.min(1, m.tasksCompleted / 15),
      sampleSize: m.tasksCompleted,
    });
  }

  if (m.focusMinutes > 0) {
    const sessionsText =
      m.focusSessions === 0
        ? "No sessions were logged, so this is time recorded on the calendar rather than time in the timer."
        : `Across ${m.focusSessions} sessions.`;
    out.push({
      kind: "OBSERVATION",
      title: `${formatDuration(m.focusMinutes)} of focus`,
      body: `${m.focusMinutesPerDay} minutes a day on average. ${sessionsText}`,
      confidence: Math.min(1, m.focusMinutes / 600),
      sampleSize: m.focusSessions || m.focusMinutes,
    });
  }

  if (m.goalsClosed > 0) {
    out.push({
      kind: "OBSERVATION",
      title: `${m.goalsClosed} ${m.goalsClosed === 1 ? "goal" : "goals"} closed`,
      body: "Closing something is the only unambiguous evidence that a plan worked.",
      confidence: 1,
      sampleSize: m.goalsClosed,
    });
  }

  if (m.journalEntries >= 3) {
    out.push({
      kind: "OBSERVATION",
      title: `${groupedInteger(m.journalWords)} words written`,
      body: `${m.journalEntries} entries, a median of ${Math.round(median(snapshot.journal.map((j) => j.wordCount)))} words each.`,
      confidence: Math.min(1, m.journalEntries / 7),
      sampleSize: m.journalEntries,
    });
  }

  if (m.habitRatePercent >= 75 && m.habitExpected >= 5) {
    out.push({
      kind: "OBSERVATION",
      title: `Habits at ${m.habitRatePercent}%`,
      body: `${m.habitLogs} of ${m.habitExpected} expected logs. This is the level where habits stop needing attention.`,
      confidence: Math.min(1, m.habitExpected / 20),
      sampleSize: m.habitExpected,
    });
  }

  return out;
}

function buildMisses(snapshot: LifeSnapshot, m: ReportMetrics, now: Date): ReportSection[] {
  const out: ReportSection[] = [];

  if (m.tasksOverdue > 0) {
    const worst = snapshot.tasks
      .filter((t) => t.dueAt !== null && t.dueAt.getTime() < now.getTime() && t.status !== "DONE")
      .sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0))[0];
    out.push({
      kind: "OBSERVATION",
      title: `${m.tasksOverdue} carried over`,
      body: `The oldest, "${worst?.title ?? "an untitled task"}", has been overdue since ${worst?.dueAt ? formatIndianDate(worst.dueAt) : "an earlier week"}. Carried work is the reason a list stops being trusted.`,
      confidence: Math.min(1, m.tasksOverdue / 5),
      sampleSize: m.tasksOverdue,
    });
  }

  // Habits that logged at all, but not enough.
  const perHabit = habitRates(snapshot);
  const weak = perHabit.filter((h) => h.expected >= 3 && h.ratePercent < 50);
  if (weak.length > 0) {
    out.push({
      kind: "OBSERVATION",
      title: `${weak.length} ${weak.length === 1 ? "habit" : "habits"} under 50%`,
      body: `${weak.map((h) => `${h.name} (${h.ratePercent}%)`).join(", ")}. Each of these is one decision: shrink the target, move it to a time that fits, or drop it.`,
      confidence: Math.min(1, sum(weak.map((h) => h.expected)) / 20),
      sampleSize: sum(weak.map((h) => h.expected)),
    });
  }

  if (m.focusMinutes === 0 && m.planningMinutes > 120) {
    out.push({
      kind: "OBSERVATION",
      title: "Planned but never focused",
      body: `${formatDuration(m.planningMinutes)} went onto the calendar and no focus session was logged. Either the timer is not the habit yet, or the blocks are not real. Worth deciding which.`,
      confidence: 0.6,
      sampleSize: m.focusMinutes,
    });
  }

  return out;
}

function buildPatterns(snapshot: LifeSnapshot): ReportSection[] {
  const out: ReportSection[] = [];

  // Best and worst weekday, from focus volume.
  const byDay = new Map<number, number>();
  for (const session of snapshot.focusSessions) {
    if (!session.endedAt) continue;
    const day = utcWeekday(session.startedAt);
    byDay.set(day, (byDay.get(day) ?? 0) + session.actualSeconds / 60);
  }
  if (byDay.size >= 3) {
    const rows = [...byDay.entries()].map(([day, minutes]) => ({ day, minutes })).sort((a, b) => b.minutes - a.minutes);
    const best = rows[0]!;
    const worst = rows[rows.length - 1]!;
    out.push({
      kind: "PATTERN",
      title: `${weekdayName(best.day)}s carry your focus`,
      body: `${Math.round(best.minutes)} minutes on ${weekdayName(best.day)}s against ${Math.round(worst.minutes)} on ${weekdayName(worst.day)}s. Same total, different shape.`,
      confidence: Math.min(1, sum(rows.map((r) => r.minutes)) / 1200),
      sampleSize: sum(rows.map((r) => r.minutes)) > 0 ? rows.length : 0,
    });
  }

  // Best focus hour.
  const byHour = new Map<number, number>();
  for (const session of snapshot.focusSessions) {
    if (!session.endedAt) continue;
    byHour.set(session.startedAt.getHours(), (byHour.get(session.startedAt.getHours()) ?? 0) + 1);
  }
  const strongHours = [...byHour.entries()].filter(([, count]) => count >= 3).sort((a, b) => b[1] - a[1]);
  if (strongHours.length >= 2) {
    const peak = strongHours[0]!;
    out.push({
      kind: "PATTERN",
      title: `You start focus sessions most often around ${peak[0]}:00`,
      body: `${peak[1]} sessions have begun in that hour. Scheduling your hardest work then costs nothing extra.`,
      confidence: Math.min(1, peak[1] / 12),
      sampleSize: peak[1],
    });
  }

  return out;
}

function buildRecommendations(
  snapshot: LifeSnapshot,
  m: ReportMetrics,
  patterns: ReportSection[],
): ReportSection[] {
  const out: ReportSection[] = [];

  if (m.tasksOverdue >= 3) {
    out.push({
      kind: "RECOMMENDATION",
      title: "Triage the backlog before adding anything",
      body: `${m.tasksOverdue} overdue items is past the point where new tasks help. Take ten minutes and do one of three things to each: do it, date it, or delete it. Deleting is a legitimate outcome and usually the most common one.`,
      confidence: Math.min(1, m.tasksOverdue / 8),
      sampleSize: m.tasksOverdue,
    });
  }

  const perHabit = habitRates(snapshot);
  const weakest = perHabit.filter((h) => h.expected >= 3).sort((a, b) => a.ratePercent - b.ratePercent)[0];
  if (weakest && weakest.ratePercent < 40) {
    out.push({
      kind: "RECOMMENDATION",
      title: `Shrink "${weakest.name}" or drop it`,
      body: `At ${weakest.ratePercent}% it is not working, and the usual cause is that the target is larger than the time actually available. Halve it and give it a specific time of day; if it is still under 40% next week, it wants deleting rather than another attempt.`,
      confidence: Math.min(1, weakest.expected / 15),
      sampleSize: weakest.expected,
    });
  }

  const peak = patterns.find((p) => p.title.includes("focus sessions most often"));
  if (peak && m.focusMinutesPerDay < 45) {
    out.push({
      kind: "RECOMMENDATION",
      title: `One ${peak.title.replace("You start focus sessions most often around ", "").replace(" sessions most often", "")}`,
      body: `You are averaging ${m.focusMinutesPerDay} focused minutes a day. You already have a hour that works; putting one 25-minute block there is a smaller promise than "focus more", and a smaller promise is the one you will keep.`,
      confidence: 0.6,
      sampleSize: m.focusSessions,
    });
  }

  if (m.sleepAverage !== null && m.sleepAverage < 6.5) {
    out.push({
      kind: "RECOMMENDATION",
      title: `You are averaging ${m.sleepAverage} hours of sleep`,
      body: `Below about 6.5 the data here tends to show mood and energy falling together, and the effect is larger than most planning changes. This is the one to fix before optimising anything else.`,
      confidence: Math.min(1, (7 - m.sleepAverage) / 2),
      sampleSize: m.journalEntries > 0 ? 1 : 0,
    });
  }

  if (out.length === 0) {
    out.push({
      kind: "RECOMMENDATION",
      title: "Nothing needs fixing",
      body: `No backlog, no habit under 40%, and focus logged. The useful thing now is to raise the ambition on one goal rather than to tighten the routine that is already holding.`,
      confidence: 0.8,
      sampleSize: 1,
    });
  }

  return out;
}

/** Change against the equivalent window immediately before `from`. */
function buildDeltas(
  snapshot: LifeSnapshot,
  from: Date,
  current: ReportMetrics,
): Record<string, number | null> {
  const prevFrom = addDaysUtc(from, -7);
  const prevTo = addDaysUtc(from, -1);
  const prev = computeMetrics(snapshot, prevFrom, prevTo, new Date(), 7);

  const keys: (keyof ReportMetrics)[] = [
    "tasksCompleted",
    "habitLogs",
    "focusMinutes",
    "focusSessions",
    "journalEntries",
    "journalWords",
  ];

  const out: Record<string, number | null> = {};
  for (const key of keys) {
    const a = current[key];
    const b = prev[key];
    if (typeof a !== "number" || typeof b !== "number") {
      out[key] = null;
      continue;
    }
    out[key] = a - b;
  }
  return out;
}

function summarise(
  m: ReportMetrics,
  misses: ReportSection[],
  patterns: ReportSection[],
  dayCount: number,
): string {
  const parts: string[] = [];

  if (m.tasksCompleted > 0 || m.habitLogs > 0) {
    parts.push(
      `Over ${dayCount} days: ${m.tasksCompleted} tasks closed, ${m.habitLogs} habit logs (${m.habitRatePercent}% of what was expected), ${formatDuration(m.focusMinutes)} of focus.`,
    );
  } else {
    parts.push(`A quiet ${dayCount} days — nothing logged, so there is nothing to review.`);
  }

  if (misses.length > 0) parts.push(`The thing worth fixing: ${misses[0]!.title.toLowerCase()}.`);
  else if (patterns.length > 0) parts.push(`The thing worth knowing: ${patterns[0]!.title.toLowerCase()}.`);
  else parts.push("Nothing stands out either way.");

  if (m.moodAverage !== null) {
    parts.push(`Mood averaged ${m.moodAverage} out of 5.`);
  }

  return parts.join(" ");
}

// ------------------------------------------------------------------ monthly

export function buildMonthlyReport(snapshot: LifeSnapshot, now: Date = new Date()): MonthlyReportDraft {
  const monthStart = startOfMonthUtc(now);
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0));
  const elapsedDays = Math.max(1, daysBetween(monthStart, dateOnly(now)) + 1);

  const metrics = computeMetrics(snapshot, monthStart, monthEnd, now, elapsedDays);
  const habitStats = habitRates(snapshot);
  const patterns = buildPatterns(snapshot);
  const misses = buildMisses(snapshot, metrics, now);
  const recommendations = buildRecommendations(snapshot, metrics, patterns);

  const byCategory = new Map<string, number>();
  for (const task of snapshot.tasks) {
    if (!task.completedAt) continue;
    if (task.completedAt.getTime() < monthStart.getTime()) continue;
    const key = task.categoryName ?? "Uncategorised";
    byCategory.set(key, (byCategory.get(key) ?? 0) + (task.estimatedMinutes ?? 25));
  }
  const totalMinutes = sum([...byCategory.values()]);
  const timeStats = {
    byCategory: [...byCategory.entries()]
      .map(([name, minutes]) => ({ name, minutes, sharePercent: pct(minutes, totalMinutes) }))
      .sort((a, b) => b.minutes - a.minutes),
    totalMinutes,
  };

  const focusByDay = new Map<string, { minutes: number; sessions: number }>();
  for (const session of snapshot.focusSessions) {
    if (!session.endedAt) continue;
    if (session.startedAt.getTime() < monthStart.getTime()) continue;
    const key = dateOnly(session.startedAt).toISOString().slice(0, 10);
    const bucket = focusByDay.get(key) ?? { minutes: 0, sessions: 0 };
    bucket.minutes += session.actualSeconds / 60;
    bucket.sessions += 1;
    focusByDay.set(key, bucket);
  }

  return {
    monthStart,
    monthEnd,
    monthLabel: formatMonthYear(monthStart),
    summary: summarise(metrics, misses, patterns, elapsedDays),
    metrics,
    achievements: buildHighlights(snapshot, metrics).filter((h) => h.title.includes("closed") || h.title.includes("Habits at")),
    habitStats,
    goalStats: snapshot.goals
      .filter((g) => g.status === "ACTIVE" || g.status === "ACHIEVED")
      .map((g) => ({
        goalId: g.id,
        title: g.title,
        progressPercent: pct(Math.round(g.progress), 100),
        status: g.status,
        milestones: `${g.doneMilestoneCount}/${g.milestoneCount}`,
      })),
    focusStats: [...focusByDay.entries()]
      .map(([day, b]) => ({ day, minutes: Math.round(b.minutes), sessions: b.sessions }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    timeStats,
    lifeBalance: timeStats.byCategory.map((c) => ({ area: c.name, sharePercent: c.sharePercent })),
    missed: misses,
    recommendations,
  };
}

function habitRates(snapshot: LifeSnapshot): {
  habitId: string;
  name: string;
  ratePercent: number;
  completed: number;
  expected: number;
}[] {
  return snapshot.habits
    .map((h: SnapshotHabit) => {
      const expected = habitExpected(snapshot, snapshot.from, snapshot.to);
      const completed = snapshot.habitLogs.filter(
        (l) => l.habitId === h.id && l.completed && l.date.getTime() >= snapshot.from.getTime() && l.date.getTime() <= snapshot.to.getTime(),
      ).length;
      return {
        habitId: h.id,
        name: h.name,
        ratePercent: pct(completed, expected),
        completed,
        expected,
      };
    })
    .sort((a, b) => b.ratePercent - a.ratePercent);
}

/** Re-exported so the API layer can log the same availability figure the plan used. */
export { availableMinutes };
