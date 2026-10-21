import { format } from "date-fns";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Flame,
  Timer,
  TrendingUp,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, MetricDisclosure } from "@/components/feedback/empty-state";
import { WeekStrip, type WeekDay } from "@/components/app/week-strip";
import { DashboardInsights } from "@/components/app/dashboard-panels";
import { loadSnapshot } from "@/lib/ai/snapshot";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { addDaysUtc, todayUtc } from "@/lib/date";
import { ensureActiveSchedule } from "@/lib/fitness/schedule";
import { formatIndianLong, indianWeek } from "@/lib/format/date";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * The dashboard.
 *
 * Everything here is a direct query rather than an API call: this is a server
 * component rendering its own data, so a round trip through HTTP would only add
 * a serialisation step. The API routes exist for the interactive surfaces.
 *
 * All queries are scoped by `userId` in the WHERE clause, never filtered after
 * the fact, so there is no path by which one account's rows reach another's page.
 *
 * Two read paths coexist deliberately. The cards in this file query only what
 * "today" needs, because a glanceable surface should not pay for thirty days of
 * history. The analytical panels further down are derived from `loadSnapshot`,
 * the same read model the insights, analytics and AI screens use, so a goal
 * progress figure here cannot disagree with the one over there.
 */

/** How many habits the dashboard previews before deferring to the habits page. */
const HABIT_PREVIEW = 5;

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const user = await requireUser();
  const now = new Date();
  // UTC midnight, because these are `@db.Date` columns. See `src/lib/date.ts`.
  const today = todayUtc();
  /**
   * The window is the *calendar week* containing today, Sunday first — not "the
   * last seven days". Those only agree when today happens to be a Saturday, and
   * on any other day the strip would slide: anchoring a Sunday-first week on a
   * mid-week start puts the Sunday *before* it, which pushes every cell back and
   * drops today off the end entirely. On a Sunday the two are seven days apart.
   */
  const week = indianWeek(today);
  const weekStart = week[0]!;
  const weekEnd = week[week.length - 1]!;

  /**
   * The shared read model, loaded in parallel with the day-scoped queries
   * below. Both hit the same tables, so they are issued together rather than in
   * sequence; a second read of the same row a moment later is a different
   * period, which is the reason the snapshot exists.
   */
  const snapshotPromise = loadSnapshot(user.id, { days: 30 });

  /**
   * Top up the active workout routine's materialised schedule before reading it,
   * so "this week's training" is populated on the home screen even on a day the
   * user has not opened the fitness page. Idempotent and horizon-bounded, so it
   * is a no-op once the schedule is filled.
   */
  await ensureActiveSchedule(user.id);

  const trainingEnd = addDaysUtc(today, 6);

  /**
   * Run as one round trip. Independent counts would each be their own query;
   * this is one, and the numbers arrive together.
   */
  const [
    openTasks,
    todayBlocks,
    habits,
    habitTotal,
    todayLogs,
    weekLogs,
    wellbeing,
    insights,
    streak,
    weekTraining,
  ] = await Promise.all([
    prisma.task.count({
      where: { userId: user.id, status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] } },
    }),
    prisma.timeBlock.findMany({
      where: { userId: user.id, date: today },
      orderBy: { startAt: "asc" },
      take: 6,
    }),
    prisma.habit.findMany({
      where: { userId: user.id, isActive: true, archivedAt: null },
      orderBy: { name: "asc" },
      take: HABIT_PREVIEW,
      select: { id: true, name: true, color: true, icon: true },
    }),
    prisma.habit.count({
      where: { userId: user.id, isActive: true, archivedAt: null },
    }),
    prisma.habitLog.findMany({
      where: { userId: user.id, date: today },
      select: { habitId: true, completed: true },
    }),
    /**
     * The whole week in one query, rather than seven count queries. Only the
     * `date` and `completed` columns come back, so this stays cheap even for a
     * heavy history — it is a scan of a narrow index range, not a row fetch.
     *
     * Days after today are included in the range so the strip can render a full
     * Sunday-to-Saturday week with future days dimmed, rather than a row that
     * visibly stops at today and looks broken.
     */
    prisma.habitLog.findMany({
      where: {
        userId: user.id,
        date: { gte: weekStart, lte: weekEnd },
      },
      select: { date: true, habitId: true, completed: true },
    }),
    prisma.moodEnergyEntry.findUnique({
      where: { userId_date: { userId: user.id, date: today } },
    }),
    prisma.insight.findMany({
      where: { userId: user.id, status: { in: ["NEW", "SEEN"] } },
      orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
      take: 2,
    }),
    prisma.userStats.findUnique({ where: { userId: user.id } }),
    prisma.workout.findMany({
      where: {
        userId: user.id,
        status: { in: ["PLANNED", "IN_PROGRESS"] },
        date: { gte: today, lte: trainingEnd },
      },
      orderBy: [{ date: "asc" }, { startAt: "asc" }],
      take: 5,
      select: {
        id: true,
        name: true,
        date: true,
        status: true,
        muscleGroups: true,
        minutes: true,
      },
    }),
  ]);

  const snapshot = await snapshotPromise;

  /**
   * Completion is measured against every active habit, not the short preview
   * list below, and is a set so a habit logged several times in one day counts
   * once. Clamped, because a COUNT habit can exceed its target in a day and
   * "140% of habits done" is not a useful thing to show anyone.
   */
  const doneToday = new Set(
    todayLogs.filter((log) => log.completed).map((log) => log.habitId),
  );
  const doneCount = Math.min(doneToday.size, habitTotal);
  const habitCompletion =
    habitTotal === 0 ? null : Math.round((doneCount / habitTotal) * 100);
  const hiddenHabits = Math.max(habitTotal - habits.length, 0);

  /**
   * Collapse the week's logs into one entry per day.
   *
   * Two details matter. Logs are keyed by habit *and* day in a set, because a
   * COUNT habit logged three times in a day is one habit done, not three — the
   * same reasoning as `doneToday` above. And the denominator is `habitTotal` as
   * it is *today*, applied to every day in the strip: a user who added a habit
   * last month would otherwise see every earlier day silently jump to 100% the
   * day they added it, which is a reward for signing up, not a measurement.
   */
  const weekDays: WeekDay[] = week.map((date) => {
    const dayKey = date.getTime();
    const done = new Set(
      weekLogs
        .filter((log) => log.date.getTime() === dayKey && log.completed)
        .map((log) => log.habitId),
    ).size;
    const clamped = Math.min(done, habitTotal);

    return {
      date,
      done: clamped,
      total: habitTotal,
      completion: habitTotal === 0 ? null : Math.round((clamped / habitTotal) * 100),
      isToday: dayKey === today.getTime(),
      isFuture: dayKey > today.getTime(),
    };
  });

  const focusMinutes = streak?.focusMinutes ?? 0;
  const firstName = user.name?.split(" ")[0] ?? "there";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] text-ink-subtle">
            {formatIndianLong(now)}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.02em]">
            {greeting(now)}, {firstName}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" asChild>
            <a href="/planner">
              <CalendarClock aria-hidden />
              Plan the day
            </a>
          </Button>
        </div>
      </header>

      <section
        aria-label="At a glance"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <Stat
          accentClass="text-lime"
          glow="var(--lime-soft)"
          label="Open tasks"
          value={String(openTasks)}
          hint={openTasks === 0 ? "All clear" : "across every list"}
          icon={CheckCircle2}
        />
        <Stat
          accentClass="text-iris"
          glow="var(--iris-soft)"
          label="Habits today"
          value={habitCompletion === null ? "—" : `${habitCompletion}%`}
          hint={
            habitTotal === 0 ? "none tracked" : `${doneCount} of ${habitTotal} done`
          }
          icon={Flame}
        />
        <Stat
          accentClass="text-aqua"
          glow="var(--cyan-soft)"
          label="Focus logged"
          value={focusMinutes >= 60 ? `${Math.floor(focusMinutes / 60)}h` : `${focusMinutes}m`}
          hint="lifetime total"
          icon={Timer}
        />
        <Stat
          accentClass="text-amber"
          glow="color-mix(in oklab, var(--amber) 18%, transparent)"
          label="Level"
          value={streak ? String(streak.level) : "1"}
          hint={streak ? `${streak.xp} XP` : "just started"}
          icon={TrendingUp}
        />
      </section>

      <WeekStrip days={weekDays} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Today’s schedule</CardTitle>
            <Button variant="ghost" size="xs" asChild>
              <a href="/planner">
                Open planner
                <ArrowRight aria-hidden />
              </a>
            </Button>
          </CardHeader>
          <CardContent>
            {todayBlocks.length === 0 ? (
              <EmptyState
                icon={CalendarClock}
                title="Nothing scheduled"
                description="Block out the day in the planner and see the open hours left over."
                action={{ label: "Open planner", href: "/planner" }}
              />
            ) : (
              <ol className="flex flex-col gap-1">
                {todayBlocks.map((block) => {
                  const past = block.endAt.getTime() < now.getTime();
                  return (
                    <li
                      key={block.id}
                      className="flex items-center gap-3 rounded-control px-2 py-2 transition-colors hover:bg-surface-2"
                    >
                      <span className="w-12 shrink-0 font-mono text-[11px] text-ink-subtle">
                        {format(block.startAt, "HH:mm")}
                      </span>
                      <span
                        aria-hidden
                        className="h-6 w-[3px] shrink-0 rounded-full"
                        style={{ backgroundColor: block.color ?? "var(--lime)" }}
                      />
                      <span
                        className={
                          past
                            ? "flex-1 truncate text-[13px] text-ink-subtle line-through"
                            : "flex-1 truncate text-[13px] text-ink"
                        }
                      >
                        {block.title}
                      </span>
                      {block.locked ? (
                        <Badge variant="outline" size="sm">
                          Fixed
                        </Badge>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="space-y-0 pb-3">
              <CardTitle className="text-[13px]">Habits</CardTitle>
            </CardHeader>
            <CardContent>
              {habits.length === 0 ? (
                <p className="text-[13px] text-ink-subtle">
                  No habits yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {habits.map((habit) => {
                    const done = doneToday.has(habit.id);
                    return (
                      <li key={habit.id} className="flex items-center gap-2.5">
                        <span
                          aria-hidden
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: habit.color }}
                        />
                        <span
                          className={
                            done
                              ? "flex-1 truncate text-[13px] text-ink-subtle line-through"
                              : "flex-1 truncate text-[13px]"
                          }
                        >
                          {habit.name}
                        </span>
                        {done ? (
                          <CheckCircle2 aria-hidden className="size-4 shrink-0 text-lime" />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
              {hiddenHabits > 0 ? (
                <Button variant="ghost" size="xs" className="mt-3 w-full" asChild>
                  <a href="/habits">
                    +{hiddenHabits} more{" "}
                    {hiddenHabits === 1 ? "habit" : "habits"}
                    <ArrowRight aria-hidden />
                  </a>
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-0 pb-3">
              <CardTitle className="text-[13px]">Wellbeing</CardTitle>
            </CardHeader>
            <CardContent>
              {wellbeing ? (
                <dl className="grid grid-cols-3 gap-2 text-center">
                  <Scale label="Mood" value={wellbeing.mood} />
                  <Scale label="Energy" value={wellbeing.energy} />
                  <Scale label="Stress" value={wellbeing.stress} />
                </dl>
              ) : (
                <p className="text-[13px] text-ink-subtle">
                  Log how you feel to see it here.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-[13px]">This week’s training</CardTitle>
              <Button variant="ghost" size="xs" asChild>
                <a href="/fitness">
                  Plan
                  <ArrowRight aria-hidden />
                </a>
              </Button>
            </CardHeader>
            <CardContent>
              {weekTraining.length === 0 ? (
                <p className="text-[13px] text-ink-subtle">
                  Nothing scheduled. Build a routine on the fitness page.
                </p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {weekTraining.map((workout) => (
                    <li key={workout.id} className="flex items-center gap-2.5">
                      <span className="w-8 shrink-0 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
                        {weekdayLabel(workout.date)}
                      </span>
                      <span className="flex-1 truncate text-[13px]">
                        {workout.name}
                        {workout.muscleGroups.length > 0 ? (
                          <span className="text-ink-subtle">
                            {" "}
                            · {workout.muscleGroups.slice(0, 2).join(", ")}
                          </span>
                        ) : null}
                      </span>
                      {workout.status === "IN_PROGRESS" ? (
                        <Badge variant="amber" size="sm">
                          Now
                        </Badge>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {insights.length > 0 ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>What your data is saying</CardTitle>
            <Button variant="ghost" size="xs" asChild>
              <a href="/insights">
                All insights
                <ArrowRight aria-hidden />
              </a>
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {insights.map((insight) => (
              <div key={insight.id} className="rounded-control border border-line p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[13px] font-medium">{insight.title}</h3>
                  <Badge variant="iris" size="sm">
                    {Math.round(insight.confidence * 100)}%
                  </Badge>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
                  {insight.body}
                </p>
              </div>
            ))}
            <MetricDisclosure variant="insight" className="sm:col-span-2" />
          </CardContent>
        </Card>
      ) : null}

      <DashboardInsights snapshot={snapshot} />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  icon: Icon,
  accentClass = "text-lime",
  glow = "var(--lime-soft)",
}: {
  label: string;
  value: string;
  hint: string;
  accentClass?: string;
  glow?: string;
  icon: typeof CheckCircle2;
}) {
  return (
    <Card className="relative overflow-hidden p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-10 size-24 rounded-full"
        style={{ background: `radial-gradient(circle, ${glow}, transparent 70%)` }}
      />
      <div className="relative">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "grid size-7 place-items-center rounded-[9px] border border-line",
              accentClass,
            )}
            style={{
              backgroundImage: `linear-gradient(135deg, ${glow}, transparent)`,
            }}
          >
            <Icon aria-hidden className="size-3.5" />
          </span>
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-subtle">
            {label}
          </span>
        </div>
        <p className="mt-3 text-2xl font-semibold tracking-[-0.02em] tabular-nums">
          {value}
        </p>
        <p className="mt-0.5 text-[11px] text-ink-subtle">{hint}</p>
      </div>
    </Card>
  );
}

/** Short weekday for a `@db.Date`, read from UTC so the day never shifts. */
function weekdayLabel(date: Date): string {
  return date.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
}

/** A single 1-5 wellbeing reading, drawn as five pips rather than a number alone. */
function Scale({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-subtle">{label}</dt>
      <dd className="mt-1.5 flex justify-center gap-1">
        {[1, 2, 3, 4, 5].map((step) => (
          <span
            key={step}
            aria-hidden
            className={
              step <= value
                ? "h-1.5 w-4 rounded-full bg-lime"
                : "h-1.5 w-4 rounded-full bg-surface-3"
            }
          />
        ))}
      </dd>
    </div>
  );
}
