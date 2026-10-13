import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { taskUpdateSchema } from "@/lib/validation/schemas";

/**
 * PATCH /api/v1/tasks/:id   DELETE /api/v1/tasks/:id
 *
 * A cuid in the URL is unguessable but not secret, so every handler loads the
 * row and asserts ownership before writing. Doing it per handler rather than
 * once in `withApi` keeps the check visible at the point of the write, which is
 * where a reviewer will look for it.
 */

const params = z.object({ id: z.string().min(1) });

async function loadOwned(userId: string, id: string) {
  const task = await prisma.task.findUnique({ where: { id } });
  // 404 rather than 403 for someone else's task: confirming a record exists but
  // is not yours leaks information about other users' data.
  assertOwnership(task, userId, "That task no longer exists.");
  return task!;
}

export const PATCH = withApi({
  method: "PATCH",
  params,
  body: taskUpdateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const existing = await loadOwned(user.id, params.id);

    /**
     * `completedAt` is derived, not accepted. Setting status to DONE stamps it;
     * moving away from DONE clears it. Letting the client send both would allow
     * a task marked done with no completion date, which then reads as overdue
     * work in every "completed this week" figure.
     */
    const becomingDone = body.status === "DONE" && existing.status !== "DONE";
    const leavingDone =
      body.status !== undefined &&
      body.status !== "DONE" &&
      existing.status === "DONE";

    const task = await prisma.task.update({
      where: { id: existing.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.energy !== undefined ? { energy: body.energy } : {}),
        ...(body.importance !== undefined ? { importance: body.importance } : {}),
        ...(body.urgency !== undefined ? { urgency: body.urgency } : {}),
        ...(body.estimatedMinutes !== undefined
          ? { estimatedMinutes: body.estimatedMinutes }
          : {}),
        ...(body.startAt !== undefined ? { startAt: body.startAt } : {}),
        ...(body.dueAt !== undefined ? { dueAt: body.dueAt } : {}),
        ...(body.snoozedUntil !== undefined
          ? { snoozedUntil: body.snoozedUntil }
          : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
        ...(body.goalId !== undefined ? { goalId: body.goalId } : {}),
        ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
        ...(becomingDone ? { completedAt: new Date() } : {}),
        ...(leavingDone ? { completedAt: null } : {}),
      },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        importance: true,
        urgency: true,
        completedAt: true,
        dueAt: true,
        updatedAt: true,
      },
    });

    return task;
  },
});

/**
 * Deleting a task cascades to its subtasks, habit links and focus sessions by
 * schema. That is usually what someone means by "delete", but it is not
 * reversible, so a task with subtasks or logged time is archived instead of
 * removed — the user keeps the history and the list stops showing it.
 */
export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const existing = await loadOwned(user.id, params.id);

    const [subtasks, sessions] = await Promise.all([
      prisma.task.count({ where: { parentId: existing.id } }),
      prisma.focusSession.count({ where: { taskId: existing.id } }),
    ]);

    if (subtasks > 0 || sessions > 0) {
      const archived = await prisma.task.update({
        where: { id: existing.id },
        data: { status: "ARCHIVED" },
        select: { id: true, status: true },
      });
      return { deleted: false, archived: true, task: archived };
    }

    await prisma.task.delete({ where: { id: existing.id } });
    return { deleted: true, archived: false, task: { id: existing.id } };
  },
});
