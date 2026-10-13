import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { projectMilestoneCreateSchema } from "@/lib/validation/schemas";

/**
 * POST /api/v1/projects/:id/milestones
 *
 * Creating a milestone. Editing and deleting one live at
 * `/milestones/:milestoneId` — a milestone has to be individually addressable,
 * and a collection route cannot see an id that isn't in its URL.
 *
 * `ProjectMilestone` has no `userId`, so the parent project is what proves
 * ownership.
 */

const params = z.object({ id: z.string().min(1) });

const milestoneSelect = {
  id: true,
  projectId: true,
  title: true,
  detail: true,
  dueAt: true,
  status: true,
  sortOrder: true,
  completedAt: true,
  tasks: { select: { id: true, task: { select: { title: true, status: true } } } },
} as const;

export const POST = withApi({
  method: "POST",
  params,
  body: projectMilestoneCreateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const project = await prisma.project.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true },
    });
    assertOwnership(project, user.id);

    const last = await prisma.projectMilestone.findFirst({
      where: { projectId: project!.id },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const milestone = await prisma.projectMilestone.create({
      data: {
        projectId: project!.id,
        title: body.title,
        detail: body.detail ?? null,
        dueAt: body.dueAt ?? null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
      select: milestoneSelect,
    });

    return milestone;
  },
});
