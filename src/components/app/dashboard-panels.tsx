import {
  ArrowRight,
  Dumbbell,
  Flag,
  GraduationCap,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, MetricDisclosure } from "@/components/feedback/empty-state";
import {
  correlationPanel,
  goalPanel,
  projectPanel,
  trackSummary,
  type CorrelationEntry,
  type GoalPanel,
  type ProjectPanel,
  type TrackSummary,
} from "@/lib/dashboard-summary";
import type { LifeSnapshot } from "@/lib/ai/snapshot";
import { formatFocusSeconds } from "@/lib/format/duration";
import { DRIFT_THRESHOLD } from "@/lib/progress";

/**
 * The analytical half of the dashboard.
 *
 * Everything here is derived from the `LifeSnapshot` rather than queried in the
 * page, so the numbers below agree with the insights, analytics and AI screens
 * that read the same snapshot. The panels sit alongside the existing
 * today-scoped cards rather than replacing them: "what is happening now" and
 * "where am I heading" are different questions and collapsing them is how a
 * dashboard stops being glanceable.
 *
 * Two presentation rules are load-bearing:
 *
 *   - An unmeasured value renders as a dash with a reason, never as 0%.
 *   - A goal's stated progress and its derived progress are shown as two
 *     separate numbers. Collapsing them into one is the single easiest way for
 *     a tracker to start flattering its owner.
 */

// ------------------------------------------------------------------- goals

