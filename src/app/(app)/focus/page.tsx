import { addDaysUtc, todayUtc } from "@/lib/date";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { FocusTimer, type FocusSessionRow, type FocusTask } from "@/components/app/focus-timer";

export const dynamic = "force-dynamic";

/**
 * Focus.
 *
 * The timer is deliberately a *client* component but the session row is written
 * on start, not on finish — see the comment in `/api/v1/focus` for why. What
 * this page is responsible for is handing the client the current state: whether
 * something is already running, and the recent history to show alongside.
 *
 * An unfinished session from a closed tab is loaded and offered for resumption
 * rather than hidden. Losing twenty minutes of focus because a laptop slept is
 * the single most annoying way a timer like this can fail, and the row already
 * exists with a server-stamped `startedAt` to measure from.
 */

const HISTORY_DAYS = 14;

export default async function FocusPage() {
  const user = await requireUser();
  const today = todayUtc();
  const from = addDaysUtc(today, -(HISTORY_DAYS - 1));
  const now = new Date();

  const [sessions, openTasks, totals] = await Promise.all([
    prisma.focusSession.findMany({
      where: { userId: user.id, startedAt: { gte: from, lte: now } },
      orderBy: { startedAt: "desc" },
      select: {
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
        studySession: { select: { id: true, title: true, subject: true } },
      },
    }),
    prisma.task.findMany({
      where: {
        userId: user.id,
        status: { in: ["TODO", "IN_PROGRESS"] },
        parentId: null,
      },
      orderBy: [{ priorityScore: "desc" }, { createdAt: "desc" }],
      take: 20,
      select: { id: true, title: true },
    }),
    prisma.focusSession.aggregate({
      where: { userId: user.id, startedAt: { gte: from, lte: now }, endedAt: { not: null } },
      _sum: { actualSeconds: true, xpAwarded: true },
      _count: { _all: true },
    }),
  ]);

  const rows: FocusSessionRow[] = sessions.map((s) => ({
    id: s.id,
    taskId: s.taskId,
    taskTitle: s.task?.title ?? null,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt?.toISOString() ?? null,
    plannedSeconds: s.plannedSeconds,
    actualSeconds: s.actualSeconds,
    type: s.type,
    rating: s.rating,
    notes: s.notes,
    endedEarly: s.endedEarly,
    xpAwarded: s.xpAwarded,
    pausedAt: s.pausedAt?.toISOString() ?? null,
    pausedSeconds: s.pausedSeconds,
    studySessionId: s.studySessionId,
    studyTitle: s.studySession?.title ?? null,
    studySubject: s.studySession?.subject ?? null,
    unfinished: s.endedAt === null,
  }));

  const tasks: FocusTask[] = openTasks.map((t) => ({ id: t.id, title: t.title }));

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Focus</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          One session at a time. Sessions are saved the moment you start, so
          closing the tab does not lose them.
        </p>
      </header>

      <FocusTimer
        initialSessions={rows}
        tasks={tasks}
        todayMinutes={Math.round((totals._sum.actualSeconds ?? 0) / 60)}
        sessionCount={totals._count._all}
        xp={totals._sum.xpAwarded ?? 0}
        windowDays={HISTORY_DAYS}
      />
    </div>
  );
}
