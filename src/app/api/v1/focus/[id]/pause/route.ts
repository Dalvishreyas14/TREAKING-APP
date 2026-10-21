import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { elapsedFocusSeconds } from "@/lib/focus/elapsed";
import { LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/v1/focus/:id/pause
 *
 * Stop the clock without ending the session.
 *
 * The pause is recorded on the server, with the instant it began, because the
 * elapsed time that ends up on the study session and in the habit log has to
 * exclude it. A pause the client merely remembered would be lost on a reload,
 * and the minutes would silently reappear.
 *
 * The focus time already banked is returned so the client can hold the display
 * still while the timer is paused.
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
    if (existing!.pausedAt) throw ApiError.badRequest("That session is already paused.");

    const pausedAt = new Date();

    const updated = await prisma.focusSession.update({
      where: { id: existing!.id },
      data: { pausedAt },
      select: { id: true, pausedAt: true, pausedSeconds: true, actualSeconds: true },
    });

    return {
      ...updated,
      // The time already worked, held still.
      elapsedSeconds: elapsedFocusSeconds(
        {
          startedAt: existing!.startedAt,
          pausedSeconds: existing!.pausedSeconds,
          pausedAt,
        },
        pausedAt,
      ),
    };
  },
});
