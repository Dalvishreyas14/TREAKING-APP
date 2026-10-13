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
  task: { select: { id: true, title: true, status: true } },
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

    const session = await prisma.focusSession.create({
      data: {
        userId: user.id,
        taskId: body.taskId ?? null,
        startedAt: new Date(),
        plannedSeconds: body.plannedSeconds,
        type: body.type,
        notes: body.notes ?? null,
      },
      select: sessionSelect,
    });

    return session;
  },
});
