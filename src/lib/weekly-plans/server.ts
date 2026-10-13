import "server-only";

import { ApiError } from "@/lib/api/errors";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { dateOnly } from "@/lib/date";
import { isoDayToDateOnly } from "@/lib/weekly-plans/week";
import { planProgress, type PlanProgress } from "@/lib/weekly-plans/progress";


/**
 * Loading a weekly plan with its derived progress.
 *
 * The arithmetic lives in `@/lib/weekly-plans/progress` and is pure. This module
 * owns the queries that feed it, which is the split that lets the maths be tested
 * without a database while every reader in the app — page, API, dashboard panel,
 * review — gets the same numbers from one place.
 *
 * Two decisions here are load-bearing and both are about not lying:
 *
 * 1. **The measure window is clamped to the plan's own dates.** A plan for the
 *    week of the 28th must not count a focus session from three weeks ago, and a
 *    plan covering a fortnight must count all fourteen days. Intersecting with
 *    `[startDate, endDate]` rather than trusting the caller's range is what makes
 *    a plan's progress independent of how wide a date filter the request used.
 * 2. **Sessions are filtered to the plan's own task ids.** `FocusSession.taskId`
 *    is nullable and set to null on task delete, so an unattributed session is
 *    genuinely unknown rather than merely undiscovered. It is counted nowhere and
 *    the UI's empty-state copy says why.
 */

/** A plan plus everything needed to render its card, joined from one query. */
export interface LoadedPlan extends PlanProgress {
  id: string;
  name: string;
  description: string | null;
  category: string;
  targetType: string;
  manualActual: number | null;
  startDate: Date;
  endDate: Date;
  goalId: string | null;
  projectId: string | null;
  goal: { id: string; title: string } | null;
  project: { id: string; name: string } | null;
  days: { dayOfWeek: number; note: string | null }[];
  tasks: {
    id: string;
    title: string;
    status: string;
    priority: string;
    dueAt: Date | null;
    estimatedMinutes: number | null;
    sortOrder: number;
    /** 0 = Sunday .. 6 = Saturday, or null when the task is not pinned to a day. */
    dayOfWeek: number | null;
  }[];
  habits: { id: string; name: string; color: string; unit: string | null }[];
  taskCount: number;
  habitCount: number;
}

const planInclude = {
  goal: { select: { id: true, title: true } },
  project: { select: { id: true, name: true } },
  days: { orderBy: { dayOfWeek: "asc" as const } },
  tasks: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      task: {
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          dueAt: true,
          estimatedMinutes: true,
          // Read, not assumed. `completedAt` is a real column and a `DONE` task is
          // expected to carry it; hardcoding null here hid that, and would have made
          // any future "completed during this week" question unanswerable from this
          // already-loaded row.
          completedAt: true,
        },
      },
    },
  },
  habits: {
    include: { habit: { select: { id: true, name: true, color: true, unit: true } } },
  },
} as const;

/**
 * The one place a plan is read with its relations.
 *
 * Every reader — `loadPlan`, `loadPlansInRange` — goes through this so the include
 * shape cannot drift between them and produce two different `LoadedPlan`s.
 */
function findPlanRow(planId: string) {
  return prisma.weeklyPlan.findUnique({ where: { id: planId }, include: planInclude });
}

/**
 * The row shape a plan-plus-includes query returns.
 *
 * Derived from the client rather than hand-written. Prisma 7 does not export a
 * `GetPayload` helper from the generated entrypoint, and spelling out ~20 field
 * types by hand is exactly the sort of thing that silently drifts from the schema
 * the next time a column is added.
 */
type PlanRow = NonNullable<Awaited<ReturnType<typeof findPlanRow>>>;

/**
 * Half-open instant range covering a plan's own days.
 *
 * `endDate` is a `@db.Date` at UTC midnight and is *inclusive*, so the range runs
 * to the following midnight. Using `endDate` itself as the exclusive bound would
 * silently drop anything logged on the final day — which is exactly the day a
 * weekly review reads, so the loss would land on the number that matters most.
 */
