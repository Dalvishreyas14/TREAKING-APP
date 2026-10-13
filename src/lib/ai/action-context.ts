import "server-only";

import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { addDaysUtc, dateOnly, todayUtc } from "@/lib/date";
import {
  planAction,
  type ActionContext,
  type ActionEvaluation,
  type ActionWrite,
} from "./actions";

/**
 * Reading the action executor's world, and writing it.
 *
 * Two responsibilities, and the order matters: the context is always loaded
 * scoped to `userId`, and it is always loaded *inside* the transaction that
 * applies the plan. A preview that re-reads after the confirm tap can only
 * report what it found, so the read has to be part of the same unit of work as
 * the write or the returned diff is a description of a moment that has passed.
 */

const OPEN_TASK_STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED"] as const;

/** How far back a habit log lookup reaches, in days. */
const HABIT_LOG_LOOKBACK_DAYS = 60;

/**
 * Hard ceiling on the rows one context may carry.
 *
 * The actions that work on a set cap themselves at `MAX_BULK_CHANGES`; this
 * bounds what is loaded to *decide* which rows those are. Without it,
 * `ARCHIVE_STALE` — whose payload names no rows at all — would read a user's
 * entire task history to find thirty-day-old entries.
 */
const CONTEXT_ROW_CAP = 400;

function idsFromPayload(payload: unknown, key: string): string[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const single = record[key];
  if (typeof single === "string") return [single];
  const many = record[`${key}s`];
  if (Array.isArray(many)) return many.filter((v): v is string => typeof v === "string");
  return [];
}

/**
 * Load exactly the rows an action is allowed to see.
 *
 * Two scoping rules, both load-bearing:
 *
 * 1. Every query filters on `userId`. A task id from a payload cannot reach
 *    another account's row, so a cross-account attempt is indistinguishable from
 *    a deleted row — which is the same 404-shaped answer the rest of the API
 *    gives, rather than a 403 that confirms the row exists.
 * 2. Named ids are unioned with the open-task set, because some actions name
 *    their rows and some derive them. Reading only what a payload names would
 *    make `ARCHIVE_STALE` silently inapplicable, and reading only open tasks
 *    would let a stale id slip through.
 */
export async function loadActionContext(
  tx: PrismaTransaction,
  userId: string,
  kind: string | null,
  payload: unknown,
): Promise<ActionContext> {
  const now = new Date();
  const namedTaskIds = idsFromPayload(payload, "taskId");
  const habitIds = [...new Set([...idsFromPayload(payload, "habitId")])];
  const goalIds = idsFromPayload(payload, "goalId");

  const [tasks, habits, goals, profile] = await Promise.all([
    tx.task.findMany({
      where: {
        userId,
        OR: [
          { status: { in: [...OPEN_TASK_STATUSES] } },
          ...(namedTaskIds.length > 0 ? [{ id: { in: namedTaskIds } }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      take: CONTEXT_ROW_CAP,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        importance: true,
        dueAt: true,
        startAt: true,
        snoozedUntil: true,
        estimatedMinutes: true,
        createdAt: true,
      },
    }),
    habitIds.length > 0
      ? tx.habit.findMany({
          where: { userId, id: { in: habitIds } },
          take: CONTEXT_ROW_CAP,
          select: {
            id: true,
            name: true,
            isActive: true,
            archivedAt: true,
            frequency: true,
            difficulty: true,
            targetValue: true,
            timesPerPeriod: true,
            preferredMinutes: true,
            reminderEnabled: true,
            reminderMinutes: true,
            logs: {
              where: { date: { gte: addDaysUtc(todayUtc(), -HABIT_LOG_LOOKBACK_DAYS) } },
              select: { date: true },
            },
          },
        })
      : Promise.resolve([]),
    goalIds.length > 0
      ? tx.goal.findMany({
          where: { userId, id: { in: goalIds } },
          take: CONTEXT_ROW_CAP,
          select: { id: true, title: true, status: true, progress: true, targetDate: true },
        })
      : Promise.resolve([]),
    tx.profile.findUnique({
      where: { userId },
      select: {
        sleepMinutes: true,
        wakeMinutes: true,
        availableWeekdayMinutes: true,
        availableWeekendMinutes: true,
      },
    }),
  ]);

  return {
    now,
    tasks,
    habits: habits.map(({ logs, ...habit }) => ({
      ...habit,
      // `HabitLog.date` is a `@db.Date` column, so these are UTC midnights and
      // the ISO slice is the calendar day the log belongs to.
      loggedDates: logs.map((log) => log.date.toISOString().slice(0, 10)),
    })),
    goals,
    profile,
  };
}

/** The transaction client shape both Prisma call sites below rely on. */
export type PrismaTransaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Carry out one planned write.
 *
 * `userId` is threaded through rather than closed over because the scoping
 * invariant above is only worth anything if it holds on the write path too: a
 * module-level "current user" would be both a correctness hazard under
 * concurrent requests and invisible at the call site.
 */
async function runWrite(
  tx: PrismaTransaction,
  userId: string,
  write: ActionWrite,
): Promise<void> {
  switch (write.op) {
    case "task.update":
      await tx.task.update({ where: { id: write.id }, data: write.data });
      return;
    case "habit.update":
      await tx.habit.update({ where: { id: write.id }, data: write.data });
      return;
    case "habit.log": {
      // `HabitLog` is unique on (habitId, date), so this is an upsert rather
      // than a create. The planner already refuses a date that is already
      // logged, but the user may have logged it themselves in the seconds
      // between the preview and the tap, and a unique-violation 500 is the wrong
      // answer to that.
      const date = dateOnly(new Date(write.date));
      await tx.habitLog.upsert({
        where: { habitId_date: { habitId: write.habitId, date } },
        create: { userId, habitId: write.habitId, date, value: write.value, completed: write.completed },
        update: { value: write.value, completed: write.completed },
      });
      return;
    }
    case "goal.update":
      await tx.goal.update({ where: { id: write.id }, data: write.data });
      return;
    case "profile.update":
      await tx.profile.update({ where: { userId }, data: write.data });
      return;
  }
}

/**
 * Plan, then perform, in one transaction.
 *
 * The re-plan inside the transaction is the point. Between the preview and the
 * tap the user may have completed the task, deleted the habit, or edited the
 * goal. Re-reading here means the writes match the diff that is returned, and
 * that a plan which has gone stale fails loudly as a 409 with its reason rather
 * than writing something the user never saw.
 */
export async function applyAction(
  userId: string,
  kind: string | null,
  payload: unknown,
): Promise<ActionEvaluation & { applied: number }> {
  const result = await prisma.$transaction(async (tx) => {
    const ctx = await loadActionContext(tx, userId, kind, payload);
    const evaluation = planAction(ctx, kind, payload);

    if (!evaluation.plan.applicable) {
      throw ApiError.conflict(
        evaluation.plan.reason ?? "That suggestion no longer applies to anything.",
      );
    }

    for (const write of evaluation.writes) {
      await runWrite(tx, userId, write);
    }

    return evaluation;
  });

  return { ...result, applied: result.writes.length };
}

/** Plan without writing. Used by the preview endpoint. */
export async function previewAction(
  userId: string,
  kind: string | null,
  payload: unknown,
): Promise<ActionEvaluation> {
  // A read transaction, not a bare query: the four loads run in parallel inside
  // it and it costs nothing extra, so preview and apply cannot drift in how they
  // see the world.
  const ctx = await prisma.$transaction((tx) => loadActionContext(tx, userId, kind, payload));
  return planAction(ctx, kind, payload);
}
