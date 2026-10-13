import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { goalCreateSchema } from "@/lib/validation/schemas";

/**
 * GET /api/v1/goals?status    POST /api/v1/goals
 *
 * Progress is stored on the row rather than computed from milestones, because it
 * is edited directly on the goal itself ("I'm 60% through this"). The write path
 * keeps `progress` and `status` from drifting apart: marking a goal ACHIEVED
 * forces progress to 100, and reopening one clears `achievedAt`. Without that
 * pairing the dashboard ends up showing a 40%-complete "achieved" goal, because
 * the two fields are editable independently in the database.
 */

const listQuery = z.object({
  status: z
    .enum(["ACTIVE", "PAUSED", "ACHIEVED", "ABANDONED", "ALL"])
    .default("ACTIVE"),
});

const goalInclude = {
  milestones: { orderBy: { sortOrder: "asc" as const } },
  checkIns: { orderBy: { createdAt: "desc" as const }, take: 5 },
  category: { select: { id: true, name: true, color: true, kind: true } },
  _count: { select: { tasks: true } },
} as const;

export const GET = withApi({
  method: "GET",
  query: listQuery,
  async handler({ user, query }) {
    const goals = await prisma.goal.findMany({
      where: {
        userId: user.id,
        ...(query.status === "ALL" ? {} : { status: query.status }),
      },
      orderBy: [{ targetDate: "asc" }, { createdAt: "desc" }],
      include: goalInclude,
    });

    return { items: goals };
  },
});

export const POST = withApi({
  method: "POST",
  body: goalCreateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, body }) {
    if (body.categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: body.categoryId, OR: [{ userId: user.id }, { isSystem: true }] },
        select: { id: true },
      });
      if (!category) {
        throw ApiError.validation("That category does not exist.", {
          categoryId: "Pick a category you have access to",
        });
      }
    }

    const goal = await prisma.goal.create({
      data: {
        userId: user.id,
        title: body.title,
        description: body.description ?? null,
        horizon: body.horizon,
        status: body.status,
        startDate: body.startDate ?? null,
        targetDate: body.targetDate ?? null,
        categoryId: body.categoryId ?? null,
        icon: body.icon,
        color: body.color,
        progress: body.status === "ACHIEVED" ? 100 : 0,
        achievedAt: body.status === "ACHIEVED" ? new Date() : null,
      },
      include: goalInclude,
    });

    return goal;
  },
});