function planRange(plan: { startDate: Date; endDate: Date }): { from: Date; to: Date } {
  const from = dateOnly(plan.startDate);
  const to = new Date(dateOnly(plan.endDate).getTime() + 24 * 60 * 60 * 1000);
  return { from, to };
}

/**
 * Load one plan, scoped to `userId`, with progress derived.
 *
 * Throws 404 when the plan does not exist or belongs to someone else. Both cases
 * are the same response on purpose — a 403 would confirm that the id exists,
 * which leaks another user's data.
 */
export async function loadPlan(userId: string, planId: string): Promise<LoadedPlan> {
  const plan = await findPlanRow(planId);
  assertOwnership(plan, userId, "That weekly plan no longer exists.");
  return serialisePlan(plan!, userId);
}

/**
 * Load a plan the current request has just created.
 *
 * Ownership is already established — the id came back from a create scoped to this
 * user — so this re-reads the row but skips the ownership assert. It exists so a
 * create route returns its plan through the exact same serialisation the page and
 * the list route use. Assembling a response from the create payload instead would
 * give the client a second path to the same shape, and two paths to one shape is
 * how a card ends up disagreeing with the board it sits on.
 */
export async function loadNewPlan(userId: string, planId: string): Promise<LoadedPlan> {
  const plan = await findPlanRow(planId);
  return serialisePlan(plan!, userId);
}

/**
 * Turn a loaded row into the shape the UI and API return.
 *
 * The Prisma row is not returned directly. `tasks` and `habits` are join rows
 * wrapping the real record, and shipping that shape would make every consumer
 * remember to reach through a level it does not care about.
 */
export async function serialisePlan(plan: PlanRow, userId: string): Promise<LoadedPlan> {
  const { from, to } = planRange(plan);
  const taskIds = plan.tasks.map((link) => link.taskId);

  // One round trip for both measurement sources. A focus session can only be
  // attributed to a plan through a task, so the id list gates the query; habit logs
  // are gated by habit id for the same reason.
  const [focusSessions, habitLogs] = await Promise.all([
    taskIds.length
      ? prisma.focusSession.findMany({
          where: {
            userId,
            taskId: { in: taskIds },
            startedAt: { gte: from, lt: to },
          },
          select: { taskId: true, startedAt: true, actualSeconds: true, endedAt: true },
        })
      : Promise.resolve([]),
    plan.habits.length
      ? prisma.habitLog.findMany({
          where: {
            userId,
            habitId: { in: plan.habits.map((link) => link.habitId) },
            date: { gte: from, lt: to },
          },
          select: { habitId: true, date: true, completed: true, value: true },
        })
      : Promise.resolve([]),
  ]);

  const progress = planProgress({
    plan: {
      targetType: plan.targetType,
      // Already selected below; `SESSIONS` picks its measurement source from this,
      // so it has to reach the arithmetic rather than only the response.
      category: plan.category,
      targetValue: plan.targetValue,
      status: plan.status,
    },
    bounds: { start: dateOnly(plan.startDate), end: dateOnly(plan.endDate) },
    today: dateOnly(new Date()),
    tasks: plan.tasks.map((link) => ({
      id: link.task.id,
      status: link.task.status,
      completedAt: link.task.completedAt,
    })),
    habits: habitLogs,
    focusSessions: focusSessions.map((s) => ({
      taskId: s.taskId,
      startedAt: s.startedAt,
      actualSeconds: s.actualSeconds,
      ended: s.endedAt !== null,
    })),
    manualActual: plan.manualActual,
  });

  return {
    ...progress,
    id: plan.id,
    name: plan.name,
    description: plan.description,
    category: plan.category,
    targetType: plan.targetType,
    status: plan.status,
    manualActual: plan.manualActual,
    startDate: plan.startDate,
    endDate: plan.endDate,
    goalId: plan.goalId,
    projectId: plan.projectId,
    goal: plan.goal,
    project: plan.project,
    days: plan.days.map((d) => ({ dayOfWeek: d.dayOfWeek, note: d.note })),
    tasks: plan.tasks.map((link) => ({
      id: link.task.id,
      title: link.task.title,
      status: link.task.status,
      priority: link.task.priority,
      dueAt: link.task.dueAt,
      estimatedMinutes: link.task.estimatedMinutes,
      sortOrder: link.sortOrder,
      dayOfWeek: link.dayOfWeek,
    })),
    habits: plan.habits.map((link) => ({
      id: link.habit.id,
      name: link.habit.name,
      color: link.habit.color,
      unit: link.habit.unit,
    })),
    taskCount: plan.tasks.length,
    habitCount: plan.habits.length,
  };
}

