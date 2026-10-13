import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { dateOnlyLocal } from "@/lib/date";
import { planRoutineSlots, summariseSlots } from "@/lib/routines/slots";
import { LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/v1/routines/:id/runs
 *
 * Starting a run. The matching `PATCH` that closes one lives at `/runs/:runId`.
 *
 * A run snapshots `totalItems` at the start rather than counting the routine's
 * items when it finishes. If someone adds a step mid-run, the run they already
 * finished four of five items in should still read as 4/5, not 4/6.
 *
 * Starting one is also where the routine's steps become tasks, because that is the
 * moment they become real work: before it, a step is a line in a template. The
 * binding is a stable slot per step rather than a new task per run — see
 * `src/lib/routines/slots.ts` for why the reuse is the point and not an
 * optimisation.
 *
 * Each task is stamped with the routine's own `timeOfDay`, offset by the
 * estimates of the steps before it, so starting a morning routine puts the
 * routine on the planner's timeline at the hour it is meant to happen rather than
 * dumping five undated tasks into the list.
 */

const params = z.object({ id: z.string().min(1) });

const runSelect = {
  id: true,
  routineId: true,
  startedAt: true,
  completedAt: true,
  completedItems: true,
  totalItems: true,
} as const;

/** Fallback start-of-day for a routine with no `timeOfDay` set. */
const DEFAULT_TIME_OF_DAY = 7 * 60;

/** Latest a step can be pushed, so a long routine cannot spill into tomorrow. */
const LAST_STEP_MINUTE = 23 * 60 + 59;

export const POST = withApi({
  method: "POST",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const routine = await prisma.routine.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        userId: true,
        isActive: true,
        name: true,
        timeOfDay: true,
        _count: { select: { items: true } },
      },
    });
    assertOwnership(routine, user.id);

    if (!routine!.isActive) {
      throw ApiError.conflict("This routine is paused. Resume it before starting a run.");
    }

    // The client disables the button, but the button is not the guarantee. Two open
    // runs of one routine would share the same task slots, so completing the first
    // would tick steps belonging to the second and both runs' completion counts
    // would be wrong.
    const open = await prisma.routineRun.findFirst({
      where: { routineId: routine!.id, userId: user.id, completedAt: null },
      select: { id: true },
    });
    if (open) {
      throw ApiError.conflict(
        "You already have a run of this routine open. Finish or abandon it first.",
      );
    }

    const items = await prisma.routineItem.findMany({
      where: { routineId: routine!.id },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        title: true,
        estimatedMinutes: true,
        categoryId: true,
        createsTask: true,
        task: { select: { id: true, status: true } },
      },
    });

    const actions = planRoutineSlots(items);
    const summary = summariseSlots(actions);

    const result = await prisma.$transaction(async (tx) => {
      const startOfDay = routine!.timeOfDay ?? DEFAULT_TIME_OF_DAY;
      let elapsed = 0;
      // Which step each scheduled time belongs to, so the offset advances with the
      // steps in order rather than being recomputed from an estimate that may be
      // missing.
      const stepStart = new Map<string, number>();
      for (const item of items) {
        stepStart.set(item.id, startOfDay + elapsed);
        elapsed += item.estimatedMinutes ?? 0;
      }

      for (const action of actions) {
        if (action.op === "create" || action.op === "retire") {
          const step = items.find((i) => i.id === action.stepId)!;
          const minute = Math.min(stepStart.get(step.id) ?? startOfDay, LAST_STEP_MINUTE);
          // `dateOnlyLocal` because a step belongs to the day the user ran it, and
          // `new Date(y, m, d, h, m)` because a routine time is a wall-clock time
          // rather than an instant. See `src/lib/date.ts` for why both are needed.
          const day = dateOnlyLocal(new Date());
          const dueAt = new Date(
            day.getUTCFullYear(),
            day.getUTCMonth(),
            day.getUTCDate(),
            Math.floor(minute / 60),
            minute % 60,
          );

          const task = await tx.task.create({
            data: {
              userId: user.id,
              title: step.title,
              // Provenance in the task itself, so a list of five identical-looking
              // tasks still says where they came from and can be traced back.
              notes: `From your ${routine!.name} routine.`,
              status: "TODO",
              estimatedMinutes: step.estimatedMinutes,
              dueAt,
              categoryId: step.categoryId,
            },
            select: { id: true },
          });

          await tx.routineItem.update({
            where: { id: step.id },
            data: { taskId: task.id },
          });
        } else if (action.op === "reopen") {
          await tx.task.update({
            where: { id: action.taskId },
            data: { status: "TODO", completedAt: null },
          });
        }
      }

      const run = await tx.routineRun.create({
        data: {
          userId: user.id,
          routineId: routine!.id,
          totalItems: items.length,
        },
        select: runSelect,
      });

      return run;
    });

    return { ...result, tasks: summary };
  },
});
