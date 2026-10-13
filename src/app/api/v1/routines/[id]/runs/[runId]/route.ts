import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { tasksForTickedSteps } from "@/lib/routines/slots";
import { LIMITS } from "@/lib/rate-limit";
import type { TaskStatus } from "@/generated/prisma/enums";

/**
 * PATCH /api/v1/routines/:id/runs/:runId
 *
 * Closing out a run. It sits under `[runId]` because a run has to be closable
 * individually — a run finished on Tuesday and a run started on Wednesday are
 * both open, and there is no way to say which one the client meant without the id
 * in the URL.
 *
 * A run snapshots `totalItems` at the start rather than counting the routine's
 * items when it finishes. If someone adds a step mid-run, the run they already
 * finished four of five items in should still read as 4/5, not 4/6.
 *
 * This is also where ticking a step finishes its task. Keeping it here rather
 * than per-tap is the same decision the run itself makes: the run is the user's
 * record, and it is written once. The tasks follow from the ticked step ids in
 * one transaction, so a run can never be recorded as finished while the work it
 * claims to have covered is still sitting open in the task list.
 */

const params = z.object({ id: z.string().min(1), runId: z.string().min(1) });

const completeBody = z.object({
  completedItems: z.coerce.number().int().min(0).max(200),
  abandoned: z.boolean().default(false),
  /**
   * Which steps were ticked, by id. Optional so a client written before task
   * materialisation still closes its run — the count is still recorded, and only
   * the task completion is skipped.
   */
  completedItemIds: z.array(z.string().min(1)).max(200).default([]),
});

const runSelect = {
  id: true,
  routineId: true,
  startedAt: true,
  completedAt: true,
  completedItems: true,
  totalItems: true,
} as const;

/** Statuses a completion must not overwrite: the user closed these on purpose. */
const TERMINAL: TaskStatus[] = ["CANCELLED", "ARCHIVED"];

export const PATCH = withApi({
  method: "PATCH",
  params,
  body: completeBody,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const run = await prisma.routineRun.findUnique({
      where: { id: params.runId },
      select: { id: true, routineId: true, completedAt: true, userId: true, totalItems: true },
    });

    if (!run || run.routineId !== params.id || run.userId !== user.id) {
      throw ApiError.notFound("Run not found");
    }

    if (run.completedAt) {
      // Re-finishing an already-closed run would extend its duration forever and
      // double-count it in the completion rate.
      throw ApiError.conflict("This run is already finished.");
    }

    // Clamped rather than rejected: a client that ticks every box on a routine
    // whose steps grew since the run started would otherwise be stuck unable to
    // close it at all.
    const completedItems = Math.min(body.completedItems, run.totalItems);

    const closed = await prisma.$transaction(async (tx) => {
      const steps = await tx.routineItem.findMany({
        where: { routineId: run.routineId },
        select: { id: true, taskId: true },
      });

      const taskIds = tasksForTickedSteps(steps, body.completedItemIds);

      // Re-read the candidates with `userId` in the WHERE clause rather than
      // trusting the step's stored `taskId` on its own. A step id and a task id are
      // both client-influenced, and this is the one place a wrong task id would
      // close somebody's task.
      const completable = taskIds.length
        ? await tx.task.findMany({
            where: { id: { in: taskIds }, userId: user.id, status: { notIn: TERMINAL } },
            select: { id: true },
          })
        : [];

      if (completable.length > 0) {
        await tx.task.updateMany({
          where: { id: { in: completable.map((t) => t.id) } },
          data: { status: "DONE", completedAt: new Date() },
        });
      }

      const updated = await tx.routineRun.update({
        where: { id: run.id },
        data: {
          completedItems,
          // An abandoned run still gets a timestamp; it just never counts as
          // complete, which is the distinction the summary depends on.
          completedAt: new Date(),
        },
        select: runSelect,
      });

      return { updated, completedTasks: completable.length };
    });

    return { ...closed.updated, abandoned: body.abandoned, completedTasks: closed.completedTasks };
  },
});
