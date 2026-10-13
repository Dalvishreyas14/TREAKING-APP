import { GoalBoard, type GoalRow, type GoalMilestoneRow } from "@/components/app/goal-board";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { MetricDisclosure } from "@/components/feedback/empty-state";
import { goalWorkProgress } from "@/lib/progress";

export const dynamic = "force-dynamic";

/**
 * Goals.
 *
 * A goal is a direction, not a task list, so this screen is organised around the
 * two questions a goal actually raises: how far along is it, and is it on track
 * for its own date. The second one is the interesting one, and it is computed here
 * rather than in the client because it needs the elapsed fraction of the goal's
 * own timeline — progress below that fraction is a real signal, progress above it
 * is ahead of schedule, and neither means anything without the comparison.
 *
 * `onTrack` is reported as three states rather than a percentage of the date. "80%
 * of the time is gone and you are at 55%" and "80% of the time is gone and you are
 * at 100%" are both fine, and a single number would call the first one a problem
 * and the second one better than complete.
 *
 * The stated progress and the derived one are both shown, and never overwritten.
 * A goal at 90% with ten of its eleven tasks still open is the single most
 * common way a tracker starts lying, and the only way to notice is to have both
 * numbers on screen. See `@/lib/progress`.
 */

const GOAL_LIMIT = 50;
const TASKS_PER_GOAL = 500;

type OnTrack = "AHEAD" | "ON_TRACK" | "BEHIND" | "NO_DATE" | "DONE";

/**
 * How far through its own timeline a goal is, as a 0-1 fraction.
 *
 * Only meaningful when the goal has a target date, and the elapsed fraction is
 * clamped: a goal whose date has passed is "all the time is used up", not a
 * negative or a number above 1.
 */
function timelineProgress(start: Date | null, target: Date | null, now: Date): number | null {
  if (!target) return null;
  const total = target.getTime() - (start?.getTime() ?? now.getTime());
  if (total <= 0) return 1;
  const elapsed = now.getTime() - (start?.getTime() ?? now.getTime());
  return Math.max(0, Math.min(1, elapsed / total));
}

function onTrack(
  progress: number,
  timeline: number | null,
  status: string,
): OnTrack {
  if (status === "ACHIEVED") return "DONE";
  if (timeline === null) return "NO_DATE";
  if (progress >= 100) return "DONE";
  // A 10-point cushion. Anything tighter than that and a goal sitting exactly on
  // its own expected pace gets flagged, which trains people to ignore the flag.
  if (progress / 100 > timeline + 0.1) return "AHEAD";
  if (progress / 100 < timeline - 0.1) return "BEHIND";
  return "ON_TRACK";
}

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ goal?: string }>;
}) {
  const user = await requireUser();
  const now = new Date();
  // Goals are linked to from project cards and task rows, so the link has to
  // arrive at the specific goal rather than the top of the board.
  const { goal: highlightId } = await searchParams;

  const [goals, focusByProject] = await Promise.all([
    prisma.goal.findMany({
      where: { userId: user.id },
      orderBy: [{ status: "asc" }, { targetDate: "asc" }, { createdAt: "desc" }],
      take: GOAL_LIMIT,
      select: {
        id: true,
        title: true,
        description: true,
        horizon: true,
        status: true,
        progress: true,
        startDate: true,
        targetDate: true,
        achievedAt: true,
        color: true,
        icon: true,
        category: { select: { id: true, name: true, color: true } },
        milestones: {
          orderBy: { sortOrder: "asc" },
          select: { id: true, title: true, detail: true, targetDate: true, status: true, completedAt: true },
        },
        checkIns: {
          orderBy: { createdAt: "desc" },
          take: 8,
          select: { id: true, createdAt: true, note: true, progress: true },
        },
        _count: { select: { tasks: true } },
        // Task statuses are needed for the derived figure, so the rows are read
        // rather than counted. `_count` cannot say how many of them are done,
        // which is the whole question.
        tasks: {
          take: TASKS_PER_GOAL,
          select: { status: true, completedAt: true },
        },
        // The path from a goal down to actual work: which projects serve it, and
        // how far each of those has got.
        projects: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            status: true,
            _count: { select: { tasks: true } },
            tasks: { select: { task: { select: { status: true } } } },
          },
        },
      },
    }),
    prisma.focusSession.groupBy({
      by: ["projectId"],
      where: { userId: user.id, projectId: { not: null }, actualSeconds: { gt: 0 } },
      _sum: { actualSeconds: true },
    }),
  ]);

  const projectFocus = new Map<string, number>();
  for (const row of focusByProject) {
    if (!row.projectId) continue;
    projectFocus.set(row.projectId, row._sum.actualSeconds ?? 0);
  }

  const rows: GoalRow[] = goals.map((goal) => {
    const timeline = timelineProgress(goal.startDate, goal.targetDate, now);
    const milestones: GoalMilestoneRow[] = goal.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      detail: m.detail,
      targetDate: m.targetDate?.toISOString() ?? null,
      status: m.status,
      completedAt: m.completedAt?.toISOString() ?? null,
    }));

    const derived = goalWorkProgress({
      statedPercent: goal.progress,
      tasks: goal.tasks,
      milestones: goal.milestones,
    });

    const projects = goal.projects.map((p) => {
      const done = p.tasks.filter((link) => link.task.status === "DONE").length;
      return {
        id: p.id,
        name: p.name,
        status: p.status,
        taskCount: p._count.tasks,
        doneTaskCount: done,
        focusSeconds: projectFocus.get(p.id) ?? 0,
      };
    });

    return {
      id: goal.id,
      title: goal.title,
      description: goal.description,
      horizon: goal.horizon,
      status: goal.status,
      progress: goal.progress,
      color: goal.color,
      icon: goal.icon,
      startDate: goal.startDate?.toISOString() ?? null,
      targetDate: goal.targetDate?.toISOString() ?? null,
      category: goal.category,
      milestones,
      checkIns: goal.checkIns.map((c) => ({
        id: c.id,
        createdAt: c.createdAt.toISOString(),
        note: c.note,
        progress: c.progress,
      })),
      taskCount: goal._count.tasks,
      derivedPercent: derived.derivedPercent,
      driftFromStated: derived.driftFromStated,
      isDrifting: derived.isDrifting,
      projects,
      focusSeconds: projects.reduce((sum, p) => sum + p.focusSeconds, 0),
      timelinePercent: timeline === null ? null : Math.round(timeline * 100),
      track: onTrack(goal.progress, timeline, goal.status),
    };
  });

  const withDate = rows.filter((r) => r.timelinePercent !== null);
  const behind = withDate.filter((r) => r.track === "BEHIND").length;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Goals</h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            {rows.length === 0
              ? "The things you are actually aiming at."
              : `${rows.filter((r) => r.status === "ACTIVE").length} active${
                  behind > 0 ? `, ${behind} behind their own timeline` : ""
                }.`}
          </p>
        </div>
        <MetricDisclosure variant="balance" className="max-w-sm" />
      </header>

      <GoalBoard goals={rows} highlightId={highlightId ?? null} />
    </div>
  );
}
