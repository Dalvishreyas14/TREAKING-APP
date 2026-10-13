"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlarmClock,
  Check,
  ChevronDown,
  Clock,
  ListTodo,
  Pause,
  Play,
  Plus,
  Square,
  Trash2,
  X,
} from "lucide-react";

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
import { formatIndianLong } from "@/lib/format/date";
import { cn } from "@/lib/utils";

import { RoutineSuggestions } from "./routine-suggestions";

/**
 * Routines.
 *
 * The run flow is: start a run (which snapshots how many steps the routine has
 * *right now*, and turns the steps that produce work into tasks), tick steps
 * locally, then close the run. The run itself is written once, on close.
 *
 * That is deliberate on two counts. Ticking a step is a physical action taken
 * dozens of times per routine, and a network round trip per tap would make the
 * morning routine feel worse than not having one. And closing a run once means a
 * single record of "I did 4 of 5", which is the only figure the history actually
 * needs.
 *
 * Two things do write during a run, and both are consequences of the run's final
 * write rather than separate edits:
 *
 *  - Tasks. A step that produces work owns one long-lived task, and starting a
 *    run opens it. Ticking the step on the way out closes it, in the same
 *    transaction that records the run — so a run can never say it covered work
 *    that is still sitting open on the planner.
 *  - Habit logs, for steps linked to a habit, written *after* the run is safely
 *    closed. The run is the user's own record and should never be lost because a
 *    habit log failed.
 */

export interface RoutineStep {
  id: string;
  title: string;
  estimatedMinutes: number | null;
  habitId: string | null;
  habitName: string | null;
  /** Whether running this step produces a task. */
  createsTask: boolean;
}

export interface RoutineRow {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  timeOfDay: number | null;
  timeLabel: string | null;
  color: string;
  isActive: boolean;
  estimatedMinutes: number;
  items: RoutineStep[];
  runCount: number;
  completedRunCount: number;
  completionRate: number | null;
  openRunCount: number;
  lastRunAt: string | null;
  /** What the routine's own history says about it. Empty until there is enough. */
  suggestions: RoutineSuggestionView[];
}

/** Serialised `RoutineSuggestion` from `@/lib/routines/suggestions`. */
export interface RoutineSuggestionView {
  id: string;
  tone: "praise" | "warn" | "info";
  title: string;
  body: string;
  evidence: Record<string, unknown>;
  confidence: number;
}

const KIND_LABEL: Record<string, string> = {
  MORNING: "Morning",
  STUDY: "Study",
  WORKOUT: "Workout",
  EVENING: "Evening",
  NIGHT: "Night",
  WORK: "Work",
  COLLEGE: "College",
  CUSTOM: "Custom",
};

interface ActiveRun {
  routineId: string;
  runId: string;
  /** Step ids ticked during this run. */
  ticked: string[];
  totalItems: number;
}

