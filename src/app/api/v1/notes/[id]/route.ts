import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { noteUpdateSchema } from "@/lib/validation/schemas";

import { assertLinksOwned } from "../route";

/**
 * PATCH /api/v1/notes/:id   DELETE /api/v1/notes/:id
 *
 * DELETE really deletes. Unlike a habit's logs, a note has no other value
 * derived from it: nothing is computed from note rows, so keeping a copy of
 * deleted writing would be storing a user's discarded words on the theory that
 * they might want them back. The one irreversible consequence worth naming is the
 * notes *attached to* a resource, and those are not touched by this — deleting a
 * resource detaches them rather than cascading.
 *
 * The link ownership check is shared with the create route by import. A note can
 * be re-filed as easily as it can be written, so the two paths need exactly the
 * same protection and there is no reason for them to drift apart.
 */

const params = z.object({ id: z.string().min(1) });

const noteSelect = {
  id: true,
  title: true,
  body: true,
  pinned: true,
  taskId: true,
  goalId: true,
  projectId: true,
  categoryId: true,
  resourceId: true,
  createdAt: true,
  updatedAt: true,
} as const;

async function loadOwned(userId: string, id: string) {
  const note = await prisma.note.findUnique({ where: { id }, select: { id: true, userId: true } });
  // `assertOwnership` gives the same 404 whether the note is missing or belongs to
  // someone else. A distinct error for each would confirm that an id exists.
  assertOwnership(note, userId, "That note no longer exists.");
  return note!;
}

export const PATCH = withApi({
  method: "PATCH",
  params,
  body: noteUpdateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const existing = await loadOwned(user.id, params.id);

    // Checked before the write, not after. Storing the link and discovering it
    // points at nothing would leave a note attached to a goal that does not
    // exist, which is exactly the state the check exists to prevent.
    await assertLinksOwned(user.id, body);

    const note = await prisma.note.update({
      where: { id: existing.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.body !== undefined ? { body: body.body } : {}),
        ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
        ...(body.taskId !== undefined ? { taskId: body.taskId } : {}),
        ...(body.goalId !== undefined ? { goalId: body.goalId } : {}),
        ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
        ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
        ...(body.resourceId !== undefined ? { resourceId: body.resourceId } : {}),
      },
      select: noteSelect,
    });

    return { ...note, createdAt: note.createdAt.toISOString(), updatedAt: note.updatedAt.toISOString() };
  },
});

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const existing = await loadOwned(user.id, params.id);
    await prisma.note.delete({ where: { id: existing.id } });
    return { id: existing.id, deleted: true };
  },
});
