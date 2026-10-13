import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { noteCreateSchema } from "@/lib/validation/schemas";

/**
 * GET /api/v1/notes
 *
 * Notes are the loose half of the knowledge base: a highlight pulled out of a
 * book, a decision written down, a paragraph that will matter in three months. So
 * a note is allowed to belong to nothing at all, and this endpoint never requires
 * a link.
 *
 * `pinned` sorts first and is not a filter here — "show me only pinned" is a
 * filter for a later list, and the knowledge screen shows pinned notes above the
 * rest rather than hiding the unpinned ones.
 */
export const GET = withApi({
  method: "GET",
  query: z.object({
    resourceId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    goalId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    loose: z.coerce.boolean().default(false),
    q: z.string().trim().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  }),
  async handler({ user, query }) {
    const term = query.q?.toLowerCase();

    const notes = await prisma.note.findMany({
      where: {
        userId: user.id,
        ...(query.resourceId ? { resourceId: query.resourceId } : {}),
        ...(query.taskId ? { taskId: query.taskId } : {}),
        ...(query.goalId ? { goalId: query.goalId } : {}),
        ...(query.projectId ? { projectId: query.projectId } : {}),
        // "Loose" is the note with no subject at all, which is the state most
        // worth surfacing rather than burying: an unfiled note is one nobody is
        // going to come back to.
        ...(query.loose
          ? { taskId: null, goalId: null, projectId: null, resourceId: null }
          : {}),
        ...(term
          ? {
              OR: [
                { title: { contains: term, mode: "insensitive" as const } },
                { body: { contains: term, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      // Pinned first, then most recently touched. `updatedAt` rather than
      // `createdAt` so a note someone has come back and added to floats up — that
      // is the one that is alive.
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      take: query.limit,
      select: {
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
        resource: { select: { id: true, title: true, kind: true } },
        task: { select: { id: true, title: true, status: true } },
        goal: { select: { id: true, title: true } },
        project: { select: { id: true, name: true } },
        category: { select: { id: true, name: true, color: true } },
      },
    });

    return {
      items: notes.map((n) => ({
        ...n,
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
      })),
    };
  },
});

/**
 * POST /api/v1/notes
 *
 * Every optional link is verified to exist and to belong to the user before it is
 * stored. Prisma's foreign keys would catch a link to a deleted row, but they
 * cannot catch a link to *somebody else's* row — the constraint is on the id, not
 * on the pair. A note linked to another account's goal would leak its title into
 * this user's knowledge screen, so the ownership check is done here rather than
 * left to a constraint that does not exist.
 */
export const POST = withApi({
  method: "POST",
  body: noteCreateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, body }) {
    await assertLinksOwned(user.id, body);

    const note = await prisma.note.create({
      data: {
        userId: user.id,
        title: body.title,
        body: body.body,
        pinned: body.pinned,
        taskId: body.taskId ?? null,
        goalId: body.goalId ?? null,
        projectId: body.projectId ?? null,
        categoryId: body.categoryId ?? null,
        resourceId: body.resourceId ?? null,
      },
      select: {
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
      },
    });

    return { ...note, createdAt: note.createdAt.toISOString(), updatedAt: note.updatedAt.toISOString() };
  },
});

/**
 * Every note link, checked in one pass.
 *
 * One `Promise.all` of four optional lookups rather than four sequential awaits:
 * these are all point reads on a primary key, and a note create that waits on
 * four round trips is the kind of latency that shows up as a slow compose box.
 * A null field short-circuits, so a loose note does none of the work at all.
 */
export async function assertLinksOwned(
  userId: string,
  links: {
    taskId?: string | null;
    goalId?: string | null;
    projectId?: string | null;
    categoryId?: string | null;
    resourceId?: string | null;
  },
) {
  const checks = await Promise.all([
    links.taskId
      ? prisma.task.findFirst({ where: { id: links.taskId, userId }, select: { id: true } })
      : null,
    links.goalId
      ? prisma.goal.findFirst({ where: { id: links.goalId, userId }, select: { id: true } })
      : null,
    links.projectId
      ? prisma.project.findFirst({ where: { id: links.projectId, userId }, select: { id: true } })
      : null,
    // A category is either the user's own or a shared default, which is why this
    // one allows a null `userId` where the others do not.
    links.categoryId
      ? prisma.category.findFirst({
          where: { id: links.categoryId, OR: [{ userId }, { userId: null }] },
          select: { id: true },
        })
      : null,
    links.resourceId
      ? prisma.resource.findFirst({ where: { id: links.resourceId, userId }, select: { id: true } })
      : null,
  ]);

  const failed: string[] = [];
  if (links.taskId && !checks[0]) failed.push("task");
  if (links.goalId && !checks[1]) failed.push("goal");
  if (links.projectId && !checks[2]) failed.push("project");
  if (links.categoryId && !checks[3]) failed.push("category");
  if (links.resourceId && !checks[4]) failed.push("resource");

  if (failed.length > 0) {
    // "No longer exists" rather than "not yours": a note linked to someone else's
    // goal is indistinguishable, as far as this user is concerned, from one linked
    // to a goal that was deleted, and saying which would be an existence oracle
    // over another account's ids.
    throw ApiError.badRequest(
      `That ${failed.join(", ")} could not be found. The note was not saved.`,
    );
  }
}
