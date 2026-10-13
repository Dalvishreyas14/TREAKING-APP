import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";

/**
 * DELETE /api/v1/projects/:id/tasks/:linkId
 *
 * Unlinking deletes the `ProjectTask` row only — the task itself survives. The
 * id in the path is the *link* id, not the task id, because one task can be
 * attached to several projects and only the join row is being removed.
 *
 * This lives under its own `[linkId]` segment for the same reason the rest of the
 * API does: Next.js supplies only the params the URL contains, so the collection
 * route at `/tasks` has no way to read a link id.
 */

const params = z.object({ id: z.string().min(1), linkId: z.string().min(1) });

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const link = await prisma.projectTask.findUnique({
      where: { id: params.linkId },
      select: { id: true, projectId: true, userId: true },
    });

    if (!link || link.projectId !== params.id || link.userId !== user.id) {
      throw ApiError.notFound("That task is not linked to this project.");
    }

    await prisma.projectTask.delete({ where: { id: link.id } });

    return { id: link.id, deleted: true, taskKept: true };
  },
});
