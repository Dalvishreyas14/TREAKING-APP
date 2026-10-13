import { withApi } from "@/lib/api/with-api";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { routineCreateSchema } from "@/lib/validation/schemas";

/**
 * GET /api/v1/routines    POST /api/v1/routines
 *
 * `RoutineRun` completion is summarised per routine in the list response rather
 * than left for the client to count. "You finished this 4 of the last 7 days" is
 * the single most useful thing the routines screen shows, and deriving it in SQL
 * keeps the list request from ballooning into one query per routine.
 */

const routineInclude = {
  items: { orderBy: { sortOrder: "asc" as const } },
  runs: { orderBy: { startedAt: "desc" as const }, take: 14 },
  _count: { select: { runs: true, timeBlocks: true } },
} as const;

/** Completion rate over the recent window, ignoring runs still in progress. */
function summarise(
  runs: { startedAt: Date; completedAt: Date | null; totalItems: number; completedItems: number }[],
) {
  const finished = runs.filter((run) => run.completedAt !== null);
  const completed = finished.filter((run) => run.totalItems > 0 && run.completedItems >= run.totalItems);
  const partial = finished.length - completed.length;
  return {
    recentRuns: runs.length,
    finished: finished.length,
    completed,
    partial,
    lastRunAt: runs[0]?.startedAt ?? null,
  };
}

export const GET = withApi({
  method: "GET",
  async handler({ user }) {
    const routines = await prisma.routine.findMany({
      where: { userId: user.id },
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
      include: routineInclude,
    });

    return { items: routines.map((routine) => ({ ...routine, summary: summarise(routine.runs) })) };
  },
});

export const POST = withApi({
  method: "POST",
  body: routineCreateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, body }) {
    // Items are created with the routine so a half-built routine is never
    // visible. `sortOrder` is assigned by array position rather than accepted
    // from the client, which keeps reordering in one place.
    const routine = await prisma.routine.create({
      data: {
        userId: user.id,
        name: body.name,
        description: body.description ?? null,
        kind: body.kind,
        timeOfDay: body.timeOfDay ?? null,
        color: body.color,
        icon: body.icon,
        isActive: body.isActive,
        items: {
          create: body.items.map((item, index) => ({
            title: item.title,
            estimatedMinutes: item.estimatedMinutes ?? null,
            categoryId: item.categoryId ?? null,
            habitId: item.habitId ?? null,
            sortOrder: index,
          })),
        },
      },
      include: routineInclude,
    });

    return routine;
  },
});
