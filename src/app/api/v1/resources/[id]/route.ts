import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { resourceTransition } from "@/lib/knowledge/resources";
import { LIMITS } from "@/lib/rate-limit";
import { resourceUpdateSchema } from "@/lib/validation/schemas";

/**
 * PATCH /api/v1/resources/:id   DELETE /api/v1/resources/:id
 *
 * Every write to `status`, `progress`, `startedAt` and `finishedAt` goes through
 * `resourceTransition` together, so the four columns cannot be left contradicting
 * each other by a partial update. Spreading the transition's result into the
 * update is what makes that guarantee hold for a PATCH that changes only one of
 * them.
 *
 * DELETE removes the resource but leaves its notes. A note is allowed to be
 * loose, and `Note.resourceId` is `onDelete: SetNull` precisely so that deleting
 * the thing a note was written about does not destroy the writing. Losing a
 * highlight because the book record went away would be the worst possible
 * outcome of a housekeeping action.
 */

const params = z.object({ id: z.string().min(1) });

const resourceSelect = {
  id: true,
  title: true,
  kind: true,
  status: true,
  progress: true,
  rating: true,
  url: true,
  author: true,
  summary: true,
  startedAt: true,
  finishedAt: true,
  updatedAt: true,
} as const;

function serialise<T extends { startedAt: Date | null; finishedAt: Date | null; updatedAt: Date }>(
  resource: T,
) {
  return {
    ...resource,
    startedAt: resource.startedAt?.toISOString() ?? null,
    finishedAt: resource.finishedAt?.toISOString() ?? null,
    updatedAt: resource.updatedAt.toISOString(),
  };
}

async function loadOwned(userId: string, id: string) {
  const resource = await prisma.resource.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true, progress: true, startedAt: true, finishedAt: true },
  });
  assertOwnership(resource, userId, "That resource no longer exists.");
  return resource!;
}

export const PATCH = withApi({
  method: "PATCH",
  params,
  body: resourceUpdateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const existing = await loadOwned(user.id, params.id);

    // A rating on something that was never finished is a claim about a
    // conclusion the resource has not reached. Allowed to be set on a DROPPED
    // resource — people rate what they abandoned, and that is useful signal — but
    // not on one still sitting on the shelf.
    if (body.rating !== undefined && body.rating !== null) {
      const status = body.status ?? existing.status;
      if (status === "WANTING" || status === "IN_PROGRESS" || status === "ON_HOLD") {
        throw ApiError.badRequest(
          "Move it to finished or dropped before rating it.",
        );
      }
    }

    const settled = resourceTransition(existing, {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.progress !== undefined ? { progress: body.progress } : {}),
    });

    const resource = await prisma.resource.update({
      where: { id: existing.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.url !== undefined ? { url: body.url || null } : {}),
        ...(body.author !== undefined ? { author: body.author } : {}),
        ...(body.summary !== undefined ? { summary: body.summary } : {}),
        ...(body.rating !== undefined ? { rating: body.rating } : {}),
        ...(body.goalId !== undefined ? { goalId: body.goalId } : {}),
        ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
        ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
        // Always written, together, from the transition.
        status: settled.status,
        progress: settled.progress,
        startedAt: settled.startedAt,
        finishedAt: settled.finishedAt,
      },
      select: resourceSelect,
    });

    return serialise(resource);
  },
});

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const existing = await loadOwned(user.id, params.id);

    // Counted so the confirmation can say what is about to happen to the notes
    // rather than the user finding out afterwards.
    const detached = await prisma.note.count({ where: { resourceId: existing.id } });

    await prisma.resource.delete({ where: { id: existing.id } });

    return { id: existing.id, deleted: true, detachedNotes: detached };
  },
});
