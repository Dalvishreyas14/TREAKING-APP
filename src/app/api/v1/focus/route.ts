import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";

/**
 * GET /api/v1/focus?from&to    POST /api/v1/focus
 *
 * A focus session is written on *start*, not on completion.
 *
 * The obvious design — hold the timer in the browser and POST the result when
 * the bell rings — loses the session whenever the tab is closed, the laptop
 * sleeps, or the phone rotates. It also makes `actualSeconds` a number the
 * client asserts about its own wall clock, which is exactly the kind of value
 * that should be measured on the server.
 *
 * Creating the row up front means an interrupted session survives as an
 * unfinished one the user can discard, and the elapsed time is derived from two
 * server-stamped instants.
 */

const listQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});

const startBody = z.object({
  plannedSeconds: z.coerce.number().int().min(60).max(4 * 60 * 60),
  type: z.enum(["POMODORO", "CUSTOM", "DEEP_WORK"]).default("POMODORO"),
  taskId: z.string().min(1).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  /**
   * The scheduled study session this timer is running against.
   *
   * Optional on purpose: a timer started from the Focus page has no study
   * session and behaves exactly as it always did. When it is present the
   * session is marked in progress, and finishing the timer writes the *actual*
   * minutes back to it.
   */
  studySessionId: z.string().min(1).nullable().optional(),
});

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

export const GET = withApi({
  method: "GET",
  query: listQuery,
  async handler({ user, query }) {
    const where = {
      userId: user.id,
      ...(query.from
        ? { startedAt: { gte: new Date(`${query.from}T00:00:00.000Z`) } }
        : {}),
      ...(query.to
        ? { startedAt: { lte: new Date(`${query.to}T23:59:59.999Z`) } }
        : {}),
    };

    const [items, totals] = await Promise.all([
      prisma.focusSession.findMany({
        where,
        orderBy: { startedAt: "desc" },
        take: query.limit,
        select: sessionSelect,
      }),
      prisma.focusSession.aggregate({
        where: { ...where, endedAt: { not: null } },
        _sum: { actualSeconds: true, xpAwarded: true },
        _count: { _all: true },
      }),
    ]);

    return {
      items: items.map((session) => ({
        ...session,
        // True when the row was never closed out. Drives the "unfinished" state
        // in the UI, which is what makes an abandoned session visible instead of
        // silently distorting the day total.
        unfinished: session.endedAt === null,
      })),
      totals: {
        sessions: totals._count._all,
        seconds: totals._sum.actualSeconds ?? 0,
        xp: totals._sum.xpAwarded ?? 0,
      },
    };
  },
});

export const POST = withApi({
  method: "POST",
  body: startBody,
  rateLimit: LIMITS.write,
  async handler({ user, body }) {
    if (body.taskId) {
      const task = await prisma.task.findFirst({
        where: { id: body.taskId, userId: user.id },
        select: { id: true },
      });
      if (!task) {
        throw ApiError.notFound("Task not found");
      }
    }

    // Only one session can be genuinely running at a time. A second "start"
    // would otherwise leave the user with two open rows and no way to tell
    // which one the elapsed time belongs to.
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

    // A study session can only be started if it is one the user owns and has
    // not already finished. The check is here rather than in the client so a
    // crafted id cannot start a timer against somebody else's timetable.
    let studySession: { id: string } | null = null;
    if (body.studySessionId) {
      const found = await prisma.studySession.findFirst({
        where: { id: body.studySessionId, userId: user.id },
        select: { id: true, status: true, durationMinutes: true },
      });
      if (!found) throw ApiError.notFound("That study session no longer exists.");
      if (found.status === "COMPLETED") {
        throw ApiError.badRequest("That session is already finished.");
      }
      studySession = found;
    }

    const session = await prisma.$transaction(async (tx) => {
      const created = await tx.focusSession.create({
        data: {
          userId: user.id,
          taskId: body.taskId ?? null,
          startedAt: new Date(),
          plannedSeconds: body.plannedSeconds,
          type: body.type,
          notes: body.notes ?? null,
          studySessionId: studySession?.id ?? null,
        },
        select: sessionSelect,
      });

      // The study session is now happening. Marking it here rather than on
      // finish means the timetable shows the session as in progress while the
      // timer is running, which is what the user is looking at.
      if (studySession) {
        await tx.studySession.update({
          where: { id: studySession.id },
          data: { status: "IN_PROGRESS", startedAt: new Date() },
        });
      }

      return created;
    });

    return session;
  },
});
