import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/v1/study-sessions/:id/start
 *
 * Start studying a scheduled session.
 *
 * The button on a timetable entry does one thing here: it opens a focus timer
 * carrying the session's subject and its planned length, and marks the session
 * as in progress. The timer itself is the focus page's, unchanged - a study
 * session is not a second kind of timer, it is a reason for one.
 *
 * The planned length becomes the timer's target. It is a *target*, not a
 * claim: what is actually studied is written back to the session when the
 * timer closes, and that is the number that reaches the habit log.
 */

const params = z.object({ id: z.string().min(1) });

export const POST = withApi({
  method: "POST",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const existing = await prisma.studySession.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        userId: true,
        title: true,
        subject: true,
        status: true,
        durationMinutes: true,
        habitId: true,
      },
    });
    assertOwnership(existing, user.id, "That session no longer exists.");
    const session = existing!;

    if (session.status === "COMPLETED") {
      throw ApiError.badRequest("That session is already finished.");
    }
    if (session.status === "RESCHEDULED") {
      throw ApiError.badRequest("That session was moved to another day.");
    }

    // Only one timer can be genuinely running at a time, so the same rule the
    // focus page uses applies here.
    const open = await prisma.focusSession.findFirst({
      where: { userId: user.id, endedAt: null },
      orderBy: { startedAt: "desc" },
      select: { id: true, startedAt: true },
    });
    if (open) {
      throw ApiError.conflict(
        "You already have a session running. Finish or discard it first.",
      );
    }

    const focus = await prisma.$transaction(async (tx) => {
      const created = await tx.focusSession.create({
        data: {
          userId: user.id,
          startedAt: new Date(),
          plannedSeconds: session.durationMinutes * 60,
          type: "CUSTOM",
          notes: `${session.title} · ${session.subject}`,
          studySessionId: session.id,
        },
        select: {
          id: true,
          startedAt: true,
          plannedSeconds: true,
          studySessionId: true,
        },
      });

      await tx.studySession.update({
        where: { id: session.id },
        data: { status: "IN_PROGRESS", startedAt: new Date() },
      });

      return created;
    });

    return {
      focusSessionId: focus.id,
      studySessionId: session.id,
      plannedSeconds: focus.plannedSeconds,
      startedAt: focus.startedAt.toISOString(),
    };
  },
});