/**
 * Load every plan whose window overlaps `[from, to]`.
 *
 * Overlap rather than containment: a fortnight-long plan must appear in the week
 * it spans, including the parts of that week it shares with a neighbouring week.
 * A plan is shown in every week it touches, which is the only way a plan longer
 * than seven days can be visible across its whole length.
 */
export async function loadPlansInRange(
  userId: string,
  from: Date,
  to: Date,
): Promise<LoadedPlan[]> {
  const rows = await prisma.weeklyPlan.findMany({
    where: {
      userId,
      // startDate <= to AND endDate >= from
      startDate: { lte: dateOnly(to) },
      endDate: { gte: dateOnly(from) },
    },
    orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
    include: planInclude,
  });

  return Promise.all(rows.map((row) => serialisePlan(row, userId)));
}

/**
 * Verify a goal and project belong to the user before storing them on a plan.
 *
 * Without this a crafted `goalId` would attach someone else's goal to your plan,
 * and the card would render their goal's title. Mirrors `assertLinkOwnership` in
 * `@/lib/planner/server`, which does the same job for tasks and habits on a time
 * block.
 */
export async function assertPlanParentOwnership(
  userId: string,
  goalId?: string | null,
  projectId?: string | null,
): Promise<void> {
  if (goalId) {
    const goal = await prisma.goal.findFirst({
      where: { id: goalId, userId },
      select: { id: true },
    });
    if (!goal) throw ApiError.badRequest("That goal no longer exists.");
  }
  if (projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    });
    if (!project) throw ApiError.badRequest("That project no longer exists.");
  }
}

/**
 * Split requested ids into the user's own and the ones to reject.
 *
 * Returns both halves instead of throwing on the first bad id, so a create call
 * with thirty task ids still links the twenty-nine that exist. Failing the whole
 * request because one id was stale would punish the user for data they did not
 * create and cannot repair, and silently dropping the bad one would leave them
 * with a plan that is missing work for no visible reason. The rejected ids go back
 * in the response so the UI can name them.
 */
export function partitionOwned(requested: string[], owned: string[]): {
  accepted: string[];
  rejected: string[];
} {
  const ownedSet = new Set(owned);
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const id of requested) {
    if (ownedSet.has(id)) accepted.push(id);
    else rejected.push(id);
  }
  return { accepted, rejected };
}

/** Fetch the user's tasks matching `ids`, for ownership checking. */
export async function ownedTaskIds(userId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await prisma.task.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/** Fetch the user's habits matching `ids`, for ownership checking. */
export async function ownedHabitIds(userId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await prisma.habit.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/**
 * The plan's own days as `@db.Date` values, for storing on a row.
 *
 * `dateOnly` rather than `dateOnlyLocal` on purpose. A plan's window is the week a
 * person means by "this week", and the user picked those days off a calendar in
 * their own zone — but the column is UTC midnight and the existing
 * `TimeBlock.date`/`HabitLog.date`/`WeeklyReview.weekStart` columns all use UTC
 * midnight too. Matching them is what lets a plan and its review line up on the
 * same `@@unique([userId, weekStart])` key.
 */
export function planDayOnly(isoDay: string): Date {
  return isoDayToDateOnly(isoDay);
}