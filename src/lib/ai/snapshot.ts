import "server-only";

import { prisma } from "@/lib/db";
import { addDaysUtc, dateOnly, todayUtc } from "@/lib/date";
import { goalWorkProgress, type GoalWorkProgress } from "@/lib/progress";

/**
 * The single read model behind every heuristic in the AI layer.
 *
 * Insights, the assistant, the day planner and the reports all reason over the
 * same window of the user's life. Loading it once and analysing the plain object
 * has two benefits that justify the shape: the analysis functions stay pure and
 * testable without a database, and the screen cannot show a habit total computed
 * from one query and a completion rate computed from a slightly later one. The
 * last point matters more than it sounds — "you completed 68% of your habits" is
 * a claim about a period, and two reads a minute apart are two different periods.
 *
 * Every query is scoped by `userId` in the WHERE clause. Nothing here accepts a
 * user id from a request; it is always the caller's own.
 *
 * Dates arrive as UTC midnight because they came from `@db.Date` columns. Times
 * (`startAt`, `startedAt`, `dueAt`) are genuine instants and stay as `Date`.
 */

export interface SnapshotHabit {
  id: string;
  name: string;
  unit: string | null;
  targetValue: number;
  type: string;
  frequency: string;
  timesPerPeriod: number | null;
  targetMinutes: number | null;
  difficulty: string;
  preferredMinutes: number | null;
  startDate: Date;
  categoryId: string | null;
  categoryName: string | null;
  /**
   * Carried so fitness and study can be summarised without a second category
   * lookup. Both are modelled as ordinary habits under a category rather than as
   * their own tables, so the kind is the only thing that distinguishes them.
   */
  categoryKind: string | null;
  /**
   * Days of the week a WEEKLY habit is scheduled on, 0 = Sunday.
   *
   * Carried because a weekly habit that runs on Mon/Wed/Fri is not overdue on
   * Tuesday, and scoring it as though every day were expected would report a
   * permanent ~43% it can never escape. Empty means "no days recorded", which is
   * scored as daily — the same fallback the dashboard uses, so the two agree.
   */
  scheduledDays: number[];
}

export interface SnapshotHabitLog {
  habitId: string;
  date: Date;
  value: number;
  completed: boolean;
}

export interface SnapshotTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  estimatedMinutes: number | null;
  categoryId: string | null;
  categoryName: string | null;
  goalId: string | null;
}

export interface SnapshotFocusSession {
  startedAt: Date;
  endedAt: Date | null;
  plannedSeconds: number;
  actualSeconds: number;
  rating: number | null;
  endedEarly: boolean;
  type: string;
  taskTitle: string | null;
  /**
   * Added so focus time can be attributed up the hierarchy. `taskTitle` alone
   * cannot answer "how much of this week went into the launch project" because
   * the project link lives on the row, not in the title text.
   */
  taskId: string | null;
  projectId: string | null;
  projectName: string | null;
}

export interface SnapshotMoodEnergy {
  date: Date;
  mood: number;
  energy: number;
  stress: number;
  sleepQuality: number;
  sleepHours: number | null;
}

export interface SnapshotJournal {
  date: Date;
  wordCount: number;
  mood: number | null;
  tags: string[];
}

export interface SnapshotTimeBlock {
  date: Date;
  startAt: Date;
  endAt: Date;
  locked: boolean;
  source: string;
  title: string;
}

export interface SnapshotGoal {
  id: string;
  title: string;
  status: string;
  horizon: string;
  /** The user's own figure, set by hand. See `@/lib/progress`. */
  progress: number;
  startDate: Date | null;
  targetDate: Date | null;
  categoryName: string | null;
  milestoneCount: number;
  doneMilestoneCount: number;
  taskCount: number;
  doneTaskCount: number;
  /** What the milestones and tasks actually say, next to the stated figure. */
  derived: GoalWorkProgress;
}

export interface SnapshotProject {
  id: string;
  name: string;
  status: string;
  dueAt: Date | null;
  taskCount: number;
  doneTaskCount: number;
  milestoneCount: number;
  doneMilestoneCount: number;
  /** The goal this project serves. Null is normal: a project can stand alone. */
  goalId: string | null;
  goalTitle: string | null;
  /**
   * Focus seconds landed on this project *within the snapshot window* only.
   * The underlying session query reaches back further than the window to give
   * streak arithmetic its runway, so this is filtered rather than summed
   * straight off the relation - otherwise a project would appear to have
   * absorbed two months of focus while the panel claims to describe one week.
   */
  focusSeconds: number;
  /**
   * The project's own tasks, carried as a rollup rather than only as counts.
   * Per-project momentum needs each task's `completedAt`; without this the only
   * way to compute it is to hand every project the whole task list, which
   * reports the user's total throughput as if each project had earned it.
   */
  tasks: { status: string; completedAt: Date | null }[];
}

