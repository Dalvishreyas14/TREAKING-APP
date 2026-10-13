import type { Prisma } from "@/generated/prisma/client";
import { CategoryDonut, TrendChart, WeekdayChart } from "@/components/app/charts";
import { ReportPanel, type ReportSectionRow, type MonthlyReportRow, type WeeklyReviewRow } from "@/components/app/report-panel";
import { MetricDisclosure } from "@/components/feedback/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/guards";
import { weekdayRows, type ChartPoint } from "@/lib/analytics/charts";
import { prisma } from "@/lib/db";
import { addDaysUtc, daysBetween, todayUtc } from "@/lib/date";
import { formatDayOfMonth, formatIndianShort } from "@/lib/format/date";

export const dynamic = "force-dynamic";

/**
 * Analytics.
 *
 * Split into two kinds of number, because they behave differently and conflating
 * them is how dashboards start lying:
 *
 * **Trends are computed here, on the server, from raw rows.** Thirty days of
 * completions, focus minutes and journal entries are summed on the way out. They
 * are cheap, they are always current, and there is no reason to store them.
 *
 * **Reviews and reports are read from storage.** They carry a narrative, a
 * highlights/misses structure and a comparison against the previous window, and
 * they are generated on demand through `POST /api/v1/reviews/generate` and keyed
 * by a unique index on their period. The screen never synthesises one; it shows
 * the newest stored one and says plainly when there is none.
 *
 * The completion rate uses the *expected* count as its denominator rather than
 * the number of days elapsed. A weekly habit tracked since yesterday is not 50%
 * complete, and a rate that punishes a habit for being new is a rate people stop
 * trusting.
 *
 * The charts are Recharts components, but the arithmetic behind them is pure and
 * lives in `src/lib/analytics/charts.ts`. That split is not tidiness for its own
 * sake: a chart that cannot be rendered in a test is a chart whose numbers nobody
 * can check, and the weekday denominator in particular is easy to get subtly
 * wrong in a way that only shows up as a plausible-looking chart.
 */

const TREND_DAYS = 30;

const SECTION_KINDS = new Set<ReportSectionRow["kind"]>([
  "PATTERN",
  "CORRELATION",
  "OBSERVATION",
  "RECOMMENDATION",
]);

/**
 * Coerces a stored report section into a `ReportSectionRow`, or drops it.
 *
 * The `highlights`/`misses`/`patterns`/`recommendations` columns are untyped
 * `Json` and were seeded as bare strings in an earlier revision of this schema.
 * Reading one of those rows with a direct `as unknown as ReportSectionRow[]` cast
 * compiles cleanly, then throws `Cannot read properties of undefined (reading
 * 'toLowerCase')` at render time and takes the whole analytics screen down with
 * it. A cast cannot protect a page from data it never checked, so the check lives
 * here instead: a section is kept only if every field the panel reads is present
 * and of the right primitive type, and a bare string is promoted to a titled
 * observation so a legacy row still shows its text rather than vanishing.
 */
function normalizeSections(value: Prisma.JsonValue | null | undefined): ReportSectionRow[] {
  if (!Array.isArray(value)) return [];

  const out: ReportSectionRow[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const body = entry.trim();
      if (!body) continue;
      out.push({
        kind: "OBSERVATION",
        title: body.length > 60 ? `${body.slice(0, 57)}...` : body,
        body,
        confidence: 0,
        sampleSize: 0,
      });
      continue;
    }

    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const rec = entry as Record<string, unknown>;
    if (typeof rec.kind !== "string" || !SECTION_KINDS.has(rec.kind as ReportSectionRow["kind"])) {
      continue;
    }
    if (typeof rec.title !== "string" || typeof rec.body !== "string") continue;

    out.push({
      kind: rec.kind as ReportSectionRow["kind"],
      title: rec.title,
      body: rec.body,
      confidence: typeof rec.confidence === "number" ? rec.confidence : 0,
      sampleSize: typeof rec.sampleSize === "number" ? rec.sampleSize : 0,
    });
  }
  return out;
}

