import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { elapsedFocusSeconds } from "@/lib/focus/elapsed";
import { LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/v1/focus/:id/resume
 *
 * Start the clock again after a pause.
 *
 * The paused time is folded into `pausedSeconds` here rather than being
 * recomputed at the end, so the exclusion survives however many times the
 * timer is paused and resumed. The arithmetic is the same one the finish path
 * uses: gross elapsed minus everything spent paused.
 */

const params = z.object({ id: z.string().min(1) });

export const POST = withApi({
  method: "POST",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const existing = await prisma.focusSession.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        userId: true,
        startedAt: true,
        endedAt: true,
        pausedAt: true,
        pausedSeconds: true,
      },
    });
    assertOwnership(existing, user.id, "That session no longer exists.");

    if (existing!.endedAt) throw ApiError.badRequest("That session is already finished.");
    if (!existing!.pausedAt) throw ApiError.badRequest("That session is not paused.");

    const resumedAt = new Date();
    const pausedFor = Math.max(
      0,
      Math.round((resumedAt.getTime() - existing!.pausedAt.getTime()) / 1000),
    );
    const pausedSeconds = existing!.pausedSeconds + pausedFor;

    const updated = await prisma.focusSession.update({
      where: { id: existing!.id },
      data: { pausedAt: null, pausedSeconds },
      select: { id: true, pausedAt: true, pausedSeconds: true, actualSeconds: true },
    });

    return {
      ...updated,
      elapsedSeconds: elapsedFocusSeconds(
        { startedAt: existing!.startedAt, pausedSeconds, pausedAt: null },
        resumedAt,
      ),
    };
  },
});
