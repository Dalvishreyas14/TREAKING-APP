import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { addDaysUtc } from "@/lib/date";
import { LIMITS } from "@/lib/rate-limit";
import { weeklyPlanCopySchema } from "@/lib/validation/schemas";
import { loadNewPlan } from "@/lib/weekly-plans/server";

/**
 * POST /api/v1/weekly-plans/:id/copy
 *
 * Repeats a plan into a later week.
 *
 * ## Why copying creates new tasks rather than relinking the old ones
 *
 * The naive implementation points the new plan at the same `taskId`s, and it is
 * wrong in a way that is invisible until it matters. Completion lives on the task,
 * not on the plan — `Task.status` and `completedAt` are properties of the work
 * itself. So a DONE task relinked into next week would render next week's card as
 * already finished, on the strength of a checkbox ticked this week. The user would
 * see "6 / 20 tasks complete" on a week they have not started, and would have no
 * way to tell that from a bug.
 *
 * Copying therefore creates *new* tasks from the existing plan's titles, which is
 * the same thing templates do. The old week keeps its tasks and its completion; the
 * new week gets fresh, open ones.
 *
 * Two deliberate exceptions, both reported in the response rather than hidden:
 * - Tasks already marked DONE are **not** copied. Carrying a finished item into a
 *   new week would recreate exactly the problem above. Their titles are counted in
 *   `skippedCompleted` so the UI can say "3 finished tasks were left behind"
 *   instead of the copy quietly looking lossy.
 * - Habits are relinked, not copied. A habit is a recurring arrangement, not a unit
 *   of work — "Gym" is the same thing this week and next. Its `HabitLog` history is
 *   shared, which is what makes the new week's session count real.
 */

const params = z.object({ id: z.string().min(1) });

export const POST = withApi({
  method: "POST",
  params,
  body: weeklyPlanCopySchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const source = await prisma.weeklyPlan.findUnique({
      where: { id: params.id },
include: {
        days: { orderBy: { dayOfWeek: "asc" } },
        tasks: {
          orderBy: { sortOrder: "asc" as const },
          select: {
            // `dayOfWeek` is read off the *link*, not the task: it is the plan's
            // claim about which day this work is intended for, so it is editable per
            // plan and must not be treated as a property of the task itself.
            sortOrder: true,
            dayOfWeek: true,
            task: {
              select: {
                title: true,
                status: true,
                categoryId: true,
                goalId: true,
                priority: true,
                energy: true,
                estimatedMinutes: true,
              },
            },
          },
        },
        habits: { select: { habitId: true } },
      },
    });
    assertOwnership(source, user.id, "That weekly plan no longer exists.");

    // Shifted from the plan's own start rather than from today. "Copy to next week"
    // means the week after the plan's week, and deriving it from today would send a
    // fortnight-long plan to a date unrelated to where it actually sits.
    //
    // `addDaysUtc` adds calendar days, which is the only correct operation on a
    // `@db.Date` column. Repeatedly adding 7×24h to an instant would be a different
    // operation and would drift across a DST boundary — see `src/lib/date.ts`.
    const shiftDays = body.weeksAhead * 7;
    const startDate = addDaysUtc(source!.startDate, shiftDays);
    const endDate = addDaysUtc(source!.endDate, shiftDays);

    const completedCount = source!.tasks.filter((link) => link.task.status === "DONE").length;

    const carried = body.includeTasks
      ? source!.tasks.filter((link) => link.task.status !== "DONE")
      : [];

    /*
     * Two separate counts, because "left behind" and "not asked for" are different
     * things and conflating them lies to the user.
     *
     * `skippedCompleted` is only ever the DONE tasks. `omittedTasks` is the number
     * deliberately not copied because `includeTasks` was false.
     *
     * Reporting `source.tasks.length` as *skipped completed* when the caller had
     * unchecked task copying said "3 finished tasks were left behind" about three
     * unfinished ones — the user unchecks a box to get a clean structure-only copy
     * and is told their open work was discarded. That is a backwards-reading
     * message about something that was in fact left untouched.
     */
    const skippedCompleted = body.includeTasks ? completedCount : 0;
    const omittedTasks = body.includeTasks ? 0 : source!.tasks.length;

    const newPlan = await prisma.$transaction(async (tx) => {
      const created = await tx.weeklyPlan.create({
        data: {
          userId: user.id,
          // Suffixed rather than reusing the name verbatim, because two plans called
          // "Study plan" with identical titles are indistinguishable in a list.
          name: `${source!.name} (week ${body.weeksAhead})`,
          description: source!.description,
          category: source!.category,
          targetType: source!.targetType,
          targetValue: source!.targetValue,
          // A fresh week starts unmeasured. Copying the old figure would report last
          // week's progress as this week's achievement.
          manualActual: null,
          status: "ACTIVE",
          // Already `@db.Date` UTC midnight, because `addDaysUtc` returned one and
          // the source column held one. No re-parsing needed.
          startDate,
          endDate,
          goalId: source!.goalId,
          projectId: source!.projectId,
          days: source!.days.length
            ? { create: source!.days.map((d) => ({ dayOfWeek: d.dayOfWeek, note: d.note })) }
            : undefined,
          habits: source!.habits.length
            ? { create: source!.habits.map((h) => ({ habitId: h.habitId })) }
            : undefined,
        },
        select: { id: true },
      });

      if (carried.length) {
        // Created one at a time rather than with createMany, because the generated
        // ids are needed here to build the join rows. Re-querying for them afterwards
        // by title and a recent-timestamp window would be guesswork: two tasks with
        // the same title in one plan, or two concurrent copies of the same plan,
        // would silently attach the wrong row and the card would show a task the user
        // never created.
        //
        // Category, goal, priority, energy and estimate all come across. They
        // describe the work rather than record it — a copied task is a new task, but
        // "Revise chapter 4" filed under Study and estimated at 90 minutes should
        // still be, or the copy is a worse task than the original.
        const createdTasks = [];
        for (const [index, link] of carried.entries()) {
          const task = await tx.task.create({
            data: {
              userId: user.id,
              title: link.task.title,
              status: "TODO",
              priority: link.task.priority,
              energy: link.task.energy,
              estimatedMinutes: link.task.estimatedMinutes,
              categoryId: link.task.categoryId,
              goalId: link.task.goalId,
              sortOrder: index,
            },
            select: { id: true },
          });
          createdTasks.push(task.id);
        }

        await tx.weeklyPlanTask.createMany({
          data: createdTasks.map((taskId, index) => ({
            weeklyPlanId: created.id,
            taskId,
            // The link's sortOrder carries across, so the copied week lists its tasks
            // the way the source listed them.
            sortOrder: carried[index]?.sortOrder ?? index,
            // As does the day each was pinned to. A five-day training week copied to
            // next week that lost its weekday assignments would collapse into one
            // unscheduled list, which is not a copy of anything.
            dayOfWeek: carried[index]?.dayOfWeek ?? null,
          })),
        });
      }

      return created;
    });

    return {
      plan: await loadNewPlan(user.id, newPlan.id),
      copiedTasks: carried.length,
// Reported rather than hidden. The user asked for N tasks to come across and
      // fewer did, and a silent shortfall reads as the copy having lost work.
    skippedCompleted,
      // Tasks left behind on purpose because task copying was turned off. Kept apart
      // from `skippedCompleted` so the UI can say which happened.
      omittedTasks,
      linkedHabits: source!.habits.length,
    };
  },
});