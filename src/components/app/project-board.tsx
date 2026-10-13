"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, FolderKanban, Plus, Target, Trash2, Unlink } from "lucide-react";

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
import { Progress } from "@/components/ui/primitives";
import { api, ApiClientError } from "@/lib/api/client";
import { formatFocusSeconds } from "@/lib/format/duration";
import { formatLocalDayMonth } from "@/lib/format/date";
import { cn } from "@/lib/utils";

/**
 * Projects.
 *
 * A board of containers, with each one's open tasks listed inside it. The useful
 * action on a project is usually detaching a task that turned out not to belong
 * to it, so that is the prominent one — and it *detaches* rather than deletes.
 *
 * Deleting a task that is merely in the wrong project would lose the task, and
 * the user's reaction to a project screen silently eating a task is to stop
 * trusting it. The task survives; only the link goes.
 */

export interface ProjectTaskRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueAt: string | null;
}

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  color: string;
  icon: string;
  startAt: string | null;
  dueAt: string | null;
  /** The goal this project serves, or null. A project may stand on its own. */
  goal?: { id: string; title: string } | null;
  /** Focus time attributed to this project, in seconds, all time. */
  focusSeconds?: number;
  tasks: ProjectTaskRow[];
  taskCount: number;
  doneTaskCount: number;
  progressPercent: number;
  milestones: {
    id: string;
    title: string;
    detail: string | null;
    dueAt: string | null;
    status: string;
    completedAt: string | null;
  }[];
}

const STATUS_TONE: Record<string, "neutral" | "lime" | "amber" | "iris" | "coral"> = {
  PLANNING: "neutral",
  ACTIVE: "lime",
  ON_HOLD: "amber",
  COMPLETED: "iris",
  ARCHIVED: "coral",
};

function dueLabel(iso: string | null): string | null {
  if (!iso) return null;
  const due = new Date(iso);
  const now = new Date();
  const days = Math.round(
    (due.setHours(0, 0, 0, 0) - now.setHours(0, 0, 0, 0)) / 86_400_000,
  );
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days <= 7) return `in ${days}d`;
  return formatLocalDayMonth(due);
}

