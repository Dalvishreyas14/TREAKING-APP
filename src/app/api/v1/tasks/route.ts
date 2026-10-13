import { withApi } from "@/lib/api/with-api";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { taskCreateSchema, taskListQuerySchema } from "@/lib/validation/schemas";

/**
 * GET /api/v1/tasks
 *
 * A filtered list plus a total count, so the UI can say "showing 50 of 312"
 * without a second round trip. Every filter is applied inside the WHERE clause
 * against `userId` rather than after the fetch, so there is no code path by
 * which another account's rows are read and then discarded.
 *
 * Pagination is limit/offset rather than a keyset cursor. A task list is ordered
 * by a mutable `priorityScore`, and a cursor over a mutable sort key skips and
 * repeats rows whenever a task is re-prioritised mid-scroll. Offset paging has
 * its own flaws at depth, but they are the honest ones: a shifted window.
 */
export const GET = withApi({
  method: "GET",
  query: taskListQuerySchema,
  async handler({ user, query }) {
    const where = {
      userId: user.id,
      ...(query.status === "all" ? {} : { status: query.status }),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.goalId ? { goalId: query.goalId } : {}),
      ...(query.parentId ? { parentId: query.parentId } : {}),
      ...(query.q
        ? { title: { contains: query.q, mode: "insensitive" as const } }
        : {}),
      ...(query.from || query.to
        ? {
            dueAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.task.findMany({
        where,
        orderBy: [{ priorityScore: "desc" }, { createdAt: "desc" }],
        skip: query.offset,
        take: query.limit,
        select: {
          id: true,
          title: true,
          notes: true,
          status: true,
          priority: true,
          importance: true,
          urgency: true,
          priorityScore: true,
          priorityBand: true,
          energy: true,
          dueAt: true,
          startAt: true,
          completedAt: true,
          estimatedMinutes: true,
          sortOrder: true,
          createdAt: true,
          category: { select: { id: true, name: true, color: true } },
          goal: { select: { id: true, title: true } },
          _count: { select: { subtasks: true } },
        },
      }),
      prisma.task.count({ where }),
    ]);

    return { items, total, offset: query.offset, limit: query.limit };
  },
});

/**
 * POST /api/v1/tasks
 *
 * `priorityScore` is left at its default of 0 rather than computed here. It is
 * the priority engine's column, and letting a client write it would let a task
 * sort itself to the top of a list the user did not put it at the top of.
 */
export const POST = withApi({
  method: "POST",
  body: taskCreateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, body }) {
    const task = await prisma.task.create({
      data: {
        userId: user.id,
        title: body.title,
        notes: body.notes ?? null,
        status: body.status,
        priority: body.priority,
        energy: body.energy,
        importance: body.importance,
        urgency: body.urgency,
        estimatedMinutes: body.estimatedMinutes ?? null,
        startAt: body.startAt ?? null,
        dueAt: body.dueAt ?? null,
        categoryId: body.categoryId ?? null,
        goalId: body.goalId ?? null,
        parentId: body.parentId ?? null,
        goalMilestoneId: body.goalMilestoneId ?? null,
      },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        importance: true,
        urgency: true,
        dueAt: true,
        createdAt: true,
      },
    });

    return task;
  },
});