export default async function AnalyticsPage() {
  const user = await requireUser();
  const today = todayUtc();
  const from = addDaysUtc(today, -(TREND_DAYS - 1));

  const [tasks, habitLogs, focus, journals, weekly, monthly, achievements, stats, profile, account] =
    await Promise.all([
      prisma.task.findMany({
        where: {
          userId: user.id,
          OR: [
            { completedAt: { gte: from } },
            { dueAt: { gte: from, lte: today } },
            { createdAt: { gte: from } },
          ],
        },
        select: {
          id: true,
          status: true,
          completedAt: true,
          dueAt: true,
          createdAt: true,
          category: { select: { name: true, color: true } },
        },
      }),
      prisma.habitLog.findMany({
        where: { userId: user.id, date: { gte: from, lte: today } },
        select: { habitId: true, date: true, completed: true, value: true },
      }),
      prisma.focusSession.findMany({
        where: { userId: user.id, startedAt: { gte: from } },
        select: { startedAt: true, actualSeconds: true, endedAt: true },
      }),
      prisma.journalEntry.findMany({
        where: { userId: user.id, createdAt: { gte: from } },
        select: { createdAt: true },
      }),
      prisma.weeklyReview.findMany({
        where: { userId: user.id },
        orderBy: { weekStart: "desc" },
        take: 12,
        select: {
          id: true,
          weekStart: true,
          weekEnd: true,
          periodLabel: true,
          summary: true,
          metrics: true,
          highlights: true,
          misses: true,
          patterns: true,
          recommendations: true,
          provider: true,
          createdAt: true,
        },
      }),
      prisma.monthlyReport.findMany({
        where: { userId: user.id },
        orderBy: { monthStart: "desc" },
        take: 6,
        select: {
          id: true,
          monthStart: true,
          monthEnd: true,
          monthLabel: true,
          summary: true,
          metrics: true,
          achievements: true,
          habitStats: true,
          goalStats: true,
          focusStats: true,
          timeStats: true,
          lifeBalance: true,
          missed: true,
          recommendations: true,
          provider: true,
          createdAt: true,
        },
      }),
      prisma.userAchievement.findMany({
        where: { user: { id: user.id } },
        orderBy: { unlockedAt: "desc" },
        take: 12,
        select: {
          id: true,
          progress: true,
          unlockedAt: true,
          achievement: {
            select: { key: true, name: true, description: true, icon: true, rarity: true },
          },
        },
      }),
      prisma.userStats.findUnique({
        where: { userId: user.id },
        select: {
          xp: true,
          level: true,
          currentStreak: true,
          longestStreak: true,
          tasksCompleted: true,
          habitsCompleted: true,
          focusMinutes: true,
          goalsAchieved: true,
        },
      }),
      prisma.profile.findUnique({
        where: { userId: user.id },
        select: { workLabel: true, workStartMinutes: true, workEndMinutes: true },
      }),
      prisma.user.findUnique({
        where: { id: user.id },
        select: { aiEnabled: true },
      }),
    ]);

  const key = (d: Date) => d.toISOString().slice(0, 10);

  const completedTasks = tasks.filter((t) => t.completedAt);
  const overdue = tasks.filter(
    (t) => t.dueAt && t.dueAt <= today && t.status !== "DONE" && t.status !== "CANCELLED",
  );

  /** The window's days, once, reused by the trend series and the weekday chart. */
  const windowDays = Array.from({ length: TREND_DAYS }, (_, i) => addDaysUtc(from, i));

  const seriesFor = (valueByDate: (day: Date) => number) =>
    windowDays.map((day) => ({
      date: key(day),
      label: formatDayOfMonth(day),
      value: valueByDate(day),
    }));

  const taskPoints = seriesFor((day) => {
    const k = key(day);
    return completedTasks.filter((t) => key(t.completedAt!) === k).length;
  });

  // Only completed sessions count. A running or abandoned timer has an
  // `actualSeconds` value that keeps accruing, and including it would let an
  // open timer inflate the trend and the total. Declared before the trend
  // series below that reads it.
  const finishedFocus = focus.filter((s) => s.endedAt !== null);

  const focusPoints = seriesFor((day) => {
    const k = key(day);
    return Math.round(
      finishedFocus.filter((s) => key(s.startedAt) === k).reduce((n, s) => n + s.actualSeconds / 60, 0),
    );
  });

  const habitPoints = seriesFor(
    (day) => habitLogs.filter((l) => key(l.date) === key(day) && l.completed).length,
  );

  const journalPoints = seriesFor((day) => journals.filter((j) => key(j.createdAt) === key(day)).length);

  /**
   * Tasks by weekday, against how many times each weekday fell in the window.
   *
   * The denominator is the point: over thirty days a Monday happens four or five
   * times, so a raw count would make a five-Monday month look busier than a
   * four-Saturday one for reasons that have nothing to do with the user.
   */
  const taskCountByDate = new Map(taskPoints.map((p) => [p.date, p.value]));
  const weekdayTaskRows = weekdayRows(windowDays, taskCountByDate);

  const activeHabits = new Set(habitLogs.map((l) => l.habitId));
  // A habit only becomes eligible on the day it first has a log, so the
  // denominator is each habit's own eligible day count rather than a flat
  // 30. Dividing by 30 for a habit tracked since Monday would report ~10% and
  // read as a failure when nothing was missed.
  const expectedLogs = [...activeHabits].reduce((n, habitId) => {
    const firstLog = habitLogs.reduce(
      (earliest, l) => (l.habitId === habitId && l.date < earliest ? l.date : earliest),
      today,
    );
    const eligibleDays = Math.max(
      1,
      Math.min(TREND_DAYS, daysBetween(firstLog, today) + 1),
    );
    return n + eligibleDays;
  }, 0);
  const habitRate =
    activeHabits.size > 0
      ? Math.round((habitLogs.filter((l) => l.completed).length / Math.max(1, expectedLogs)) * 100)
      : null;

  const focusMinutesTotal = Math.round(
    finishedFocus.reduce((n, s) => n + s.actualSeconds / 60, 0),
  );

  // Category mix of completed work, as a raw count share.
  //
  // No category weights here. The Life Balance figure in the monthly report is
  // derived from *estimated minutes* in `src/lib/ai/reports.ts`, so applying a
  // second, different weighting on this screen would have produced two
  // "shares" for the same category that contradicted each other. This one is
  // the honest count, and the caption says so.
  const countByCategory = new Map<string, { name: string; color: string; count: number }>();
  for (const task of completedTasks) {
    const category = task.category;
    if (!category) continue;
    const current = countByCategory.get(category.name) ?? {
      name: category.name,
      color: category.color,
      count: 0,
    };
    current.count += 1;
    countByCategory.set(category.name, current);
  }
  // Uncategorized work is excluded from the bars but still counts in
  // `completedTasks.length`, so the shares below are percentages of all
  // completed tasks and legitimately add up to less than 100.
  const categoryMix = [...countByCategory.values()]
    .map((c) => ({ ...c, share: Math.round((c.count / Math.max(1, completedTasks.length)) * 100) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const weeklyRows: WeeklyReviewRow[] = weekly.map((r) => ({
    id: r.id,
    periodLabel: r.periodLabel,
    range: `${formatIndianShort(r.weekStart)} – ${formatIndianShort(r.weekEnd)}`,
    summary: r.summary,
    metrics: r.metrics as Record<string, number>,
    highlights: normalizeSections(r.highlights),
    misses: normalizeSections(r.misses),
    patterns: normalizeSections(r.patterns),
    recommendations: normalizeSections(r.recommendations),
    provider: r.provider,
    generatedAt: r.createdAt.toISOString(),
  }));

  const monthlyRows: MonthlyReportRow[] = monthly.map((r) => ({
    id: r.id,
    monthLabel: r.monthLabel,
    range: `${formatIndianShort(r.monthStart)} – ${formatIndianShort(r.monthEnd)}`,
    summary: r.summary,
    metrics: r.metrics as Record<string, number>,
    achievements: normalizeSections(r.achievements),
    habitStats: (r.habitStats ?? []) as unknown as {
      name: string;
      ratePercent: number;
      completed: number;
      expected: number;
    }[],
    goalStats: (r.goalStats ?? []) as unknown as {
      title: string;
      progressPercent: number;
      status: string;
      milestones: string;
    }[],
    focusStats: (r.focusStats ?? []) as unknown as { day: string; minutes: number; sessions: number }[],
    timeStats: (r.timeStats ?? null) as unknown as {
      totalMinutes: number;
      byCategory: { name: string; minutes: number; sharePercent: number }[];
    } | null,
    lifeBalance: (r.lifeBalance ?? null) as unknown as {
      score?: number;
      byCategory?: { name: string; share: number }[];
    } | null,
    missed: normalizeSections(r.missed),
    recommendations: normalizeSections(r.recommendations),
    provider: r.provider,
    generatedAt: r.createdAt.toISOString(),
  }));

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Analytics</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          {completedTasks.length === 0 && habitLogs.length === 0
            ? "Thirty days of your own logged activity, and nothing invented."
            : `${completedTasks.length} tasks done · ${Math.round(habitLogs.filter((l) => l.completed).length)} habit completions · ${focusMinutesTotal} focus minutes, last ${TREND_DAYS} days`}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Figure
          label="Tasks completed"
          value={String(completedTasks.length)}
          detail={`${overdue.length} overdue right now`}
          tone={overdue.length > 0 ? "coral" : "neutral"}
        />
        <Figure
          label="Habit consistency"
          value={habitRate === null ? "—" : `${habitRate}%`}
          detail={habitRate === null ? "No habits tracked yet" : `${activeHabits.size} habits in the window`}
        />
        <Figure
          label="Focus time"
          value={`${focusMinutesTotal} min`}
          detail={`${Math.round(focusMinutesTotal / TREND_DAYS)} min a day on average`}
        />
        <Figure
          label="Journal entries"
          value={String(journals.length)}
          detail={`${journalPoints.filter((p) => p.value > 0).length} days with something written`}
        />
      </div>

      {stats ? (
        <Card tone="sunken">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-[12px] text-ink-muted">
            <span className="text-[13px] font-semibold text-ink">Level {stats.level}</span>
            <span>{stats.xp.toLocaleString("en-IN")} XP</span>
            <span>
              {stats.currentStreak} day streak
              {stats.longestStreak > stats.currentStreak ? ` (best ${stats.longestStreak})` : ""}
            </span>
            <span>{stats.tasksCompleted} tasks all time</span>
            <span>{stats.habitsCompleted} habit completions all time</span>
            <span>{stats.focusMinutes} focus minutes all time</span>
            {profile?.workStartMinutes != null && profile.workEndMinutes != null ? (
              <span className="text-ink-subtle">
                {profile.workLabel ?? "Work"}{" "}
                {minutesToLabel(profile.workStartMinutes)}–{minutesToLabel(profile.workEndMinutes)}
              </span>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <TrendCard
          title="Tasks completed per day"
          points={taskPoints}
          unit="tasks"
          tone="lime"
          note="Counted on the day the task was actually completed, not the day it was due. The dashed line is a seven-day average — the shaded area is each individual day, and the gap between them is the difference between a busy week and a busy day."
        />
        <TrendCard
          title="Focus minutes per day"
          points={focusPoints}
          unit="min"
          tone="iris"
          note="Elapsed time from finished focus sessions, including ones that ended early. Open timers are excluded, so a session left running cannot inflate this."
        />
        <TrendCard
          title="Habits completed per day"
          points={habitPoints}
          unit="completions"
          tone="aqua"
          note="One tick per habit per day. A habit at 4 of 20 pages counts once."
        />
        <TrendCard
          title="Journal entries per day"
          points={journalPoints}
          unit="entries"
          tone="lime"
          note="One point per entry, however long it is."
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Which days you get things done</CardTitle>
          </CardHeader>
          <CardContent>
            <WeekdayChart rows={weekdayTaskRows} />
          </CardContent>
        </Card>

        {categoryMix.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Where the completed work went</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <CategoryDonut
                entries={categoryMix.map((c) => ({ name: c.name, color: c.color, value: c.count }))}
              />
              <div className="flex flex-col gap-2 border-t border-line pt-3">
                {categoryMix.map((c) => (
                  <div key={c.name} className="flex items-center gap-3">
                    <span className="w-32 shrink-0 truncate text-[13px] text-ink-muted">{c.name}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <div
                        style={{ width: `${Math.max(2, c.share)}%`, backgroundColor: c.color }}
                        className="h-full rounded-full"
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right text-[12px] tabular-nums text-ink-subtle">
                      {c.count} · {c.share}%
                    </span>
                  </div>
                ))}
                <p className="pt-1 text-[11px] text-ink-subtle">
                  Share of completed tasks by category, counted not weighted. Tasks with
                  no category are left out of both charts, so the shares can add up to
                  less than 100%.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {achievements.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Achievements</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {achievements.map((a) => (
              <div
                key={a.id}
                className="flex min-w-52 flex-1 flex-col gap-0.5 rounded-control border border-line bg-surface-2 p-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-medium text-ink">
                    {a.achievement.name}
                  </span>
                  <Badge
                    variant={
                      a.achievement.rarity === "LEGENDARY"
                        ? "amber"
                        : a.achievement.rarity === "EPIC"
                          ? "iris"
                          : a.achievement.rarity === "RARE"
                            ? "aqua"
                            : "neutral"
                    }
                    size="sm"
                  >
                    {a.achievement.rarity.toLowerCase()}
                  </Badge>
                </div>
                <p className="text-[11px] leading-relaxed text-ink-subtle">
                  {a.unlockedAt
                    ? `Unlocked ${formatIndianShort(a.unlockedAt)}`
                    : `${Math.round(a.progress * 100)}% there`}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <ReportPanel weekly={weeklyRows} monthly={monthlyRows} aiEnabled={account?.aiEnabled ?? false} />

      <MetricDisclosure variant="balance" className="max-w-2xl" />
    </div>
  );
}

function TrendCard({
  title,
  points,
  unit,
  tone = "lime",
  note,
}: {
  title: string;
  points: ChartPoint[];
  unit: string;
  tone?: "lime" | "iris" | "aqua";
  note: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <TrendChart points={points} unit={unit} tone={tone} />
        <p className="text-[11px] leading-relaxed text-ink-subtle">{note}</p>
      </CardContent>
    </Card>
  );
}

function Figure({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "coral";
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="text-[11px] text-ink-subtle">{label}</span>
        <span
          className={
            tone === "coral" ? "text-2xl font-semibold tabular-nums text-coral" : "text-2xl font-semibold tabular-nums text-ink"
          }
        >
          {value}
        </span>
        <span className="text-[11px] text-ink-subtle">{detail}</span>
      </CardContent>
    </Card>
  );
}

function minutesToLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
