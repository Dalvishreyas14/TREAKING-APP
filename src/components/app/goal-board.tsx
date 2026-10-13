"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, FolderKanban, Pause, Play, Plus, Target, Trash2 } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/auth/field";
import { Input, Textarea } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiClientError } from "@/lib/api/client";
import { formatDayMonth, formatIndianMedium } from "@/lib/format/date";
import { formatFocusSeconds } from "@/lib/format/duration";
import { cn } from "@/lib/utils";

/**
 * Goals.
 *
 * Two interactions that need a reason to be the way they are:
 *
 * **Progress is a slider, not a number field.** It is a coarse, self-reported
 * estimate of "how far along am I", and typing 63% of nothing is a different act
 * from dragging a thumb to roughly the right place. The number is still shown
 * live, because seeing it move is the point.
 *
 * **Setting progress to 100 marks the goal achieved, and unmarking clears it.**
 * The two fields are stored independently in the database, so the client has to
 * keep them paired or the screen shows a 100%-complete goal still sitting in the
 * "active" list, which is the kind of thing that makes someone stop trusting the
 * whole page.
 */

export interface GoalMilestoneRow {
  id: string;
  title: string;
  detail: string | null;
  targetDate: string | null;
  status: string;
  completedAt: string | null;
}

export interface GoalRow {
  id: string;
  title: string;
  description: string | null;
  horizon: string;
  status: string;
  progress: number;
  color: string;
  icon: string;
  startDate: string | null;
  targetDate: string | null;
  category: { id: string; name: string; color: string } | null;
  milestones: GoalMilestoneRow[];
  checkIns: { id: string; createdAt: string; note: string | null; progress: number | null }[];
  taskCount: number;
  /**
   * What the milestones and tasks say, next to the stated figure. Null when the
   * goal has neither attached, which is different from zero.
   */
  derivedPercent: number | null;
  /** Stated minus derived, in points. Null when derived is unknown. */
  driftFromStated: number | null;
  isDrifting: boolean;
  /** Projects serving this goal, with the focus each has absorbed. */
  projects: {
    id: string;
    name: string;
    status: string;
    taskCount: number;
    doneTaskCount: number;
    focusSeconds: number;
  }[];
  /** Focus across this goal's projects, in seconds. */
  focusSeconds: number;
  timelinePercent: number | null;
  track: "AHEAD" | "ON_TRACK" | "BEHIND" | "NO_DATE" | "DONE";
}

const TRACK_COPY: Record<GoalRow["track"], { label: string; variant: "lime" | "amber" | "coral" | "neutral" }> = {
  AHEAD: { label: "Ahead of schedule", variant: "lime" },
  ON_TRACK: { label: "On track", variant: "lime" },
  BEHIND: { label: "Behind schedule", variant: "amber" },
  NO_DATE: { label: "No target date", variant: "neutral" },
  DONE: { label: "Achieved", variant: "lime" },
};

const HORIZONS = [
  { value: "SHORT", label: "Short — under 3 months" },
  { value: "MEDIUM", label: "Medium — 3 to 12 months" },
  { value: "LONG", label: "Long — over a year" },
];

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso);
  target.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
}

function formatTarget(iso: string | null): string {
  if (!iso) return "No target date";
  const days = daysUntil(iso);
  // `targetDate` is a `@db.Date`, so the UTC calendar day is the day the user
  // picked. `new Date(iso)` parses a bare YYYY-MM-DD as UTC midnight, which the
  // Local* formatters would read as the previous day west of Greenwich.
  const date = formatIndianMedium(new Date(iso));
  if (days === null) return date;
  if (days < 0) return `${date} · ${Math.abs(days)}d past`;
  if (days === 0) return `${date} · today`;
  if (days <= 60) return `${date} · ${days}d left`;
  return date;
}