export function ProjectBoard({
  projects: initialProjects,
  emptyAction,
  highlightId = null,
}: {
  projects: ProjectRow[];
  emptyAction?: { label: string; description: string };
  /** Project to mark and scroll to, when arriving from a cross-link. */
  highlightId?: string | null;
}) {
  const router = useRouter();
  const [projects, setProjects] = React.useState(initialProjects);
  const [creating, setCreating] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  // A cross-link that lands on a board of thirty projects and highlights nothing
  // reads as a broken link, so the target is scrolled into view once the card
  // exists. `scroll-margin` in CSS keeps it clear of the sticky header.
  React.useEffect(() => {
    if (!highlightId) return;
    document
      .getElementById(`project-${highlightId}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightId, projects.length]);

  const [syncedFrom, setSyncedFrom] = React.useState(initialProjects);
  if (syncedFrom !== initialProjects) {
    setSyncedFrom(initialProjects);
    setProjects(initialProjects);
  }

  async function detach(projectId: string, taskId: string) {
    setBusyId(projectId);
    try {
      await api.delete(`/api/v1/projects/${projectId}/tasks/${taskId}`);
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? {
                ...p,
                tasks: p.tasks.filter((t) => t.id !== taskId),
                taskCount: Math.max(0, p.taskCount - 1),
              }
            : p,
        ),
      );
      toast.success("Task detached. It is still on your list.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not detach that task.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function completeTask(projectId: string, taskId: string) {
    setBusyId(projectId);
    try {
      await api.patch(`/api/v1/tasks/${taskId}`, { status: "DONE" });
      toast.success("Task done.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not update that task.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(project: ProjectRow, status: string) {
    setBusyId(project.id);
    try {
      await api.patch(`/api/v1/projects/${project.id}`, { status });
      toast.success("Project updated.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not update the project.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function remove(project: ProjectRow) {
    setBusyId(project.id);
    try {
      await api.delete(`/api/v1/projects/${project.id}`);
      toast.success("Project removed.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not remove the project.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {projects.length > 0 ? (
        <div className="flex justify-end">
          <Button variant="lime" size="sm" onClick={() => setCreating(true)}>
            <Plus /> New project
          </Button>
        </div>
      ) : null}

      {projects.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={FolderKanban}
              title="No projects yet"
              description={emptyAction?.description ?? "Group related tasks into something with a name."}
              action={{ label: emptyAction?.label ?? "New project", onClick: () => setCreating(true) }}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {projects.map((project) => {
            const due = dueLabel(project.dueAt);
            const open = expanded === project.id;

            return (
              <Card
                key={project.id}
                id={`project-${project.id}`}
                className={cn(
                  /*
                   * `min-w-0` for the same reason as the goal card: a grid item's
                   * default `min-width: auto` pins it to its content's intrinsic
                   * minimum, and the task rows inside this card carry
                   * `shrink-0` status chips beside truncating titles. That
                   * combination is wider than a phone viewport, so without this
                   * the single-column grid overflows sideways at 375px.
                   */
                  "flex min-w-0 scroll-mt-24 flex-col transition-shadow",
                  highlightId === project.id &&
                    "ring-2 ring-lime/60 ring-offset-2 ring-offset-canvas",
                )}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{project.name}</CardTitle>
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        {project.doneTaskCount}/{project.taskCount} tasks done
                        {due ? ` · due ${due}` : ""}
                      </p>
                    </div>
                    <Badge variant={STATUS_TONE[project.status] ?? "neutral"} size="sm">
                      {project.status.replace("_", " ").toLowerCase()}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="flex flex-1 flex-col gap-4">
                  {project.description ? (
                    <p className="text-sm leading-relaxed text-ink-muted">
                      {project.description}
                    </p>
                  ) : null}

                  <Progress value={project.progressPercent} />

                  {/* The link back up to the goal, plus the focus the project has
                      actually absorbed. Without these a project is an isolated
                      box, and there is no way to tell a project that is quietly
                      absorbing a quarter of the week from one nobody touches. */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {project.goal ? (
                      <Link
                        href={`/goals?goal=${project.goal.id}`}
                        className="rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime/40"
                      >
                        <Badge
                          variant="outline"
                          size="sm"
                          className="gap-1 hover:border-line-strong hover:text-ink"
                        >
                          <Target aria-hidden className="size-2.5" />
                          {project.goal.title}
                        </Badge>
                      </Link>
                    ) : null}
                    {project.focusSeconds ? (
                      <span className="text-[11px] text-ink-subtle">
                        {formatFocusSeconds(project.focusSeconds)} focused
                      </span>
                    ) : null}
                  </div>

                  {project.tasks.length > 0 ? (
                    <ul className="flex flex-col gap-1">
                      {project.tasks.slice(0, 5).map((task) => {
                        const taskDue = dueLabel(task.dueAt);
                        return (
                          <li
                            key={task.id}
                            className="group flex items-center gap-2.5 rounded-control px-1.5 py-1.5 hover:bg-surface-2"
                          >
                            <button
                              type="button"
                              disabled={busyId === project.id}
                              onClick={() => completeTask(project.id, task.id)}
                              aria-label={`Mark ${task.title} done`}
                              className="grid size-4 shrink-0 place-items-center rounded-[5px] border border-line-strong transition-colors hover:border-lime"
                            >
                              <Check className="size-3 text-lime opacity-0 group-hover:opacity-100" strokeWidth={3} />
                            </button>
                            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                              {task.title}
                            </span>
                            {taskDue ? (
                              <span
                                className={cn(
                                  "shrink-0 text-[11px]",
                                  taskDue.includes("overdue") ? "text-negative" : "text-ink-subtle",
                                )}
                              >
                                {taskDue}
                              </span>
                            ) : null}
                            <button
                              type="button"
                              disabled={busyId === project.id}
                              onClick={() => detach(project.id, task.id)}
                              aria-label={`Detach ${task.title} from this project`}
                              className="shrink-0 text-ink-subtle opacity-0 transition-opacity hover:text-negative group-hover:opacity-100"
                            >
                              <Unlink className="size-3.5" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-[13px] text-ink-subtle">
                      No open tasks. Link some from the task screen.
                    </p>
                  )}

                  {project.tasks.length > 5 || project.milestones.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : project.id)}
                      className="self-start text-xs text-lime transition-opacity hover:opacity-80"
                    >
                      {open ? "Show less" : `More detail (${project.tasks.length} open, ${project.milestones.length} milestones)`}
                    </button>
                  ) : null}

                  {open ? (
                    <div className="flex flex-col gap-3 border-t border-line pt-3">
                      {project.tasks.length > 5 ? (
                        <div className="flex flex-col gap-1">
                          {project.tasks.slice(5).map((task) => (
                            <div key={task.id} className="flex items-center gap-2 px-1.5">
                              <span className="min-w-0 flex-1 truncate text-[13px] text-ink-muted">
                                {task.title}
                              </span>
                              <button
                                type="button"
                                disabled={busyId === project.id}
                                onClick={() => detach(project.id, task.id)}
                                className="text-ink-subtle hover:text-negative"
                                aria-label={`Detach ${task.title}`}
                              >
                                <Unlink className="size-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {project.milestones.length > 0 ? (
                        <div className="flex flex-col gap-1.5">
                          <p className="text-[13px] font-medium text-ink-muted">Milestones</p>
                          {project.milestones.map((m) => (
                            <div key={m.id} className="flex items-center gap-2.5 px-1.5">
                              <span
                                className={cn(
                                  "grid size-4 shrink-0 place-items-center rounded-[5px] border",
                                  m.status === "DONE"
                                    ? "border-lime bg-lime text-ink-inverse"
                                    : "border-line-strong",
                                )}
                              >
                                {m.status === "DONE" ? (
                                  <Check className="size-3" strokeWidth={3} />
                                ) : null}
                              </span>
                              <span
                                className={cn(
                                  "flex-1 truncate text-[13px]",
                                  m.status === "DONE" ? "text-ink-subtle line-through" : "text-ink",
                                )}
                              >
                                {m.title}
                              </span>
                                {m.dueAt ? (
                                  <span className="text-[11px] text-ink-subtle">
                                    {formatLocalDayMonth(new Date(m.dueAt))}
                                  </span>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-3">
                    {project.status === "ACTIVE" ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={busyId === project.id}
                        onClick={() => setStatus(project, "ON_HOLD")}
                      >
                        Put on hold
                      </Button>
                    ) : project.status !== "COMPLETED" ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={busyId === project.id}
                        onClick={() => setStatus(project, "ACTIVE")}
                      >
                        Make active
                      </Button>
                    ) : null}
                    {project.status !== "COMPLETED" ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={busyId === project.id}
                        onClick={() => setStatus(project, "COMPLETED")}
                      >
                        <Check /> Complete
                      </Button>
                    ) : null}
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busyId === project.id}
                      onClick={() => remove(project)}
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

      <ProjectForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          router.refresh();
        }}
      />
    </div>
  );
}

function ProjectForm({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [dueAt, setDueAt] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // Clear on close so reopening never shows the previous project's values.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setName("");
      setDescription("");
      setDueAt("");
      setErrors({});
    }
  }

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      await api.post("/api/v1/projects", {
        name,
        description: description.trim() || null,
        status: "PLANNING",
        dueAt: dueAt ? new Date(`${dueAt}T12:00:00`) : null,
      });
      toast.success("Project created.");
      onSaved();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrors(
          Object.keys(error.fieldErrors).length > 0
            ? error.fieldErrors
            : { name: error.message },
        );
      } else {
        setErrors({ name: "Could not create the project." });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Give it a name and a due date if it has one. Tasks can be linked after.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field label="Name" error={errors.name}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Website relaunch"
              maxLength={200}
              disabled={busy}
            />
          </Field>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-muted">Description</span>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              disabled={busy}
            />
          </label>

          <Field label="Due date" error={errors.dueAt} hint="Optional.">
            <Input
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              disabled={busy}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="lime"
            onClick={submit}
            loading={busy}
            loadingText="Creating"
            disabled={!name.trim()}
          >
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
