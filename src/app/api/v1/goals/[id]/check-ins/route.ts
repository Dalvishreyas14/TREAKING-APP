import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";

/**
 * GET /api/v1/goals/:id/check-ins    POST /api/v1/goals/:id/check-ins
 *
 * A check-in is an append-only note plus a progress reading. The newest reading
 * is what the goal shows, so POST returns the goal rather than the check-in —
 * the client never has to guess what the resulting progress became.
 *
 * Deleting a check-in lives at `/check-ins/:checkInId` rather than being bolted
 * on here with a query parameter, so the id is part of the path and can be
 * ownership-checked on its own.
 */

const params = z.object({ id: z.string().min(1) });

const createBody = z.object({
  note: z.string().trim().max(2000).nullable().optional(),
  progress: z.coerce.number().min(0).max(100),
});

const goalSelect = {
  id: true,
  progress: true,
  status: true,
  achievedAt: true,
  checkIns: { orderBy: { createdAt: "desc" as const }, take: 20 },
} as const;

export const GET = withApi({
  method: "GET",
  params,
  async handler({ user, params }) {
    const goal = await prisma.goal.findUnique({
      where: { id: params.id },
      select: { ...goalSelect, userId: true },
    });
    assertOwnership(goal, user.id);

    return goal;
  },
});

export const POST = withApi({
  method: "POST",
  params,
  body: createBody,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const existing = await prisma.goal.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true, status: true },
    });
    assertOwnership(existing, user.id);

    if (existing!.status === "ACHIEVED" || existing!.status === "ABANDONED") {
      throw ApiError.conflict(
        "Reopen this goal before checking in on it again.",
      );
    }

    const checkIn = await prisma.goalCheckIn.create({
      data: {
        goalId: existing!.id,
        note: body.note ?? null,
        progress: body.progress,
      },
    });

    const goal = await prisma.goal.update({
      where: { id: existing!.id },
      // 100 on a live goal means the same thing as ACHIEVED; leave the final
      // step to the user so the achievement timestamp is theirs to trigger.
      data: { progress: Math.min(body.progress, 99) },
      select: goalSelect,
    });

    return { checkIn, goal };
  },
});
