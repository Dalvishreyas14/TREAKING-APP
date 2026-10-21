import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { elapsedFocusSeconds } from "@/lib/focus/elapsed";
import { LIMITS } from "@/lib/rate-limit";
import { logStudyHabit } from "@/lib/study/server";

/**
 * PATCH /api/v1/focus/:id    DELETE /api/v1/focus/:id
 *
 * Finishing a session is the interesting part. `actualSeconds` is computed here
 * from the server's own `startedAt`, never taken from the request, and the XP
 * award and the `UserStats.focusMinutes` bump happen in the same transaction as
 * the row update.
 *
 * That last part is deliberate. XP and focus minutes are denormalised counters
 * that other screens read; if they were incremented in a second statement, a
 * failure between the two would leave the ledger and the counter disagreeing,
 * and nothing in the app would ever reconcile them.
 */

const params = z.object({ id: z.string().min(1) });

const finishBody = z
  .object({
    rating: z.coerce.number().int().min(1).max(5).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    endedEarly: z.boolean().default(false),
    type: z.enum(["POMODORO", "CUSTOM", "DEEP_WORK"]).optional(),
  })
  .partial();

const sessionSelect = {
  id: true,
  taskId: true,
  startedAt: true,
  endedAt: true,
  plannedSeconds: true,
  actualSeconds: true,
  type: true,
  rating: true,
  notes: true,
  endedEarly: true,
  xpAwarded: true,
  pausedAt: true,
  pausedSeconds: true,
  studySessionId: true,
  task: { select: { id: true, title: true, status: true } },
  studySession: {
    select: { id: true, title: true, subject: true, color: true, date: true },
  },
} as const;

/** XP per focused minute, with a ceiling so one long session can't farm a level. */
function xpForSeconds(seconds: number): number {
  const minutes = Math.floor(seconds / 60);
  return Math.min(60, minutes * 2);
}

export const PATCH = withApi({
  method: "PATCH",
  params,
  body: finishBody,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const existing = await prisma.focusSession.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        userId: true,
        startedAt: true,
        endedAt: true,
        plannedSeconds: true,
        xpAwarded: true,
        pausedAt: true,
        pausedSeconds: true,
        studySessionId: true,
      },
    });
    assertOwnership(existing, user.id);

    const finishedAt = new Date();
    // Elapsed time is derived from the server's own instants, and any time the
    // session spent paused is excluded. A timer left open on a desk is not a
    // study session, and the number that ends up on the timetable and in the
    // habit log has to reflect what was actually worked.
    const actualSeconds = elapsedFocusSeconds(
      {
        startedAt: existing!.startedAt,
        pausedSeconds: existing!.pausedSeconds,
        pausedAt: existing!.pausedAt,
      },
      finishedAt,
    );
    const endedEarly = body.endedEarly ?? actualSeconds < existing!.plannedSeconds;

    const session = await prisma.$transaction(async (tx) => {
      const updated = await tx.focusSession.update({
        where: { id: existing!.id },
        data: {
          endedAt: finishedAt,
          actualSeconds,
          endedEarly,
          rating: body.rating ?? null,
          notes: body.notes ?? null,
          ...(body.type ? { type: body.type } : {}),
          // The pause is over: the session is closed, so there is no pause in
          // progress to exclude any more.
          pausedAt: null,
        },
        select: sessionSelect,
      });

      // Only award once. Re-saving a finished session (to add a rating, say) must
      // not mint XP again.
      if (existing!.xpAwarded === 0) {
        const xp = xpForSeconds(actualSeconds);
        await tx.focusSession.update({
          where: { id: existing!.id },
          data: { xpAwarded: xp },
        });
        await tx.userStats.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            xp,
            level: 1,
            focusMinutes: Math.floor(actualSeconds / 60),
            lastActivityDate: new Date(),
          },
          update: {
            xp: { increment: xp },
            focusMinutes: { increment: Math.floor(actualSeconds / 60) },
            lastActivityDate: new Date(),
          },
        });
        updated.xpAwarded = xp;
      }

      // The study session this timer was running against is now done, and it
      // records what was *actually* focused - never the scheduled length. "I
      // planned 60 minutes and did 35" has to stay two different numbers, or
      // the difference between a plan and an achievement stops existing.
      if (existing!.studySessionId) {
        const study = await tx.studySession.findFirst({
          where: { id: existing!.studySessionId, userId: user.id },
          select: {
            id: true,
            userId: true,
            title: true,
            habitId: true,
            date: true,
            durationMinutes: true,
            status: true,
          },
        });

        if (study) {
          await tx.studySession.update({
            where: { id: study.id },
            data: {
              actualMinutes: Math.round(actualSeconds / 60),
              status: "COMPLETED",
              completedAt: finishedAt,
            },
          });

          await logStudyHabit(tx, {
            id: study.id,
            userId: user.id,
            title: study.title,
            habitId: study.habitId,
            date: study.date,
            minutes: Math.round(actualSeconds / 60),
          });
        }
      }

      return updated;
    });

    return session;
  },
});

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const existing = await prisma.focusSession.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        userId: true,
        xpAwarded: true,
        actualSeconds: true,
        endedAt: true,
        studySessionId: true,
      },
    });
    assertOwnership(existing, user.id);

    await prisma.$transaction(async (tx) => {
      await tx.focusSession.delete({ where: { id: existing!.id } });

      // Discarding an unfinished timer puts its study session back on the
      // timetable. Without this the session would stay `IN_PROGRESS` for ever,
      // pointing at a timer that no longer exists, and the week would show it
      // as being studied right now.
      if (existing!.endedAt === null && existing!.studySessionId) {
        await tx.studySession.updateMany({
          where: { id: existing!.studySessionId, userId: user.id, status: "IN_PROGRESS" },
          data: { status: "PLANNED", startedAt: null },
        });
      }

      // Removing a session has to reverse the stats it contributed, or the
      // ledger grows every time someone cleans up a mistake.
      if (existing!.xpAwarded > 0 || existing!.endedAt) {
        await tx.userStats.upsert({
          where: { userId: user.id },
          create: { userId: user.id, xp: 0, level: 1, focusMinutes: 0 },
          update: {
            xp: { decrement: existing!.xpAwarded },
            focusMinutes: { decrement: Math.floor(existing!.actualSeconds / 60) },
          },
        });
      }
    });

    return { id: existing!.id, deleted: true };
  },
});
