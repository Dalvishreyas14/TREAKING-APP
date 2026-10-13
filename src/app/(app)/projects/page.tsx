import { ProjectBoard, type ProjectRow, type ProjectTaskRow } from "@/components/app/project-board";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Projects.
 *
 * A project is a container for tasks, so this screen is a board rather than a
 * form-heavy editor. Two decisions worth stating:
 *
 * **Progress is derived, not stored.** The project row has a `progress` column
 * and this page deliberately does not read it. A project is "40% done" if 40% of
 * its tasks are done, and a stored number would drift the moment a task is
 * completed elsewhere — the planner, the assistant, a quick-add from the
 * dashboard. Deriving it here means there is no second copy to reconcile.
 *
 * **Task links are loaded, not just counted.** "3 of 7 done" is more useful than
 * "7 tasks" only if the remaining ones are nameable, and the list is capped so a
 * project with two hundred tasks does not make the page unusable.
 */

const PROJECT_LIMIT = 40;
const TASKS_PER_PROJECT = 12;

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const user = await requireUser();
  // A project can be linked to from a task row or a goal card, so the link has to
  // arrive somewhere rather than at the top of an undifferentiated board.
  const { project: highlightId } = await searchParams;

  const [projects, focusByProject] = await Promise.all([
    prisma.project.findMany({
      where: { userId: user.id, status: { not: "ARCHIVED" } },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
      take: PROJECT_LIMIT,
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        color: true,
        icon: true,
        startAt: true,
        dueAt: true,
        createdAt: true,
        // A project answers to a goal when it has one, and showing which is what
        // turns a flat list of projects back into a hierarchy.
        goal: { select: { id: true, title: true } },
        tasks: {
        select: {
          task: {
            select: {
              id: true,
              title: true,
              status: true,
              priority: true,
              dueAt: true,
              completedAt: true,
            },
          },
        },
        take: TASKS_PER_PROJECT,
      },
      milestones: {
        orderBy: { dueAt: "asc" },
        select: {
          id: true,
          title: true,
          detail: true,
          dueAt: true,
          status: true,
          completedAt: true,
        },
      },
      _count: { select: { tasks: true, milestones: true } },
    },
    }),
    // One grouped query for the whole page rather than sessions nested on each
    // project, for the same reason as the task list: the per-project number is
    // all that gets displayed.
    prisma.focusSession.groupBy({
      by: ["projectId"],
      where: { userId: user.id, projectId: { not: null }, actualSeconds: { gt: 0 } },
      _sum: { actualSeconds: true },
    }),
  ]);

  const focus = new Map<string, number>();
  for (const row of focusByProject) {
    if (!row.projectId) continue;
    focus.set(row.projectId, row._sum.actualSeconds ?? 0);
  }

  const rows: ProjectRow[] = projects.map((project) => {
    const linked = project.tasks.map((link) => link.task);
    // "Done" counts CANCELLED and ARCHIVED as closed out. A project whose
    // abandoned tasks permanently read as outstanding is a project that can
    // never look finished, which is not what the user meant when they cancelled
    // three of the seven.
    const done = linked.filter(
      (t) => t.status === "DONE" || t.status === "CANCELLED" || t.status === "ARCHIVED",
    ).length;
    const total = project._count.tasks;
    const openTasks = linked
      .filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS" || t.status === "BLOCKED")
      .sort((a, b) => {
        if (a.dueAt && b.dueAt) return a.dueAt.getTime() - b.dueAt.getTime();
        if (a.dueAt) return -1;
        if (b.dueAt) return 1;
        return 0;
      });

    const tasks: ProjectTaskRow[] = openTasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueAt: t.dueAt?.toISOString() ?? null,
    }));

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      color: project.color,
      icon: project.icon,
      startAt: project.startAt?.toISOString() ?? null,
      dueAt: project.dueAt?.toISOString() ?? null,
      goal: project.goal,
      focusSeconds: focus.get(project.id) ?? 0,
      tasks,
      taskCount: total,
      doneTaskCount: done,
      // 0 when a project has no tasks yet, not NaN from dividing by nothing.
      progressPercent: total > 0 ? Math.round((done / total) * 100) : 0,
      milestones: project.milestones.map((m) => ({
        id: m.id,
        title: m.title,
        detail: m.detail,
        dueAt: m.dueAt?.toISOString() ?? null,
        status: m.status,
        completedAt: m.completedAt?.toISOString() ?? null,
      })),
    };
  });

  const active = rows.filter((r) => r.status === "ACTIVE" || r.status === "PLANNING");

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Projects</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          {rows.length === 0
            ? "Bigger than a task, smaller than a goal."
            : `${active.length} in flight · ${rows.reduce((n, r) => n + r.taskCount, 0)} tasks across ${rows.length} projects`}
        </p>
      </header>

      {rows.length === 0 ? (
        <ProjectBoard
          projects={[]}
          emptyAction={{
            label: "Start a project",
            description: "A project holds the tasks that add up to something. Anything bigger than a day is probably one.",
          }}
        />
      ) : (
        <ProjectBoard projects={rows} highlightId={highlightId ?? null} />
      )}

      <p className="text-[11px] text-ink-subtle">
        Project progress is calculated from its tasks, so it is always in step with
        work completed anywhere in the app.
      </p>
    </div>
  );
}