export function GoalBoard({
  goals: initialGoals,
  highlightId = null,
}: {
  goals: GoalRow[];
  /** Goal to mark and scroll to, when arriving from a project or task. */
  highlightId?: string | null;
}) {
  const router = useRouter();
  const [goals, setGoals] = React.useState(initialGoals);
  const [showDone, setShowDone] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<GoalRow | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  // A cross-link into a board of goals is only useful if the goal it names is
  // visibly the one you arrived at. Finished goals live behind a toggle, so the
  // target is scrolled to rather than hidden behind it.
  React.useEffect(() => {
    if (!highlightId) return;
    document
      .getElementById(`goal-${highlightId}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightId, goals]);

  const [syncedFrom, setSyncedFrom] = React.useState(initialGoals);
  if (syncedFrom !== initialGoals) {
    setSyncedFrom(initialGoals);
    setGoals(initialGoals);
  }

  const live = goals.filter((g) => g.status === "ACTIVE" || g.status === "PAUSED");
  const done = goals.filter((g) => g.status === "ACHIEVED" || g.status === "ABANDONED");
  // Linking straight to a finished goal has to reveal it, or the link scrolls to
  // nothing and reads as broken. Derived rather than set in an effect so the
  // toggle still owns the user's own choice.
  const revealDone =
    showDone ||
    (highlightId !== null &&
      done.some((g) => g.id === highlightId));
  const visible = revealDone ? [...live, ...done] : live;

  /**
   * Progress is written on release, not on every pixel of drag. A slider fires a
   * change per frame, and a PATCH per frame would be a hundred requests to move
   * a thumb — so the local value moves freely and the write happens once.
   */
  async function commitProgress(goal: GoalRow, next: number) {
    const rounded = Math.round(next);
    const before = goals;
    setGoals((prev) => prev.map((g) => (g.id === goal.id ? { ...g, progress: rounded } : g)));
    setBusyId(goal.id);
    try {
      // Progress and status are stored separately, so they are written together.
      // Reaching 100 means the goal is achieved; dropping back below it reopens
      // the goal rather than leaving a finished thing sitting in the active list.
      const status = rounded >= 100 ? "ACHIEVED" : goal.status === "ACHIEVED" ? "ACTIVE" : goal.status;
      await api.patch(`/api/v1/goals/${goal.id}`, { progress: rounded, status });
      router.refresh();
    } catch (error) {
      setGoals(before);
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not save that progress.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(goal: GoalRow, status: string) {
    setBusyId(goal.id);
    try {
      await api.patch(`/api/v1/goals/${goal.id}`, { status });
      toast.success(status === "PAUSED" ? "Goal paused." : "Goal resumed.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not update the goal.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleMilestone(goal: GoalRow, milestone: GoalMilestoneRow) {
    const nextStatus = milestone.status === "DONE" ? "PENDING" : "DONE";
    setBusyId(goal.id);
    try {
      await api.patch(`/api/v1/goals/${goal.id}/milestones/${milestone.id}`, {
        status: nextStatus,
      });
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not update the milestone.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function remove(goal: GoalRow) {
    setBusyId(goal.id);
    try {
      await api.delete(`/api/v1/goals/${goal.id}`);
      toast.success("Goal removed.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not remove the goal.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="lime" size="sm" onClick={() => setCreating(true)}>
            <Plus /> New goal
          </Button>
          {done.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setShowDone((v) => !v)}>
              {showDone ? "Hide" : "Show"} {done.length} finished
            </Button>
          ) : null}
        </div>
      </div>

      {visible.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Target}
              title="No goals yet"
              description="A goal is the outcome you want, not the tasks that get you there. Tasks can hang off it once it exists."
              action={{ label: "Create a goal", onClick: () => setCreating(true) }}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {visible.map((goal) => {
            const track = TRACK_COPY[goal.track];
            const open = expanded === goal.id;
            const doneMilestones = goal.milestones.filter((m) => m.status === "DONE").length;

            return (
              <Card
                key={goal.id}
                id={`goal-${goal.id}`}
                className={cn(
                  /*
                   * `min-w-0` is load-bearing, not decoration.
                   *
                   * A grid item defaults to `min-width: auto`, which means it
                   * refuses to shrink below its content's intrinsic minimum width.
                   * Inside this card is a row of project links whose name is
                   * `truncate` with the counters `shrink-0` beside it - correct
                   * markup that only works once the row is given a definite width
                   * to truncate against. Without `min-w-0` the card's minimum is
                   * that row's full untruncated width, the single-column grid at
                   * 375px blows past the viewport, and the whole page scrolls
                   * sideways on a phone.
                   */
                  "flex min-w-0 scroll-mt-24 flex-col transition-shadow",
                  highlightId === goal.id &&
                    "ring-2 ring-lime/60 ring-offset-2 ring-offset-canvas",
                )}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{goal.title}</CardTitle>
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        {formatTarget(goal.targetDate)}
                        {goal.category ? ` · ${goal.category.name}` : ""}
                      </p>
                    </div>
                    <Badge variant={track.variant} size="sm">
                      {track.label}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="flex flex-1 flex-col gap-4">
                  {goal.description ? (
                    <p className="text-sm leading-relaxed text-ink-muted">{goal.description}</p>
                  ) : null}

                  <div className="flex flex-col gap-2">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[13px] text-ink-muted">Progress</span>
                      <span className="text-sm font-semibold tabular-nums text-ink">
                        {Math.round(goal.progress)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={goal.progress}
                      disabled={busyId === goal.id}
                      onChange={(e) =>
                        setGoals((prev) =>
                          prev.map((g) =>
                            g.id === goal.id ? { ...g, progress: Number(e.target.value) } : g,
                          ),
                        )
                      }
                      onPointerUp={(e) =>
                        commitProgress(goal, Number((e.target as HTMLInputElement).value))
                      }
                      onKeyUp={(e) =>
                        commitProgress(goal, Number((e.target as HTMLInputElement).value))
                      }
                      aria-label={`Progress towards ${goal.title}`}
                      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-3 accent-lime"
                    />

                    {goal.timelinePercent !== null && goal.status === "ACTIVE" ? (
                      <p className="text-[11px] text-ink-subtle">
                        {goal.timelinePercent}% of the time has passed
                        {goal.track === "BEHIND"
                          ? ` · ${Math.round(goal.timelinePercent - goal.progress)} points behind`
                          : goal.track === "AHEAD"
                            ? ` · ${Math.round(goal.progress - goal.timelinePercent)} points ahead`
                            : ""}
                      </p>
                    ) : null}
                  </div>

                  {/* What the work says, beside what the user said. Both are kept
                      because the gap between them is the finding: a goal marked
                      90% whose tasks are 10% done is worth seeing, not resolving
                      in favour of either number. */}
                  {goal.derivedPercent !== null ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-ink-subtle">
                        Work says {goal.derivedPercent}%
                      </span>
                      {goal.driftFromStated !== null && goal.driftFromStated !== 0 ? (
                        <Badge
                          variant={goal.isDrifting ? "amber" : "neutral"}
                          size="sm"
                        >
                          {goal.driftFromStated > 0
                            ? `${goal.driftFromStated} points optimistic`
                            : `${Math.abs(goal.driftFromStated)} points pessimistic`}
                        </Badge>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-[11px] text-ink-subtle">
                      No milestones or tasks attached yet, so there is no second
                      figure to compare against.
                    </p>
                  )}

                  {/* Goal -> project, with the focus each project has absorbed. */}
                  {goal.projects.length > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      <p className="text-[13px] font-medium text-ink-muted">
                        Projects ({goal.projects.length})
                        {goal.focusSeconds > 0
                          ? ` · ${formatFocusSeconds(goal.focusSeconds)} focused`
                          : ""}
                      </p>
                      <ul className="flex flex-col gap-1">
                        {goal.projects.map((p) => (
                          <li key={p.id}>
                            <Link
                              href={`/projects?project=${p.id}`}
                              className="flex items-center gap-2 rounded-control px-1.5 py-1.5 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime/40"
                            >
                              <FolderKanban
                                aria-hidden
                                className="size-3.5 shrink-0 text-ink-subtle"
                              />
                              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                                {p.name}
                              </span>
                              <span className="shrink-0 text-[11px] text-ink-subtle tabular-nums">
                                {p.doneTaskCount}/{p.taskCount}
                              </span>
                              {p.focusSeconds > 0 ? (
                                <span className="shrink-0 text-[11px] text-ink-subtle">
                                  {formatFocusSeconds(p.focusSeconds)}
                                </span>
                              ) : null}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {goal.milestones.length > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : goal.id)}
                        className="flex items-center justify-between text-[13px] font-medium text-ink-muted transition-colors hover:text-ink"
                      >
                        <span>
                          Milestones ({doneMilestones}/{goal.milestones.length})
                        </span>
                        <span className="text-xs text-ink-subtle">
                          {open ? "Hide" : "Show"}
                        </span>
                      </button>

                      {open ? (
                        <ul className="flex flex-col gap-1">
                          {goal.milestones.map((m) => (
                            <li key={m.id}>
                              <button
                                type="button"
                                disabled={busyId === goal.id}
                                onClick={() => toggleMilestone(goal, m)}
                                className="flex w-full items-center gap-2.5 rounded-control px-1.5 py-1.5 text-left transition-colors hover:bg-surface-2 disabled:opacity-50"
                              >
                                <span
                                  className={cn(
                                    "grid size-4 shrink-0 place-items-center rounded-[5px] border",
                                    m.status === "DONE"
                                      ? "border-lime bg-lime text-ink-inverse"
                                      : "border-line-strong",
                                  )}
                                >
                                  {m.status === "DONE" ? <Check className="size-3" strokeWidth={3} /> : null}
                                </span>
                                <span
                                  className={cn(
                                    "flex-1 truncate text-[13px]",
                                    m.status === "DONE" ? "text-ink-subtle line-through" : "text-ink",
                                  )}
                                >
                                  {m.title}
                                </span>
                                {m.targetDate ? (
                                  <span className="text-[11px] text-ink-subtle">
                                    {formatDayMonth(new Date(m.targetDate))}
                                  </span>
                                ) : null}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-3">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setEditing(goal)}
                      disabled={busyId === goal.id}
                    >
                      Edit
                    </Button>
                    {goal.status === "PAUSED" ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => setStatus(goal, "ACTIVE")}
                        disabled={busyId === goal.id}
                      >
                        <Play /> Resume
                      </Button>
                    ) : goal.status === "ACTIVE" ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => setStatus(goal, "PAUSED")}
                        disabled={busyId === goal.id}
                      >
                        <Pause /> Pause
                      </Button>
                    ) : null}
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => remove(goal)}
                      disabled={busyId === goal.id}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <GoalForm
        open={creating || editing !== null}
        goal={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function GoalForm({
  open,
  goal,
  onClose,
  onSaved,
}: {
  open: boolean;
  goal: GoalRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [horizon, setHorizon] = React.useState("MEDIUM");
  const [targetDate, setTargetDate] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // Repopulate whenever the dialog opens, so editing a different goal never
  // shows the previous one's values.
  const [syncedGoal, setSyncedGoal] = React.useState(goal);
  if (open && syncedGoal !== goal) {
    setSyncedGoal(goal);
    setTitle(goal?.title ?? "");
    setDescription(goal?.description ?? "");
    setHorizon(goal?.horizon ?? "MEDIUM");
    setTargetDate(goal?.targetDate ? goal.targetDate.slice(0, 10) : "");
    setErrors({});
  }

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const body = {
        title,
        description: description.trim() || null,
        horizon,
        // Sent as a date at midnight local. The column is a `@db.Date`, so the
        // day is what matters and the instant is not.
        targetDate: targetDate ? new Date(`${targetDate}T00:00:00`) : null,
      };

      if (goal) {
        await api.patch(`/api/v1/goals/${goal.id}`, body);
      } else {
        await api.post("/api/v1/goals", body);
      }

      toast.success(goal ? "Goal updated." : "Goal created.");
      onSaved();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrors(error.fieldErrors);
        if (Object.keys(error.fieldErrors).length === 0) {
          setErrors({ title: error.message });
        }
      } else {
        setErrors({ title: "Could not save the goal." });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{goal ? "Edit goal" : "New goal"}</DialogTitle>
          <DialogDescription>
            The outcome, not the steps. Break it into milestones afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field label="Title" error={errors.title}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Run a half marathon"
              maxLength={200}
              disabled={busy}
            />
          </Field>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-muted">Why it matters</span>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              disabled={busy}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-muted">Horizon</span>
              <Select value={horizon} onValueChange={setHorizon} disabled={busy}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HORIZONS.map((h) => (
                    <SelectItem key={h.value} value={h.value}>
                      {h.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <Field label="Target date" error={errors.targetDate} hint="Used to judge pace.">
              <Input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                disabled={busy}
              />
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="lime"
            onClick={submit}
            loading={busy}
            loadingText="Saving"
            disabled={!title.trim()}
          >
            {goal ? "Save changes" : "Create goal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
