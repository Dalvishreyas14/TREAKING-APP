import { PlannerDay, type PlannerBlock, type PlannerTask } from "@/components/app/planner-day";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { dateOnlyLocal } from "@/lib/date";
import { serialiseBlock } from "@/lib/planner/server";

export const dynamic = "force-dynamic";

/**
 * The planner.
 *
 * Reads its own data directly rather than through the API, like the dashboard and
 * the task list: this is a server component rendering the data it already has, and
 * a fetch would only add a serialisation step. The API exists for the mutations
 * the client makes, and for the date changes, which fetch without a navigation.
 *
 * Everything is scoped by `userId` in the WHERE clause rather than filtered after
 * the fact, so there is no code path by which one account's blocks reach another's
 * planner.
 */

/** Tasks offered in the unscheduled tray. */
const TRAY_LIMIT = 40;

function toIsoDay(date: Date): string {
  return dateOnlyLocal(date).toISOString().slice(0, 10);
}

export default async function PlannerPage() {
  const user = await requireUser();
  const today = toIsoDay(new Date());

  const [blocks, openTasks] = await Promise.all([
    prisma.timeBlock.findMany({
      where: { userId: user.id, date: dateOnlyLocal(new Date()) },
      orderBy: { startAt: "asc" },
      select: {
        id: true,
        title: true,
        date: true,
        startAt: true,
        endAt: true,
        source: true,
        color: true,
        notes: true,
        locked: true,
        taskId: true,
        habitId: true,
        task: { select: { id: true, title: true, status: true } },
        habit: { select: { id: true, name: true, color: true } },
      },
    }),
    /*
     * Only tasks that could plausibly be scheduled are offered: open, and not
     * already a parent of other work. The tray is a shortlist, not a second task
     * list, so it is capped and ordered by the same priority score the tasks page
     * uses — the things most worth placing in the day float to the top.
     */
    prisma.task.findMany({
      where: {
        userId: user.id,
        status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
        parentId: null,
      },
      orderBy: [{ priorityScore: "desc" }, { createdAt: "desc" }],
      take: TRAY_LIMIT,
      select: { id: true, title: true, estimatedMinutes: true, priority: true },
    }),
  ]);

  const rows: PlannerBlock[] = blocks.map(serialiseBlock);
  const tasks: PlannerTask[] = openTasks.map((t) => ({
    id: t.id,
    title: t.title,
    estimatedMinutes: t.estimatedMinutes,
    priority: t.priority,
  }));

  return <PlannerDay initialBlocks={rows} initialDate={today} initialTasks={tasks} />;
}