export interface SnapshotRoutine {
  id: string;
  name: string;
  kind: string;
  isActive: boolean;
  itemCount: number;
  runCount: number;
  completedRunCount: number;
}

export interface SnapshotProfile {
  name: string | null;
  workLabel: string | null;
  workStartMinutes: number | null;
  workEndMinutes: number | null;
  workDays: number[] | null;
  collegeLabel: string | null;
  collegeStartMinutes: number | null;
  collegeEndMinutes: number | null;
  collegeDays: number[] | null;
  wakeMinutes: number | null;
  sleepMinutes: number | null;
  availableWeekdayMinutes: number | null;
  availableWeekendMinutes: number | null;
  studyTargetMinutes: number | null;
  fitnessFrequency: number | null;
  productivityStyle: string | null;
  focusPreference: string | null;
  aiEnabled: boolean;
  aiConsentAt: Date | null;
  weekStartsOn: number;
  dailySummaryTime: number;
  quietHoursStart: number;
  quietHoursEnd: number;
}

export interface LifeSnapshot {
  userId: string;
  /** Inclusive UTC-midnight bounds of the analysed window. */
  from: Date;
  to: Date;
  profile: SnapshotProfile;
  habits: SnapshotHabit[];
  habitLogs: SnapshotHabitLog[];
  tasks: SnapshotTask[];
  focusSessions: SnapshotFocusSession[];
  moodEnergy: SnapshotMoodEnergy[];
  journal: SnapshotJournal[];
  timeBlocks: SnapshotTimeBlock[];
  goals: SnapshotGoal[];
  projects: SnapshotProject[];
  routines: SnapshotRoutine[];
  /** True when the user is new enough that no analysis would be meaningful. */
  sparse: boolean;
}

export interface SnapshotOptions {
  /** Days back from today, inclusive of today. Default 30. */
  days?: number;
  /** Look forward this many days for deadlines and plans. Default 14. */
  lookaheadDays?: number;
  /** Overrides `days`, for callers that want an exact window. */
  from?: Date;
  to?: Date;
}

/**
 * Load the whole read model in one place.
 *
 * The queries run in parallel because they are independent, and the whole thing
 * is a `Promise.all` rather than fifteen sequential awaits: this is called on
 * page load for insights, the AI screen and analytics, and serialising it would
 * be felt. The trade is that it is a heavier single request than any one screen
 * strictly needs, which is acceptable because the payload is small — counts and
 * short labels, never entry bodies.
 */
