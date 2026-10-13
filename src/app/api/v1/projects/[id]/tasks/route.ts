import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { progressFromTasks } from "@/lib/projects/progress";
import { LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/v1/projects/:id/tasks
 *
 * Linking a task. Unlinking is `DELETE /api/v1/projects/:id/tasks/:linkId` and
 * lives under its own segment, because the id being removed is the link's, not
 * the task's, and it has to come from the URL.
 *
 * Linking a task checks that the task belongs to the *same* user. Without that
 * check, a project id and a task id from two different accounts could be joined,
 * and the project would then report a progress percentage derived from someone
 * else's work.
 *
 * Unlinking deletes the `ProjectTask` row only. The task itself survives.
 */

const params = z.object({ id: z.string().min(1) });

const linkBody = z.object({
  taskId: z.string().min(1, "Pick a task"),
  milestoneId: z.string().min(1).nullable().optional(),
});

const linkSelect = {
  id: true,
  projectId: true,
  taskId: true,
  milestoneId: true,
  sortOrder: true,
  task: { select: { id: true, title: true, status: true, priority: true, dueAt: true } },
} as const;

export const POST = withApi({
  method: "POST",
  params,
  body: linkBody,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const project = await prisma.project.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true },
    });
    assertOwnership(project, user.id);

    const task = await prisma.task.findFirst({
      where: { id: body.taskId, userId: user.id },
      select: { id: true },
    });
    if (!task) {
      throw ApiError.notFound("Task not found");
    }

    if (body.milestoneId) {
      const milestone = await prisma.projectMilestone.findUnique({
        where: { id: body.milestoneId },
        select: { id: true, projectId: true },
      });
      if (!milestone || milestone.projectId !== project!.id) {
        throw ApiError.validation("That milestone belongs to a different project.", {
          milestoneId: "Pick a milestone from this project",
        });
      }
    }

    // `@@unique([projectId, taskId])` makes a duplicate link a constraint
    // violation. Reporting it as a conflict is far more useful than surfacing a
    // raw Prisma error code to the user.
    const existing = await prisma.projectTask.findUnique({
      where: { projectId_taskId: { projectId: project!.id, taskId: task.id } },
      select: { id: true },
    });
    if (existing) {
      throw ApiError.conflict("That task is already in this project.");
    }

    const last = await prisma.projectTask.findFirst({
      where: { projectId: project!.id },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const link = await prisma.projectTask.create({
      data: {
        userId: user.id,
        projectId: project!.id,
        taskId: task.id,
        milestoneId: body.milestoneId ?? null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
      select: linkSelect,
    });

    const tasks = await prisma.projectTask.findMany({
      where: { projectId: project!.id },
      orderBy: { sortOrder: "asc" },
      include: { task: { select: { status: true } } },
    });

    return { link, progress: progressFromTasks(tasks) };
  },
});
