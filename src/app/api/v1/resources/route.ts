import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { prisma } from "@/lib/db";
import { resourceTransition } from "@/lib/knowledge/resources";
import { LIMITS } from "@/lib/rate-limit";
import { resourceCreateSchema } from "@/lib/validation/schemas";

/**
 * GET /api/v1/resources
 *
 * Returns resources grouped by shelf rather than as one flat list, because the
 * shelf *is* the question people ask of a reading list: what am I working on, what
 * am I saving up, and what did I actually get through. Flattening it into one
 * array would leave the client sorting by a status enum with no guidance about
 * what the order should be.
 *
 * `q` searches the title, the author and the summary. Not the note bodies: a
 * resource is a thing, and a note attached to it is already listed under it, so
 * searching notes here would return the resource for reasons the card does not
 * show.
 */
export const GET = withApi({
  method: "GET",
  query: z.object({
    status: z
      .enum(["WANTING", "IN_PROGRESS", "ON_HOLD", "FINISHED", "DROPPED", "ALL"])
      .default("ALL"),
    kind: z
      .enum(["BOOK", "COURSE", "ARTICLE", "VIDEO", "PODCAST", "PAPER", "TOOL", "OTHER", "ALL"])
      .default("ALL"),
    q: z.string().trim().max(200).optional(),
  }),
  async handler({ user, query }) {
    const term = query.q?.toLowerCase();

    const resources = await prisma.resource.findMany({
      where: {
        userId: user.id,
        ...(query.status === "ALL" ? {} : { status: query.status }),
        ...(query.kind === "ALL" ? {} : { kind: query.kind }),
        ...(term
          ? {
              OR: [
                { title: { contains: term, mode: "insensitive" as const } },
                { author: { contains: term, mode: "insensitive" as const } },
                { summary: { contains: term, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        title: true,
        kind: true,
        status: true,
        url: true,
        author: true,
        summary: true,
        progress: true,
        rating: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
        updatedAt: true,
        category: { select: { id: true, name: true, color: true } },
        // A count, not the notes themselves. The knowledge screen shows highlights
        // under the resource they belong to; shipping every note body with the
        // list to render a number would make this endpoint's cost scale with the
        // user's writing rather than with the size of the list.
        _count: { select: { notes: true } },
      },
    });

    return {
      items: resources.map((r) => ({
        ...r,
        startedAt: r.startedAt?.toISOString() ?? null,
        finishedAt: r.finishedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        noteCount: r._count.notes,
        _count: undefined,
      })),
    };
  },
});

/**
 * POST /api/v1/resources
 *
 * A new resource always goes through `resourceTransition`, including the simplest
 * create. That is not ceremony: `create` has to choose `startedAt` and
 * `finishedAt` itself, and routing the one-shot case through the same function
 * that governs every later change is what stops a resource created directly as
 * `FINISHED` from being the one row on the shelf that the rules do not describe.
 */
export const POST = withApi({
  method: "POST",
  body: resourceCreateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, body }) {
    const now = new Date();
    const settled = resourceTransition(
      { status: "WANTING", progress: 0, startedAt: null, finishedAt: null },
      { status: body.status, progress: body.progress },
      now,
    );

    const resource = await prisma.resource.create({
      data: {
        userId: user.id,
        title: body.title,
        kind: body.kind,
        // A created-as-FINISHED resource with an explicit progress is allowed to
        // keep it, for logging something finished before it was tracked.
        status: settled.status,
        progress: settled.progress,
        rating: body.rating ?? null,
        url: body.url || null,
        author: body.author ?? null,
        summary: body.summary ?? null,
        startedAt: settled.startedAt,
        finishedAt: settled.finishedAt,
        goalId: body.goalId ?? null,
        projectId: body.projectId ?? null,
        categoryId: body.categoryId ?? null,
      },
      select: {
        id: true,
        title: true,
        kind: true,
        status: true,
        progress: true,
        rating: true,
        url: true,
        startedAt: true,
        finishedAt: true,
        updatedAt: true,
      },
    });

    return { ...resource, startedAt: resource.startedAt?.toISOString() ?? null, finishedAt: resource.finishedAt?.toISOString() ?? null, updatedAt: resource.updatedAt.toISOString() };
  },
});
