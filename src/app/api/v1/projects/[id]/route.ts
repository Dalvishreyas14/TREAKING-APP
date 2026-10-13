import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { progressFromTasks } from "@/lib/projects/progress";
import { LIMITS } from "@/lib/rate-limit";
import { projectUpdateSchema } from "@/lib/validation/schemas";

/**
 * PATCH /api/v1/projects/:id    DELETE /api/v1/projects/:id
 *
 * `projectUpdateSchema` accepts `progress`, but the column does not exist and
 * the value is derived. It is accepted and ignored rather than rejected so a
 * client that computes an optimistic percentage can still send it without
 * turning every save into a 422.
 */

const params = z.object({ id: z.string().min(1) });

const projectInclude = {
  milestones: { orderBy: { sortOrder: "asc" as const } },
  tasks: {
    orderBy: { sortOrder: "asc" as const },
    include: { task: { select: { id: true, title: true, status: true, priority: true, dueAt: true } } },
  },
  _count: { select: { tasks: true, milestones: true } },
} as const;

export const PATCH = withApi({
  method: "PATCH",
  params,
  body: projectUpdateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const existing = await prisma.project.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        userId: true,
        status: true,
        startAt: true,
        dueAt: true,
        completedAt: true,
        _count: { select: { tasks: true } },
      },
    });
    assertOwnership(existing, user.id);

    const nextStatus = body.status ?? existing!.status;
    const startAt = body.startAt !== undefined ? body.startAt : existing!.startAt;
    const dueAt = body.dueAt !== undefined ? body.dueAt : existing!.dueAt;

    if (startAt && dueAt && dueAt.getTime() <= startAt.getTime()) {
      throw ApiError.validation("A project cannot be due before it starts.", {
        dueAt: "Pick a due date after the start date",
      });
    }

    // Completing a project with open tasks is allowed but recorded, so the UI can
    // show "3 tasks are still open" rather than silently leaving them behind.
    const project = await prisma.project.update({
      where: { id: existing!.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.icon !== undefined ? { icon: body.icon } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.startAt !== undefined ? { startAt: body.startAt } : {}),
        ...(body.dueAt !== undefined ? { dueAt: body.dueAt } : {}),
        completedAt: nextStatus === "COMPLETED" ? (existing!.completedAt ?? new Date()) : null,
      },
      include: projectInclude,
    });

    const openTasks = project.tasks.filter((link) => link.task.status !== "DONE").length;

    return {
      ...project,
      progress: progressFromTasks(project.tasks),
      openTasks: nextStatus === "COMPLETED" ? openTasks : 0,
    };
  },
});

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const existing = await prisma.project.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true, _count: { select: { tasks: true } } },
    });
    assertOwnership(existing, user.id);

    // Only the join rows go. The tasks themselves belong to the user and are
    // also reachable from /tasks, so deleting a project must not delete work.
    await prisma.project.delete({ where: { id: existing!.id } });

    return { id: existing!.id, deleted: true, unlinkedTasks: existing!._count.tasks };
  },
});
