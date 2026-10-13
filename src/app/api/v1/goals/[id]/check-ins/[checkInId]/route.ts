import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";

/**
 * DELETE /api/v1/goals/:id/check-ins/:checkInId
 *
 * Removing a check-in rewinds the goal's progress to the newest surviving
 * reading, rather than leaving the goal showing a number the user just deleted
 * the evidence for.
 */

const params = z.object({ id: z.string().min(1), checkInId: z.string().min(1) });

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const checkIn = await prisma.goalCheckIn.findUnique({
      where: { id: params.checkInId },
      select: { id: true, goalId: true, goal: { select: { userId: true, progress: true } } },
    });

    if (!checkIn || checkIn.goal.userId !== user.id || checkIn.goalId !== params.id) {
      throw ApiError.notFound("Check-in not found");
    }

    await prisma.$transaction(async (tx) => {
      await tx.goalCheckIn.delete({ where: { id: checkIn.id } });

      const newest = await tx.goalCheckIn.findFirst({
        where: { goalId: checkIn.goalId },
        orderBy: { createdAt: "desc" },
        select: { progress: true },
      });

      await tx.goal.update({
        where: { id: checkIn.goalId },
        data: { progress: newest?.progress ?? 0 },
      });
    });

    return { id: checkIn.id, deleted: true };
  },
});