export function RoutineList({
  routines: initialRoutines,
  habits,
  categories,
  emptyHint,
}: {
  routines: RoutineRow[];
  habits: { id: string; name: string }[];
  categories: { id: string; name: string; kind: string }[];
  emptyHint: string;
}) {
  const router = useRouter();
  const [routines, setRoutines] = React.useState(initialRoutines);
  const [run, setRun] = React.useState<ActiveRun | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [addingItemFor, setAddingItemFor] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  const [syncedFrom, setSyncedFrom] = React.useState(initialRoutines);
  if (syncedFrom !== initialRoutines) {
    setSyncedFrom(initialRoutines);
    setRoutines(initialRoutines);
  }

  const todayLabel = formatIndianLong(new Date());

  async function start(routine: RoutineRow) {
    setBusyId(routine.id);
    try {
      const created = await api.post<{
        id: string;
        totalItems: number;
        tasks: { created: number; reopened: number; kept: number; skipped: number };
      }>(`/api/v1/routines/${routine.id}/runs`);
      setRun({ routineId: routine.id, runId: created.id, ticked: [], totalItems: created.totalItems });
      setExpanded(routine.id);

      // Say what landed on the planner, because the routine was the thing the user
      // was looking at and tasks appearing elsewhere without explanation is how a
      // feature starts to feel like the app did something behind their back.
      const { created: made, reopened } = created.tasks;
      const taskNote = [
        made > 0 ? `${made} new ${made === 1 ? "task" : "tasks"}` : null,
        reopened > 0 ? `${reopened} reopened` : null,
      ]
        .filter(Boolean)
        .join(", ");
      toast.success(`${routine.name} started.`, taskNote ? { description: `${taskNote} on your list.` } : undefined);
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not start that routine.",
      );
    } finally {
      setBusyId(null);
    }
  }

  function tick(step: RoutineStep) {
    if (!run) return;
    setRun((current) =>
      current
        ? {
            ...current,
            ticked: current.ticked.includes(step.id)
              ? current.ticked.filter((id) => id !== step.id)
              : [...current.ticked, step.id],
          }
        : current,
    );
  }

  async function closeRun(abandoned: boolean) {
    if (!run) return;
    const routine = routines.find((r) => r.id === run.routineId);
    const completedItems = run.ticked.length;
    setBusyId(run.routineId);
    try {
      // The ticked step ids go up alongside the count: the count is what the
      // history reads, the ids are what finish the tasks those steps own.
      const closed = await api.patch<{ completedTasks: number }>(
        `/api/v1/routines/${run.routineId}/runs/${run.runId}`,
        { completedItems, abandoned, completedItemIds: run.ticked },
      );
      setRun(null);
      setBusyId(null);

      if (abandoned) {
        toast.message("Run recorded as unfinished.", {
          description: `${completedItems} of ${run.totalItems} steps.`,
        });
      } else if (completedItems >= run.totalItems) {
        toast.success(`${routine?.name ?? "Routine"} complete.`);
      } else {
        toast.message(`Recorded ${completedItems} of ${run.totalItems} steps.`);
      }
      if (closed.completedTasks > 0 && !abandoned) {
        toast.message(
          `${closed.completedTasks} ${closed.completedTasks === 1 ? "task" : "tasks"} done.`,
        );
      }
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not save that run.",
      );
      setBusyId(null);
      return;
    }

    // The run is safely recorded. Habit logging happens after, and a failure here
    // costs a habit log, not the run.
    const linked = (routine?.items ?? []).filter((i) => run.ticked.includes(i.id) && i.habitId);
    const failures: string[] = [];
    for (const step of linked) {
      try {
        await api.post(`/api/v1/habits/${step.habitId}/log`, { value: 1 });
      } catch {
        failures.push(step.habitName ?? step.title);
      }
    }

    if (failures.length > 0) {
      toast.error(`Could not log ${failures.join(", ")}.`);
    }

    router.refresh();
  }

  async function togglePause(routine: RoutineRow) {
    setBusyId(routine.id);
    try {
      await api.patch(`/api/v1/routines/${routine.id}`, { isActive: !routine.isActive });
      toast.success(routine.isActive ? "Routine paused." : "Routine resumed.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not update that routine.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function remove(routine: RoutineRow) {
    setBusyId(routine.id);
    try {
      await api.delete(`/api/v1/routines/${routine.id}`);
      toast.success("Routine deleted, along with its run history.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not delete that routine.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function removeStep(routine: RoutineRow, step: RoutineStep) {
    setBusyId(routine.id);
    try {
      await api.delete(`/api/v1/routines/${routine.id}/items/${step.id}`);
      toast.success("Step removed.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not remove that step.",
      );
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Turn a step's task production on or off.
   *
   * Optimistic, because the alternative is a full round trip plus `router.refresh`
   * for a checkbox. Reverted on failure, and the failure is surfaced rather than
   * swallowed — a toggle that silently snaps back reads as the app being broken
   * rather than the request failing.
   */
  async function toggleStepTask(routine: RoutineRow, step: RoutineStep) {
    const next = !step.createsTask;
    setRoutines((current) =>
      current.map((r) =>
        r.id === routine.id
          ? { ...r, items: r.items.map((i) => (i.id === step.id ? { ...i, createsTask: next } : i)) }
          : r,
      ),
    );
    try {
      await api.patch(`/api/v1/routines/${routine.id}/items/${step.id}`, { createsTask: next });
      toast.message(next ? `"${step.title}" will add a task.` : `"${step.title}" stays off your list.`);
    } catch (error) {
      setRoutines((current) =>
        current.map((r) =>
          r.id === routine.id
            ? { ...r, items: r.items.map((i) => (i.id === step.id ? { ...i, createsTask: !next } : i)) }
            : r,
        ),
      );
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not change that step.",
      );
    }
  }

  const runningRoutine = routines.find((r) => r.id === run?.routineId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-ink-subtle">{todayLabel}</p>
        {routines.length > 0 ? (
          <Button size="sm" variant="lime" onClick={() => setCreating(true)}>
            <Plus /> New routine
          </Button>
        ) : null}
      </div>

      {run && runningRoutine ? (
        <Card tone="sunken">
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-ink">
                  {runningRoutine.name} in progress
                </p>
                <p className="text-[12px] text-ink-subtle">
                  {run.ticked.length} of {run.totalItems} steps ticked
                  {run.totalItems === 0 ? " — this routine has no steps yet" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busyId === runningRoutine.id}
                  onClick={() => void closeRun(true)}
                >
                  <Square /> Abandon
                </Button>
                <Button
                  size="xs"
                  variant="lime"
                  loading={busyId === runningRoutine.id}
                  loadingText="Saving"
                  onClick={() => void closeRun(false)}
                >
                  <Check /> Finish
                </Button>
              </div>
            </div>
            <Progress
              value={run.totalItems ? Math.round((run.ticked.length / run.totalItems) * 100) : 0}
            />
          </CardContent>
        </Card>
      ) : null}

      {routines.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={ListTodo}
              title="No routines yet"
              description={emptyHint}
              action={{ label: "Create a routine", onClick: () => setCreating(true) }}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {routines.map((routine) => {
            const open = expanded === routine.id;
            const active = run?.routineId === routine.id;
            const ticked = new Set(run?.ticked ?? []);

            return (
              <Card key={routine.id} className={cn("flex flex-col", !routine.isActive && "opacity-70")}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{routine.name}</CardTitle>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-subtle">
                        <span>{KIND_LABEL[routine.kind] ?? routine.kind}</span>
                        {routine.timeLabel ? (
                          <span className="flex items-center gap-1">
                            <AlarmClock className="size-3" />
                            {routine.timeLabel}
                          </span>
                        ) : null}
                        {routine.estimatedMinutes > 0 ? (
                          <span className="flex items-center gap-1">
                            <Clock className="size-3" />
                            ~{routine.estimatedMinutes} min
                          </span>
                        ) : null}
                      </p>
                    </div>
                    {!routine.isActive ? (
                      <Badge variant="outline" size="sm">
                        Paused
                      </Badge>
                    ) : routine.completionRate !== null ? (
                      <Badge variant="lime" size="sm">
                        {routine.completionRate}%
                      </Badge>
                    ) : null}
                  </div>
                </CardHeader>

                <CardContent className="flex flex-1 flex-col gap-3">
                  {routine.description ? (
                    <p className="text-[13px] leading-relaxed text-ink-muted">
                      {routine.description}
                    </p>
                  ) : null}

                  <div className="flex items-center gap-2">
                    {active ? (
                      <span className="text-[12px] text-lime">Running now — tick the steps below</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="lime"
                        disabled={!routine.isActive || busyId === routine.id || run !== null}
                        loading={busyId === routine.id}
                        loadingText="Starting"
                        onClick={() => void start(routine)}
                      >
                        <Play /> Start
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setExpanded(open ? null : routine.id)}
                    >
                      {routine.items.length} steps
                      <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
                    </Button>
                  </div>

                  {open ? (
                    <div className="flex flex-col gap-1 border-t border-line pt-3">
                      {routine.items.length === 0 ? (
                        <p className="text-[12px] text-ink-subtle">
                          No steps yet. Add one below.
                        </p>
                      ) : (
                        routine.items.map((step) => {
                          const isTicked = ticked.has(step.id);
                          return (
                            <div
                              key={step.id}
                              className="group flex items-center gap-2.5 rounded-control px-1.5 py-1.5 hover:bg-surface-2"
                            >
                              <button
                                type="button"
                                disabled={!active}
                                onClick={() => tick(step)}
                                aria-label={`${isTicked ? "Untick" : "Tick"} ${step.title}`}
                                className={cn(
                                  "grid size-[18px] shrink-0 place-items-center rounded-[6px] border transition-colors",
                                  isTicked
                                    ? "border-lime bg-lime text-ink-inverse"
                                    : "border-line-strong",
                                  active ? "hover:border-lime" : "cursor-not-allowed opacity-60",
                                )}
                              >
                                {isTicked ? <Check className="size-3" strokeWidth={3.5} /> : null}
                              </button>
                              <span
                                className={cn(
                                  "min-w-0 flex-1 truncate text-[13px]",
                                  isTicked ? "text-ink-subtle line-through" : "text-ink",
                                )}
                              >
                                {step.title}
                              </span>
                              {step.habitName ? (
                                <Badge variant="outline" size="sm">
                                  logs {step.habitName}
                                </Badge>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => void toggleStepTask(routine, step)}
                                aria-pressed={step.createsTask}
                                title={
                                  step.createsTask
                                    ? "Adds a task when this routine runs"
                                    : "This step will not add a task"
                                }
                                className={cn(
                                  "shrink-0 rounded-control px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                                  step.createsTask
                                    ? "text-lime hover:bg-lime/10"
                                    : "text-ink-subtle opacity-40 hover:opacity-100",
                                )}
                              >
                                {step.createsTask ? "+ task" : "no task"}
                              </button>
                              {step.estimatedMinutes ? (
                                <span className="shrink-0 text-[11px] tabular-nums text-ink-subtle">
                                  {step.estimatedMinutes}m
                                </span>
                              ) : null}
                              <button
                                type="button"
                                disabled={busyId === routine.id}
                                onClick={() => void removeStep(routine, step)}
                                aria-label={`Remove ${step.title}`}
                                className="shrink-0 text-ink-subtle opacity-0 transition-opacity hover:text-negative group-hover:opacity-100"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          );
                        })
                      )}

                      <Button
                        size="xs"
                        variant="ghost"
                        className="self-start"
                        onClick={() => setAddingItemFor(routine.id)}
                      >
                        <Plus /> Add step
                      </Button>
                    </div>
                  ) : null}

                  <RoutineSuggestions
                    suggestions={routine.suggestions}
                    runCount={routine.runCount}
                  />

                  <div className="mt-auto flex items-center gap-2 border-t border-line pt-3 text-[11px] text-ink-subtle">
                    <span>
                      {routine.completedRunCount}/{routine.runCount} runs finished
                    </span>
                    {routine.openRunCount > 0 ? (
                      <span>· {routine.openRunCount} still open</span>
                    ) : null}
                    <span className="flex-1" />
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busyId === routine.id}
                      onClick={() => void togglePause(routine)}
                    >
                      {routine.isActive ? <Pause /> : <Play />}
                      {routine.isActive ? "Pause" : "Resume"}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busyId === routine.id}
                      onClick={() => void remove(routine)}
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

      <RoutineForm
        open={creating}
        habits={habits}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          router.refresh();
        }}
      />

      <StepForm
        routineId={addingItemFor}
        habits={habits}
        categories={categories}
        onClose={() => setAddingItemFor(null)}
        onSaved={() => {
          setAddingItemFor(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function RoutineForm({
  open,
  habits,
  onClose,
  onSaved,
}: {
  open: boolean;
  habits: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [kind, setKind] = React.useState("CUSTOM");
  const [time, setTime] = React.useState("");
  const [steps, setSteps] = React.useState<string[]>([""]);
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const [wasOpen, setWasOpen] = React.useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setName("");
      setDescription("");
      setKind("CUSTOM");
      setTime("");
      setSteps([""]);
      setErrors({});
    }
  }

  function addStep() {
    setSteps((prev) => [...prev, ""]);
  }

  function setStep(index: number, value: string) {
    setSteps((prev) => prev.map((s, i) => (i === index ? value : s)));
  }

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      // Blank rows are dropped rather than sent: `routineItemCreateSchema` rejects
      // an empty title, so an untouched second row would fail the whole create.
      const items = steps
        .map((title) => title.trim())
        .filter(Boolean)
        .map((title) => ({ title }));

      await api.post("/api/v1/routines", {
        name,
        description: description.trim() || null,
        kind,
        timeOfDay: time ? minutesFromTimeInput(time) : null,
        items,
      });
      toast.success("Routine created.");
      onSaved();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrors(
          Object.keys(error.fieldErrors).length > 0 ? error.fieldErrors : { name: error.message },
        );
      } else {
        setErrors({ name: "Could not create that routine." });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New routine</DialogTitle>
          <DialogDescription>
            Give it a shape now. Steps can be added, reordered or removed later without
            changing your history.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field label="Name" error={errors.name}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Morning routine"
              maxLength={200}
              disabled={busy}
            />
          </Field>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-muted">Description</span>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              disabled={busy}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kind" error={errors.kind}>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                disabled={busy}
                className="h-9 rounded-control border border-line bg-surface px-2.5 text-[13px] text-ink"
              >
                {Object.entries(KIND_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Usual time"
              error={errors.timeOfDay}
              hint="Stored as minutes from your midnight, so it never shifts with timezone."
            >
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={busy} />
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium text-ink-muted">Steps</span>
            {steps.map((step, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="w-4 shrink-0 text-center text-[11px] tabular-nums text-ink-subtle">
                  {index + 1}
                </span>
                <Input
                  value={step}
                  onChange={(e) => setStep(index, e.target.value)}
                  placeholder="Make the bed"
                  maxLength={200}
                  disabled={busy}
                />
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy || steps.length === 1}
                  onClick={() => setSteps((prev) => prev.filter((_, i) => i !== index))}
                  aria-label={`Remove step ${index + 1}`}
                >
                  <X />
                </Button>
              </div>
            ))}
            <Button size="xs" variant="ghost" className="self-start" onClick={addStep} disabled={busy}>
              <Plus /> Another step
            </Button>
            {errors.items ? <p className="text-[12px] text-negative">{errors.items}</p> : null}
          </div>

          {habits.length > 0 ? (
            <p className="text-[11px] leading-relaxed text-ink-subtle">
              Steps can be linked to a habit once created — ticking such a step logs
              that habit for you.
            </p>
          ) : null}
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
            Create routine
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function minutesFromTimeInput(value: string): number | null {
  const [h, m] = value.split(":").map((v) => Number.parseInt(v, 10));
  if (h === undefined || m === undefined) return null;
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function StepForm({
  routineId,
  habits,
  categories,
  onClose,
  onSaved,
}: {
  routineId: string | null;
  habits: { id: string; name: string }[];
  categories: { id: string; name: string; kind: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = React.useState("");
  const [minutes, setMinutes] = React.useState("");
  const [habitId, setHabitId] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [createsTask, setCreatesTask] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [wasOpen, setWasOpen] = React.useState(routineId !== null);
  if (wasOpen !== (routineId !== null)) {
    setWasOpen(routineId !== null);
    if (routineId) {
      setTitle("");
      setMinutes("");
      setHabitId("");
      setCategoryId("");
      setCreatesTask(true);
      setError(null);
    }
  }

  async function submit() {
    if (!routineId) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/v1/routines/${routineId}/items`, {
        title,
        estimatedMinutes: minutes ? Number(minutes) : null,
        habitId: habitId || null,
        categoryId: categoryId || null,
        createsTask,
      });
      toast.success("Step added.");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not add that step.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={routineId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a step</DialogTitle>
          <DialogDescription>
            Running this step puts it on your task list. Turn that off for the
            steps that are ritual rather than work. Optional links: log a habit
            when the step is ticked, and file it under a category.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field label="Step" error={error ?? undefined}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Drink a glass of water"
              maxLength={200}
              disabled={busy}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Estimate (minutes)" error={undefined}>
              <Input
                type="number"
                min={1}
                max={600}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                placeholder="5"
                disabled={busy}
              />
            </Field>

            <Field label="Log a habit" error={undefined}>
              <select
                value={habitId}
                onChange={(e) => setHabitId(e.target.value)}
                disabled={busy}
                className="h-9 rounded-control border border-line bg-surface px-2.5 text-[13px] text-ink"
              >
                <option value="">Nothing</option>
                {habits.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Category" error={undefined}>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              disabled={busy}
              className="h-9 rounded-control border border-line bg-surface px-2.5 text-[13px] text-ink"
            >
              <option value="">None</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-control border border-line bg-surface-2 px-3 py-2.5">
            <input
              type="checkbox"
              checked={createsTask}
              onChange={(e) => setCreatesTask(e.target.checked)}
              disabled={busy}
              className="mt-0.5 size-3.5 shrink-0 accent-lime"
            />
            <span className="min-w-0">
              <span className="block text-[13px] text-ink">Add this step to my tasks</span>
              <span className="block text-[11px] leading-relaxed text-ink-subtle">
                It gets one task that opens when the routine starts and closes when
                you tick the step. Leave it off for things like{" "}
                <em>make the bed</em> that you would not want on a list.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="lime"
            onClick={submit}
            loading={busy}
            loadingText="Adding"
            disabled={!title.trim()}
          >
            Add step
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
