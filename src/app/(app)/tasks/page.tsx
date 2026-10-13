import { TaskList, type TaskRow } from "@/components/app/task-list";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Tasks.
 *
 * The initial list is read here rather than fetched from the client, so the
 * page arrives populated and the first paint needs no waterfall. Mutations go
 * through the API and then `router.refresh()`, which re-runs this query and
 * hands the client component fresh server truth.
 *
 * Open *and* done tasks are both loaded, because the list filters client-side
 * across Open / Today / Done / All. Loading only open tasks and switching the
 * tab to Done would show a confident, permanently empty list next to a count of
 * 92 — a filter that looks broken rather than one that admits it is.
 *
 * CANCELLED and ARCHIVED are excluded: they are tombstones, and surfacing them
 * in a daily list only makes it harder to read. The API can still fetch them.
 */

const VISIBLE_STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"] as const;

export default async function TasksPage() {
  const user = await requireUser();

  const [tasks, openCount, doneCount, categories, focusByTask] = await Promise.all([
    prisma.task.findMany({
      where: { userId: user.id, status: { in: [...VISIBLE_STATUSES] } },
      orderBy: [{ priorityScore: "desc" }, { createdAt: "desc" }],
      take: 300,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        importance: true,
        urgency: true,
        dueAt: true,
        completedAt: true,
        estimatedMinutes: true,
        createdAt: true,
        category: { select: { id: true, name: true, color: true } },
        goal: { select: { id: true, title: true } },
        projectLinks: { select: { project: { select: { id: true, name: true } } } },
        _count: { select: { subtasks: true } },
      },
    }),
    prisma.task.count({
      where: { userId: user.id, status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] } },
    }),
    prisma.task.count({ where: { userId: user.id, status: "DONE" } }),
    prisma.category.findMany({
      where: { OR: [{ userId: user.id }, { userId: null }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true },
    }),
    // Focus per task is aggregated once for the whole page rather than selected
    // per row. Nesting the sessions on each of up to 300 tasks would pull every
    // session of the user's history into the payload to compute two numbers that
    // a single grouped query answers directly.
    prisma.focusSession.groupBy({
      by: ["taskId"],
      where: { userId: user.id, taskId: { not: null }, actualSeconds: { gt: 0 } },
      _sum: { actualSeconds: true },
      _max: { startedAt: true },
    }),
  ]);

  const focus = new Map<string, { seconds: number; lastAt: Date | null }>();
  for (const row of focusByTask) {
    if (!row.taskId) continue;
    focus.set(row.taskId, {
      seconds: row._sum.actualSeconds ?? 0,
      lastAt: row._max.startedAt ?? null,
    });
  }

  const rows: TaskRow[] = tasks.map((t) => {
    const focusRow = focus.get(t.id);
    return {
      ...t,
      dueAt: t.dueAt ? t.dueAt.toISOString() : null,
      completedAt: t.completedAt ? t.completedAt.toISOString() : null,
      createdAt: t.createdAt.toISOString(),
      subtaskCount: t._count.subtasks,
      projects: t.projectLinks.map((link) => link.project),
      focusSeconds: focusRow?.seconds ?? 0,
      lastFocusAt: focusRow?.lastAt ? focusRow.lastAt.toISOString() : null,
    };
  });

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Tasks</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          {openCount === 0
            ? "Nothing open. Enjoy it while it lasts."
            : `${openCount} open, ${doneCount} done.`}
        </p>
      </header>

      <TaskList
        initialTasks={rows}
        total={openCount}
        doneTotal={doneCount}
        categories={categories}
      />
    </div>
  );
}