export async function loadSnapshot(
  userId: string,
  options: SnapshotOptions = {},
): Promise<LifeSnapshot> {
  const now = new Date();
  const today = dateOnly(now);
  const to = options.to ?? today;
  const from =
    options.from ??
    addDaysUtc(today, -((options.days ?? 30) - 1));
  const historyFrom = addDaysUtc(from, -60); // extra runway for streak arithmetic
  const futureTo = addDaysUtc(today, options.lookaheadDays ?? 14);

  const [
    user,
    habits,
    habitLogs,
    tasks,
    focusSessions,
    moodEnergy,
    journal,
    timeBlocks,
    goals,
    projects,
    routines,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        aiEnabled: true,
        aiConsentAt: true,
        weekStartsOn: true,
        dailySummaryTime: true,
        quietHoursStart: true,
        quietHoursEnd: true,
        profile: {
          select: {
            workLabel: true,
            workStartMinutes: true,
            workEndMinutes: true,
            workDays: true,
            collegeLabel: true,
            collegeStartMinutes: true,
            collegeEndMinutes: true,
            collegeDays: true,
            wakeMinutes: true,
            sleepMinutes: true,
            availableWeekdayMinutes: true,
            availableWeekendMinutes: true,
            studyTargetMinutes: true,
            fitnessFrequency: true,
            productivityStyle: true,
            focusPreference: true,
          },
        },
      },
    }),
    prisma.habit.findMany({
      where: { userId, archivedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        unit: true,
        targetValue: true,
        type: true,
        frequency: true,
        timesPerPeriod: true,
        targetMinutes: true,
        difficulty: true,
        preferredMinutes: true,
        startDate: true,
        categoryId: true,
        category: { select: { name: true, kind: true } },
        schedule: { select: { dayOfWeek: true } },
      },
    }),
    prisma.habitLog.findMany({
      where: { userId, date: { gte: historyFrom, lte: to } },
      orderBy: { date: "asc" },
      select: { habitId: true, date: true, value: true, completed: true },
    }),
    prisma.task.findMany({
      where: { userId, createdAt: { lte: futureTo }, parentId: null },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueAt: true,
        completedAt: true,
        createdAt: true,
        estimatedMinutes: true,
        categoryId: true,
        goalId: true,
        category: { select: { name: true } },
      },
    }),
    prisma.focusSession.findMany({
      where: { userId, startedAt: { gte: historyFrom, lte: futureTo } },
      orderBy: { startedAt: "asc" },
      take: 500,
      select: {
        startedAt: true,
        endedAt: true,
        plannedSeconds: true,
        actualSeconds: true,
        rating: true,
        endedEarly: true,
        type: true,
        task: { select: { title: true } },
        project: { select: { id: true, name: true } },
        taskId: true,
        projectId: true,
      },
    }),
    prisma.moodEnergyEntry.findMany({
      where: { userId, date: { gte: historyFrom, lte: to } },
      orderBy: { date: "asc" },
      select: {
        date: true,
        mood: true,
        energy: true,
        stress: true,
        sleepQuality: true,
        sleepHours: true,
      },
    }),
    prisma.journalEntry.findMany({
      where: { userId, date: { gte: historyFrom, lte: to } },
      orderBy: { date: "asc" },
      select: { date: true, wordCount: true, mood: true, tags: true },
    }),
    prisma.timeBlock.findMany({
      where: { userId, date: { gte: from, lte: futureTo } },
      orderBy: { startAt: "asc" },
      select: {
        date: true,
        startAt: true,
        endAt: true,
        locked: true,
        source: true,
        title: true,
      },
    }),
    prisma.goal.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        status: true,
        horizon: true,
        progress: true,
        startDate: true,
        targetDate: true,
        category: { select: { name: true } },
        _count: { select: { milestones: true, tasks: true } },
        milestones: { select: { status: true } },
        tasks: { select: { status: true } },
      },
    }),
    prisma.project.findMany({
      where: { userId, status: { notIn: ["ARCHIVED"] } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        name: true,
        status: true,
        dueAt: true,
        goalId: true,
        goal: { select: { title: true } },
        _count: { select: { tasks: true, milestones: true } },
        tasks: { select: { task: { select: { status: true, completedAt: true } } } },
        milestones: { where: { status: "DONE" }, select: { id: true } },
        focusSessions: { select: { actualSeconds: true, startedAt: true } },
      },
    }),
    prisma.routine.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: {
        id: true,
        name: true,
        kind: true,
        isActive: true,
        _count: { select: { items: true, runs: true } },
        runs: { where: { completedAt: { not: null } }, select: { id: true } },
      },
    }),
  ]);

  if (!user) {
    // A session user always has a row, so this is a consistency failure rather
    // than a routine "no data" case. Returning a sparse snapshot keeps every
    // caller total instead of forcing each one to null-check.
    return {
      userId,
      from,
      to,
      profile: {
        name: null,
        workLabel: null,
        workStartMinutes: null,
        workEndMinutes: null,
        workDays: null,
        collegeLabel: null,
        collegeStartMinutes: null,
        collegeEndMinutes: null,
        collegeDays: null,
        wakeMinutes: null,
        sleepMinutes: null,
        availableWeekdayMinutes: null,
        availableWeekendMinutes: null,
        studyTargetMinutes: null,
        fitnessFrequency: null,
        productivityStyle: null,
        focusPreference: null,
        aiEnabled: false,
        aiConsentAt: null,
        weekStartsOn: 1,
        dailySummaryTime: 20,
        quietHoursStart: 22,
        quietHoursEnd: 7,
      },
      habits: [],
      habitLogs: [],
      tasks: [],
      focusSessions: [],
      moodEnergy: [],
      journal: [],
      timeBlocks: [],
      goals: [],
      projects: [],
      routines: [],
      sparse: true,
    };
  }

  const snapshot: LifeSnapshot = {
    userId,
    from,
    to,
    profile: {
      name: user.name,
      workLabel: user.profile?.workLabel ?? null,
      workStartMinutes: user.profile?.workStartMinutes ?? null,
      workEndMinutes: user.profile?.workEndMinutes ?? null,
      workDays: (user.profile?.workDays as number[] | null) ?? null,
      collegeLabel: user.profile?.collegeLabel ?? null,
      collegeStartMinutes: user.profile?.collegeStartMinutes ?? null,
      collegeEndMinutes: user.profile?.collegeEndMinutes ?? null,
      collegeDays: (user.profile?.collegeDays as number[] | null) ?? null,
      wakeMinutes: user.profile?.wakeMinutes ?? null,
      sleepMinutes: user.profile?.sleepMinutes ?? null,
      availableWeekdayMinutes: user.profile?.availableWeekdayMinutes ?? null,
      availableWeekendMinutes: user.profile?.availableWeekendMinutes ?? null,
      studyTargetMinutes: user.profile?.studyTargetMinutes ?? null,
      fitnessFrequency: user.profile?.fitnessFrequency ?? null,
      productivityStyle: user.profile?.productivityStyle ?? null,
      focusPreference: user.profile?.focusPreference ?? null,
      aiEnabled: user.aiEnabled,
      aiConsentAt: user.aiConsentAt,
      weekStartsOn: user.weekStartsOn,
      dailySummaryTime: user.dailySummaryTime,
      quietHoursStart: user.quietHoursStart,
      quietHoursEnd: user.quietHoursEnd,
    },
    habits: habits.map((h) => ({
      id: h.id,
      name: h.name,
      unit: h.unit,
      targetValue: h.targetValue,
      type: h.type,
      frequency: h.frequency,
      timesPerPeriod: h.timesPerPeriod,
      targetMinutes: h.targetMinutes,
      difficulty: h.difficulty,
      preferredMinutes: h.preferredMinutes,
      startDate: h.startDate,
      categoryId: h.categoryId,
      categoryName: h.category?.name ?? null,
      categoryKind: h.category?.kind ?? null,
      scheduledDays: h.schedule.map((s) => s.dayOfWeek).sort((a, b) => a - b),
    })),
    habitLogs,
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueAt: t.dueAt,
      completedAt: t.completedAt,
      createdAt: t.createdAt,
      estimatedMinutes: t.estimatedMinutes,
      categoryId: t.categoryId,
      categoryName: t.category?.name ?? null,
      goalId: t.goalId,
    })),
    focusSessions: focusSessions.map((f) => ({
      startedAt: f.startedAt,
      endedAt: f.endedAt,
      plannedSeconds: f.plannedSeconds,
      actualSeconds: f.actualSeconds,
      rating: f.rating,
      endedEarly: f.endedEarly,
      type: f.type,
      taskTitle: f.task?.title ?? null,
      taskId: f.taskId,
      projectId: f.projectId,
      projectName: f.project?.name ?? null,
    })),
    moodEnergy,
    journal: journal.map((j) => ({
      date: j.date,
      wordCount: j.wordCount,
      mood: j.mood,
      tags: j.tags,
    })),
    timeBlocks: timeBlocks.map((b) => ({
      date: b.date,
      startAt: b.startAt,
      endAt: b.endAt,
      locked: b.locked,
      source: b.source,
      title: b.title,
    })),
    goals: goals.map((g) => ({
      id: g.id,
      title: g.title,
      status: g.status,
      horizon: g.horizon,
      progress: g.progress,
      startDate: g.startDate,
      targetDate: g.targetDate,
      categoryName: g.category?.name ?? null,
      milestoneCount: g._count.milestones,
      doneMilestoneCount: g.milestones.filter((m) => m.status === "DONE").length,
      taskCount: g.tasks.length,
      doneTaskCount: g.tasks.filter((t) => t.status === "DONE").length,
      // The stated figure is the user's; this is what the work says. Both travel
      // together so no screen has to choose which one it was shown.
      derived: goalWorkProgress({
        statedPercent: g.progress,
        tasks: g.tasks,
        milestones: g.milestones,
      }),
    })),
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      dueAt: p.dueAt,
      taskCount: p.tasks.length,
      doneTaskCount: p.tasks.filter((link) => link.task.status === "DONE").length,
      milestoneCount: p._count.milestones,
      doneMilestoneCount: p.milestones.length,
      goalId: p.goalId,
      goalTitle: p.goal?.title ?? null,
      focusSeconds: p.focusSessions.reduce(
        (sum, f) =>
          f.startedAt >= from && f.startedAt <= to ? sum + f.actualSeconds : sum,
        0,
      ),
      tasks: p.tasks.map((link) => ({
        status: link.task.status,
        completedAt: link.task.completedAt,
      })),
    })),
    routines: routines.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      isActive: r.isActive,
      itemCount: r._count.items,
      runCount: r._count.runs,
      completedRunCount: r.runs.length,
    })),
    sparse: false,
  };

  // "Sparse" is what every analysis function checks before it says anything. A
  // user with three rows in the window is not a user with a pattern; treating
  // them as one is how a product ends up telling someone their resting heart
  // rate is low on the strength of two readings.
  const signal =
    snapshot.habitLogs.length +
    snapshot.focusSessions.length +
    snapshot.moodEnergy.length +
    snapshot.journal.length +
    snapshot.tasks.filter((t) => t.completedAt !== null).length;
  snapshot.sparse = signal < MIN_SIGNALS;

  return snapshot;
}

/**
 * How much recorded activity is needed before analysis is worth showing.
 *
 * Ten is roughly a week of a single daily habit, which is the point at which a
 * "you do X more on weekdays" claim has two observations to compare rather than
 * one. Below it, the insights screen says what it needs rather than guessing.
 */
const MIN_SIGNALS = 10;

/** Today in UTC midnight, re-exported so callers do not import `@/lib/date` too. */
export { todayUtc };
