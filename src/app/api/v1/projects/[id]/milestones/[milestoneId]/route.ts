import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";

/**
 * PATCH/DELETE /api/v1/projects/:id/milestones/:milestoneId
 *
 * `ProjectMilestone` has no `userId`, so ownership runs through the parent
 * project on every read and write here.
 *
 * Completing a milestone is not the same as completing its tasks, and the two are
 * deliberately not linked — a milestone can ship late, and forcing them together
 * would make the checkbox lie in one direction or the other.
 */

const params = z.object({ id: z.string().min(1), milestoneId: z.string().min(1) });

const milestoneBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  detail: z.string().trim().max(2000).nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  status: z.enum(["PENDING", "IN_PROGRESS", "DONE", "BLOCKED"]).optional(),
});

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

async function loadMilestone(milestoneId: string, projectId: string, userId: string) {
  const milestone = await prisma.projectMilestone.findUnique({
    where: { id: milestoneId },
    select: {
      id: true,
      projectId: true,
      status: true,
      project: { select: { userId: true } },
    },
  });

  if (!milestone || milestone.projectId !== projectId || milestone.project.userId !== userId) {
    throw ApiError.notFound("Milestone not found");
  }
  return milestone;
}

/**
 * The body has no `progress` field, unlike the response. `ProjectMilestone` has
 * no progress column: progress is a real number at the *project* level and is
 * derived from its tasks, so storing a copy per milestone would be a second
 * source of truth that drifts the moment a task is ticked elsewhere. `title`,
 * `detail`, `dueAt` and `status` are all the caller can set.
 */
export const PATCH = withApi({
  method: "PATCH",
  params,
  body: milestoneBody,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const existing = await loadMilestone(params.milestoneId, params.id, user.id);
    const nextStatus = body.status ?? existing.status;

    const milestone = await prisma.projectMilestone.update({
      where: { id: existing.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.detail !== undefined ? { detail: body.detail } : {}),
        ...(body.dueAt !== undefined ? { dueAt: body.dueAt } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        // Derived from status rather than trusted from the client, so a status
        // flip and its timestamp can never disagree.
        completedAt: nextStatus === "DONE" ? new Date() : null,
      },
      select: milestoneSelect,
    });

    return milestone;
  },
});

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const existing = await loadMilestone(params.milestoneId, params.id, user.id);
    // Linked tasks survive; `ProjectTask.milestoneId` is SetNull.
    await prisma.projectMilestone.delete({ where: { id: existing.id } });
    return { id: existing.id, deleted: true };
  },
});