function GoalProgressPanel({ panel }: { panel: GoalPanel }) {
  if (panel.activeCount === 0) {
    return (
      <Card>
        <CardHeader className="space-y-0 pb-3">
          <CardTitle className="text-[13px]">Goal progress</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            size="sm"
            icon={Flag}
            title="No active goals"
            description="A goal gives every task below it somewhere to point, and shows whether it is moving."
            action={{ label: "Set a goal", href: "/goals" }}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-[13px]">Goal progress</CardTitle>
        <Button variant="ghost" size="xs" asChild>
          <a href="/goals">
            All goals
            <ArrowRight aria-hidden />
          </a>
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-[11px] text-ink-subtle">
          You rate goals by hand; the second figure is what the milestones and
          tasks add up to.
        </p>
        <ul className="flex flex-col gap-2.5">
          {panel.entries.slice(0, 4).map((goal) => (
            <li
              key={goal.id}
              className="rounded-control border border-line p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <a
                  href={`/goals?goal=${goal.id}`}
                  className="truncate text-[13px] font-medium hover:underline"
                >
                  {goal.title}
                </a>
                {goal.isDrifting ? (
                  <Badge variant="amber" size="sm">
                    differs
                  </Badge>
                ) : null}
              </div>

              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-lg font-semibold tabular-nums">
                  {goal.stated}%
                </span>
                <span aria-hidden className="text-ink-subtle">
                  &rarr;
                </span>
                {goal.derived === null ? (
                  <span className="text-[13px] text-ink-subtle">
                    nothing attached yet
                  </span>
                ) : (
                  <span className="text-[13px] text-ink-muted tabular-nums">
                    {goal.derived}% from work
                  </span>
                )}
              </div>

              {goal.derived !== null ? (
                <div
                  className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-3"
                  role="img"
                  aria-label={`${goal.title}: you rate this ${goal.stated} percent, the attached work measures ${goal.derived} percent`}
                >
                  <div
                    className="h-full rounded-full bg-lime"
                    style={{ width: `${goal.derived}%` }}
                  />
                </div>
              ) : null}

              {goal.isDrifting ? (
                <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">
                  {goal.drift! > 0
                    ? `You are ${Math.abs(goal.drift!)} points ahead of the tasks and milestones behind this goal.`
                    : `The work behind this goal is ${Math.abs(goal.drift!)} points further along than your rating.`}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        {panel.entries.length > 4 ? (
          <p className="text-[11px] text-ink-subtle">
            +{panel.entries.length - 4} more active{" "}
            {panel.entries.length - 4 === 1 ? "goal" : "goals"}
          </p>
        ) : null}
        {panel.driftingCount > 0 ? (
          <p className="text-[11px] leading-relaxed text-ink-subtle">
            {panel.driftingCount} of your active{" "}
            {panel.driftingCount === 1 ? "goal is" : "goals are"} rated more
            than {DRIFT_THRESHOLD} points away from the work attached to
            {panel.driftingCount === 1 ? " it" : " them"}.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- projects

function ProjectMomentumPanel({ panel }: { panel: ProjectPanel }) {
  const live = panel.entries.filter(
    (p) => p.status !== "COMPLETED" && p.status !== "ARCHIVED",
  );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-[13px]">Projects</CardTitle>
        <Button variant="ghost" size="xs" asChild>
          <a href="/projects">
            All projects
            <ArrowRight aria-hidden />
          </a>
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {live.length === 0 ? (
          <p className="text-[13px] text-ink-subtle">
            No projects running. A project groups the tasks that add up to
            something.
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {live.slice(0, 4).map((project) => (
              <li key={project.id} className="rounded-control border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <a
                    href={`/projects?project=${project.id}`}
                    className="truncate text-[13px] font-medium hover:underline"
                  >
                    {project.name}
                  </a>
                  <MomentumBadge direction={project.momentum.direction} />
                </div>

                {project.goalTitle ? (
                  <p className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-subtle">
                    <Flag aria-hidden className="size-3" />
                    {project.goalTitle}
                  </p>
                ) : null}

                <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-subtle">
                  <span className="tabular-nums">
                    {project.doneTaskCount}/{project.taskCount} tasks
                  </span>
                  {project.focusSeconds > 0 ? (
                    <span className="tabular-nums">
                          {formatFocusSeconds(project.focusSeconds)} focus
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {panel.unattributedFocusSeconds > 0 ? (
          <p className="text-[11px] leading-relaxed text-ink-subtle">
            {panel.unattributedFocusSeconds}{" "}
            {panel.unattributedFocusSeconds === 1 ? "focus session" : "focus sessions"} in
            this window were not tied to a project.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MomentumBadge({ direction }: { direction: string }) {
  if (direction === "up") {
    return (
      <Badge variant="lime" size="sm">
        <TrendingUp aria-hidden />
        speeding up
      </Badge>
    );
  }
  if (direction === "down") {
    return (
      <Badge variant="coral" size="sm">
        <TrendingDown aria-hidden />
        slowing
      </Badge>
    );
  }
  if (direction === "flat") {
    return <Badge variant="neutral" size="sm">steady</Badge>;
  }
  return <Badge variant="outline" size="sm">not enough data</Badge>;
}

// ------------------------------------------------------ fitness and study

function TrackPanel({ summary }: { summary: TrackSummary }) {
  const meta: Record<TrackSummary["kind"], {
    icon: LucideIcon;
    title: string;
    href: string;
  }> = {
    FITNESS: { icon: Dumbbell, title: "Fitness", href: "/fitness" },
    STUDY: { icon: GraduationCap, title: "Study", href: "/study" },
  };
  const { icon: Icon, title, href } = meta[summary.kind];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-1.5 text-[13px]">
          <Icon aria-hidden className="size-3.5 text-ink-subtle" />
          {title}
        </CardTitle>
        <Button variant="ghost" size="xs" asChild>
          <a href={href}>
            Open
            <ArrowRight aria-hidden />
          </a>
        </Button>
      </CardHeader>
      <CardContent>
        {summary.empty ? (
          <p className="text-[13px] text-ink-subtle">
            No {title.toLowerCase()} habits yet. Add one and it appears here and
            on its own page.
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-[11px] text-ink-subtle">Habits</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">
                {summary.habitCount}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-ink-subtle">Kept</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">
                {summary.completion === null ? "—" : `${summary.completion}%`}
              </dd>
            </div>
            {summary.blockedMinutes > 0 ? (
              <div className="col-span-2">
                <dt className="text-[11px] text-ink-subtle">
                  Scheduled in the window
                </dt>
                <dd className="mt-1 text-[13px] tabular-nums">
                  {summary.blockedMinutes} minutes blocked
                </dd>
              </div>
            ) : null}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------ correlations

function CorrelationPanel({ entries }: { entries: CorrelationEntry[] }) {
  return (
    <Card>
      <CardHeader className="space-y-0 pb-3">
        <CardTitle className="text-[13px]">What moves together</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {entries.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-ink-subtle">
            Not enough overlapping days yet to say anything. Once a couple of
            weeks of sleep, focus and habits line up, the pairs worth knowing
            about appear here.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {entries.slice(0, 3).map((entry) => (
                <li
                  key={entry.id}
                  className="rounded-control border border-line p-3"
                >
                  <p className="text-[13px]">
                    <span className="font-medium">{entry.left}</span>{" "}
                    <span className="text-ink-subtle">
                      {entry.direction === "together" ? "moves with" : "moves against"}{" "}
                    </span>
                    <span className="font-medium">{entry.right}</span>
                  </p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Badge
                      variant={entry.direction === "together" ? "aqua" : "amber"}
                      size="sm"
                    >
                      r {entry.r.toFixed(2)}
                    </Badge>
                    <span className="text-[11px] text-ink-subtle">
                      {entry.sampleSize} days &middot; {entry.confidence}% confidence
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <MetricDisclosure variant="insight" />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The four analytical panels, in the order they read best. */
export function DashboardInsights({ snapshot }: { snapshot: LifeSnapshot }) {
  const goals = goalPanel(snapshot);
  const projects = projectPanel(snapshot);
  const fitness = trackSummary(snapshot, "FITNESS");
  const study = trackSummary(snapshot, "STUDY");
  const correlations = correlationPanel(snapshot);

  // Nothing to say yet. A dashboard that greets a new account with three
  // empty analytical panels is just noise.
  if (snapshot.sparse) return null;

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <GoalProgressPanel panel={goals} />
        <ProjectMomentumPanel panel={projects} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <TrackPanel summary={fitness} />
        <TrackPanel summary={study} />
        <div className="lg:col-span-1">
          <CorrelationPanel entries={correlations} />
        </div>
      </div>
    </>
  );
}
