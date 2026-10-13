import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { projectCreateSchema } from "@/lib/validation/schemas";
import { progressFromTasks } from "@/lib/projects/progress";

/**
 * GET /api/v1/projects?status    POST /api/v1/projects
 *
 * Progress comes from `progressFromTasks` in `@/lib/projects/progress`, not from
 * a stored column — see that file for why.
 */

const listQuery = z.object({
  status: z
    .enum(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED", "ALL"])
    .default("ALL"),
});

const projectInclude = {
  milestones: { orderBy: { sortOrder: "asc" as const } },
  tasks: {
    orderBy: { sortOrder: "asc" as const },
    include: { task: { select: { id: true, title: true, status: true, priority: true, dueAt: true } } },
  },
  _count: { select: { tasks: true, milestones: true } },
} as const;

export const GET = withApi({
  method: "GET",
  query: listQuery,
  async handler({ user, query }) {
    const projects = await prisma.project.findMany({
      where: {
        userId: user.id,
        ...(query.status === "ALL" ? {} : { status: query.status }),
      },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }, { sortOrder: "asc" }],
      include: projectInclude,
    });

    return {
      items: projects.map((project) => ({ ...project, progress: progressFromTasks(project.tasks) })),
    };
  },
});

export const POST = withApi({
  method: "POST",
  body: projectCreateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, body }) {
    if (body.startAt && body.dueAt && body.dueAt.getTime() <= body.startAt.getTime()) {
      throw ApiError.validation("A project cannot be due before it starts.", {
        dueAt: "Pick a due date after the start date",
      });
    }

    const project = await prisma.project.create({
      data: {
        userId: user.id,
        name: body.name,
        description: body.description ?? null,
        status: body.status,
        startAt: body.startAt ?? null,
        dueAt: body.dueAt ?? null,
        color: body.color,
        icon: body.icon,
        completedAt: body.status === "COMPLETED" ? new Date() : null,
      },
      include: projectInclude,
    });

    return { ...project, progress: progressFromTasks(project.tasks) };
  },
});
