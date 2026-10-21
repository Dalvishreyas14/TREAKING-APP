"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Save,
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
import {
  type ExerciseOption,
  type WorkoutView,
  WorkoutStatusBadge,
} from "@/components/app/fitness/workout-board";
import { api, ApiClientError } from "@/lib/api/client";
import { MUSCLE_GROUP_PRESETS, WEEKDAYS, weekdayShort } from "@/lib/fitness/presets";
import { formatLocalClockTime } from "@/lib/format/date";
import { cn } from "@/lib/utils";

/**
 * The weekly workout planner.
 *
 * Seven days, Monday first, each showing the concrete sessions scheduled for it
 * and — when an active routine declares one — a rest day. Every action here is
 * real: starting, completing, skipping, moving, editing and deleting a session
 * all hit the API; routines are saved, activated and applied the same way.
 *
 * The distinction the whole screen is built around is template vs. record. A
 * routine is a template; a `Workout` row is what actually happens on a day. The
 * calendar only ever edits the concrete rows, and the routine card is the only
 * place the template is touched, which is why "edit routine" and "apply" are two
 * steps rather than one hidden side effect.
 */

export interface RoutineSetView {
  id: string;
  reps: number | null;
  weight: number | null;
  durationSeconds: number | null;
  restSeconds: number | null;
}

export interface RoutineExerciseView {
  id: string;
  exerciseId: string | null;
  name: string;
  restSeconds: number | null;
  sets: RoutineSetView[];
}

export interface RoutineDayView {
  id: string;
  weekday: number;
  name: string;
  muscleGroups: string[];
  isRest: boolean;
  targetMinutes: number | null;
  startMinutes: number | null;
  notes: string | null;
  exercises: RoutineExerciseView[];
}

export interface RoutineView {
  id: string;
  name: string;
  description: string | null;
  color: string;
  isActive: boolean;
  generatedThrough: string | null;
  days: RoutineDayView[];
}

export interface ScheduleDayView {
  date: string;
  weekday: number;
  isRest: boolean;
  restLabel: string | null;
  workouts: WorkoutView[];
}

// --------------------------------------------------------------- helpers

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Minutes from midnight -> `HH:MM` for a time input. */
function minutesToTime(minutes: number | null): string {
  if (minutes === null) return "";
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** `HH:MM` -> minutes from midnight, or null when blank. */
function timeToMinutes(value: string): number | null {
  if (!value) return null;
  const [h, m] = value.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** Local wall-clock minutes for a stored instant, or null. */
function localStartMinutes(iso: string | null): number | null {
  if (!iso) return null;
  const date = new Date(iso);
  return date.getHours() * 60 + date.getMinutes();
}

/** `2026-10-16` -> `16 Oct`, from the UTC fields with an explicit locale. */
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function numberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** `yyyy-MM-dd` shifted by whole days, pure (no clock read). */
function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return next.toISOString().slice(0, 10);
}

/** The Monday of the ISO week containing `iso`, matching the planner's weeks. */
function mondayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return shiftIso(iso, -((jsDay + 6) % 7));
}

// ------------------------------------------------------------------ main

export function WeeklyPlan({
  weekStart,
  days,
  routines,
  today,
  exercises,
}: {
  weekStart: string;
  days: ScheduleDayView[];
  routines: RoutineView[];
  today: string;
  exercises: ExerciseOption[];
}) {
  const router = useRouter();
  const activeRoutine = routines.find((r) => r.isActive) ?? null;

  const [dialog, setDialog] = React.useState<
    | { mode: "create"; date: string }
    | { mode: "edit"; workout: WorkoutView }
    | { mode: "reschedule"; workout: WorkoutView }
    | { mode: "routine"; routine: RoutineView | null }
    | { mode: "save-week" }
    | null
  >(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const weekEnd = shiftIso(weekStart, 6);
  const plannedCount = days.reduce(
    (n, day) => n + day.workouts.filter((w) => w.status === "PLANNED").length,
    0,
  );
  const doneCount = days.reduce(
    (n, day) => n + day.workouts.filter((w) => w.status === "COMPLETED").length,
    0,
  );

  function goToWeek(iso: string) {
    router.push(`/fitness?week=${iso}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-[-0.01em]">
            <CalendarDays className="size-4 text-lime" />
            Weekly plan
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {doneCount} completed · {plannedCount} planned this week
            {activeRoutine ? ` · ${activeRoutine.name} is driving the schedule` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-control border border-line p-0.5">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Previous week"
              onClick={() => goToWeek(shiftIso(weekStart, -7))}
            >
              <ChevronLeft />
            </Button>
            <span className="px-2 text-[12px] tabular-nums text-ink-muted">
              {dayLabel(weekStart)} – {dayLabel(weekEnd)}
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Next week"
              onClick={() => goToWeek(shiftIso(weekStart, 7))}
            >
              <ChevronRight />
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => goToWeek(mondayOf(today))}
            disabled={weekStart === mondayOf(today)}
          >
            This week
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDialog({ mode: "save-week" })}>
            <Save /> Save as routine
          </Button>
          <Button size="sm" variant="lime" onClick={() => setDialog({ mode: "routine", routine: null })}>
            <Plus /> New routine
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {days.map((day) => (
          <DayColumn
            key={day.date}
            day={day}
            today={today}
            busyId={busyId}
            onAdd={() => setDialog({ mode: "create", date: day.date })}
            onEdit={(workout) => setDialog({ mode: "edit", workout })}
            onReschedule={(workout) => setDialog({ mode: "reschedule", workout })}
            onAction={runAction}
          />
        ))}
      </div>

      <RoutinesCard
        routines={routines}
        onEdit={(routine) => setDialog({ mode: "routine", routine })}
        onChanged={() => router.refresh()}
      />

      {dialog?.mode === "create" || dialog?.mode === "edit" ? (
        <ScheduledWorkoutDialog
          date={dialog.mode === "create" ? dialog.date : dialog.workout.date}
          initial={dialog.mode === "edit" ? dialog.workout : undefined}
          exercises={exercises}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      ) : null}

      {dialog?.mode === "reschedule" ? (
        <RescheduleDialog
          workout={dialog.workout}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      ) : null}

      {dialog?.mode === "routine" ? (
        <RoutineDialog
          initial={dialog.routine}
          exerciseOptions={exercises}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      ) : null}

      {dialog?.mode === "save-week" ? (
        <SaveWeekDialog
          weekStart={weekStart}
          suggestedName={`Week of ${dayLabel(weekStart)}`}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );

  async function runAction(workout: WorkoutView, action: "start" | "complete" | "skip" | "delete") {
    if (action === "delete" && !window.confirm(`Delete “${workout.name}”? This cannot be undone.`)) {
      return;
    }
    setBusyId(workout.id);
    try {
      if (action === "delete") {
        await api.delete(`/api/v1/workouts/${workout.id}`);
        toast.success("Session deleted.");
      } else {
        const status =
          action === "start" ? "IN_PROGRESS" : action === "complete" ? "COMPLETED" : "SKIPPED";
        await api.patch(`/api/v1/workouts/${workout.id}`, { status });
        toast.success(
          action === "start" ? "Started." : action === "complete" ? "Nice — completed." : "Marked skipped.",
        );
      }
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not update that session.");
    } finally {
      setBusyId(null);
    }
  }
}

// ------------------------------------------------------------- day column

function DayColumn({
  day,
  today,
  busyId,
  onAdd,
  onEdit,
  onReschedule,
  onAction,
}: {
  day: ScheduleDayView;
  today: string;
  busyId: string | null;
  onAdd: () => void;
  onEdit: (workout: WorkoutView) => void;
  onReschedule: (workout: WorkoutView) => void;
  onAction: (workout: WorkoutView, action: "start" | "complete" | "skip" | "delete") => void;
}) {
  const isToday = day.date === today;
  return (
    <Card
      tone={isToday ? "raised" : "default"}
      className={cn("flex flex-col", isToday && "ring-1 ring-lime/40")}
    >
      <CardHeader className="flex-row items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
            {weekdayShort(day.weekday)}
          </p>
          <p className="text-[13px] font-medium text-ink">{dayLabel(day.date)}</p>
        </div>
        {isToday ? (
          <Badge variant="lime" size="sm">
            Today
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2 p-3 pt-0">
        {day.workouts.length === 0 ? (
          day.isRest ? (
            <p className="rounded-control bg-surface-2 px-2.5 py-3 text-center text-[12px] text-ink-subtle">
              {day.restLabel ?? "Rest day"}
            </p>
          ) : (
            <p className="rounded-control border border-dashed border-line px-2.5 py-3 text-center text-[12px] text-ink-subtle">
              Nothing scheduled
            </p>
          )
        ) : (
          <ul className="flex flex-col gap-2">
            {day.workouts.map((workout) => (
              <SessionCard
                key={workout.id}
                workout={workout}
                busy={busyId === workout.id}
                onEdit={() => onEdit(workout)}
                onReschedule={() => onReschedule(workout)}
                onAction={onAction}
              />
            ))}
          </ul>
        )}

        <Button size="xs" variant="ghost" className="mt-auto self-start" onClick={onAdd}>
          <Plus /> Add
        </Button>
      </CardContent>
    </Card>
  );
}

function SessionCard({
  workout,
  busy,
  onEdit,
  onReschedule,
  onAction,
}: {
  workout: WorkoutView;
  busy: boolean;
  onEdit: () => void;
  onReschedule: () => void;
  onAction: (workout: WorkoutView, action: "start" | "complete" | "skip" | "delete") => void;
}) {
  const [open, setOpen] = React.useState(false);
  const canAct = workout.status === "PLANNED" || workout.status === "IN_PROGRESS";
  const minutes = workout.exercises.reduce((n, e) => n + e.sets.length, 0);

  return (
    <li className="rounded-control border border-line bg-surface p-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-[13px] font-semibold text-ink">{workout.name}</p>
        <button
          type="button"
          aria-label="Session options"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 rounded p-0.5 text-ink-subtle hover:text-ink"
        >
          <Pencil className="size-3.5" />
        </button>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-1">
        <WorkoutStatusBadge status={workout.status} />
        {workout.startAt ? (
          <span className="text-[11px] tabular-nums text-ink-subtle">
            {formatLocalClockTime(new Date(workout.startAt))}
          </span>
        ) : null}
        {workout.minutes ? (
          <span className="text-[11px] text-ink-subtle">{workout.minutes} min</span>
        ) : null}
      </div>

      {workout.muscleGroups.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {workout.muscleGroups.map((group) => (
            <span
              key={group}
              className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-ink-muted"
            >
              {group}
            </span>
          ))}
        </div>
      ) : null}

      {workout.exercises.length ? (
        <p className="mt-1 text-[10px] text-ink-subtle">
          {workout.exercises.length} exercise{workout.exercises.length === 1 ? "" : "s"} · {minutes} set
          {minutes === 1 ? "" : "s"}
        </p>
      ) : null}

      {workout.rescheduledFromDate ? (
        <p className="mt-1 text-[10px] text-amber">
          Moved from {dayLabel(workout.rescheduledFromDate)}
        </p>
      ) : null}

      {open ? (
        <div className="mt-2 flex flex-wrap gap-1 border-t border-line pt-2">
          {canAct ? (
            <>
              {workout.status === "PLANNED" ? (
                <Button size="xs" variant="secondary" onClick={() => onAction(workout, "start")} disabled={busy}>
                  <Play /> Start
                </Button>
              ) : null}
              <Button size="xs" variant="lime" onClick={() => onAction(workout, "complete")} disabled={busy}>
                <Check /> Complete
              </Button>
              <Button size="xs" variant="ghost" onClick={() => onAction(workout, "skip")} disabled={busy}>
                Skip
              </Button>
            </>
          ) : null}
          <Button size="xs" variant="ghost" onClick={onEdit} disabled={busy}>
            Edit
          </Button>
          {canAct ? (
            <Button size="xs" variant="ghost" onClick={onReschedule} disabled={busy}>
              Move
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="ghost"
            className="text-coral"
            onClick={() => onAction(workout, "delete")}
            disabled={busy}
          >
            <Trash2 /> Delete
          </Button>
        </div>
      ) : null}
    </li>
  );
}

// -------------------------------------------------------------- routines

function RoutinesCard({
  routines,
  onEdit,
  onChanged,
}: {
  routines: RoutineView[];
  onEdit: (routine: RoutineView) => void;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = React.useState<string | null>(null);

  async function run(id: string, fn: () => Promise<unknown>, message: string) {
    setBusyId(id);
    try {
      await fn();
      toast.success(message);
      onChanged();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not update that routine.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <Repeat className="size-4 text-iris" /> Recurring routines
        </CardTitle>
      </CardHeader>
      <CardContent>
        {routines.length === 0 ? (
          <EmptyState
            icon={Repeat}
            size="sm"
            title="No routines yet"
            description="Save a week you like as a routine, and it can fill future weeks for you."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {routines.map((routine) => {
              const trainingDays = routine.days.filter((d) => !d.isRest);
              return (
                <li key={routine.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-ink">{routine.name}</span>
                      {routine.isActive ? (
                        <Badge variant="lime" size="sm">
                          Active
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-[11px] text-ink-subtle">
                      {trainingDays.length} training day{trainingDays.length === 1 ? "" : "s"}
                      {routine.days.some((d) => d.isRest) ? ` · ${routine.days.filter((d) => d.isRest).length} rest` : ""}
                      {routine.description ? ` · ${routine.description}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {routine.isActive ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={busyId === routine.id}
                        onClick={() =>
                          run(routine.id, () => api.post(`/api/v1/workout-routines/${routine.id}/pause`), "Routine paused.")
                        }
                      >
                        <Pause /> Pause
                      </Button>
                    ) : (
                      <Button
                        size="xs"
                        variant="secondary"
                        disabled={busyId === routine.id}
                        onClick={() =>
                          run(routine.id, () => api.post(`/api/v1/workout-routines/${routine.id}/activate`), "Routine activated.")
                        }
                      >
                        <Play /> Activate
                      </Button>
                    )}
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busyId === routine.id}
                      onClick={() =>
                        run(
                          routine.id,
                          () => api.post(`/api/v1/workout-routines/${routine.id}/apply`, { scope: "future" }),
                          "Applied to future weeks.",
                        )
                      }
                    >
                      Apply
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => onEdit(routine)}>
                      <Pencil /> Edit
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Delete routine"
                      disabled={busyId === routine.id}
                      onClick={() => {
                        if (!window.confirm(`Delete “${routine.name}”? Future planned sessions it created will be removed.`)) return;
                        void run(routine.id, () => api.delete(`/api/v1/workout-routines/${routine.id}`), "Routine deleted.");
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------ workout editor

interface DraftSet {
  reps: string;
  weight: string;
  durationSeconds: string;
  restSeconds: string;
  completed: boolean;
}

interface DraftExercise {
  key: string;
  exerciseId: string | null;
  name: string;
  sets: DraftSet[];
}

function blankSet(): DraftSet {
  return { reps: "", weight: "", durationSeconds: "", restSeconds: "", completed: true };
}

/**
 * The exercise tree editor, shared by a scheduled workout and a routine day so
 * the two cannot drift into different shapes. `includeRest` is on for workouts
 * (a per-set rest) and off for routine sets.
 */
function ExerciseListEditor({
  value,
  onChange,
  options,
  busy,
  datalistId,
}: {
  value: DraftExercise[];
  onChange: (next: DraftExercise[]) => void;
  options: ExerciseOption[];
  busy: boolean;
  datalistId: string;
}) {
  const [query, setQuery] = React.useState("");

  function add() {
    const name = query.trim();
    if (!name) return;
    const match = options.find((o) => o.name.toLowerCase() === name.toLowerCase());
    onChange([
      ...value,
      {
        key: `${datalistId}-${value.length}-${name}`,
        exerciseId: match?.id ?? null,
        name: match?.name ?? name,
        sets: [blankSet()],
      },
    ]);
    setQuery("");
  }

  function updateExercise(key: string, patch: Partial<DraftExercise>) {
    onChange(value.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  }

  function updateSet(key: string, index: number, patch: Partial<DraftSet>) {
    onChange(
      value.map((e) =>
        e.key === key ? { ...e, sets: e.sets.map((s, i) => (i === index ? { ...s, ...patch } : s)) } : e,
      ),
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          list={datalistId}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add an exercise…"
          disabled={busy}
        />
        <datalist id={datalistId}>
          {options.map((o) => (
            <option key={o.id} value={o.name} />
          ))}
        </datalist>
        <Button variant="secondary" onClick={add} disabled={busy || !query.trim()}>
          <Plus /> Add
        </Button>
      </div>

      {value.length === 0 ? (
        <p className="rounded-control border border-dashed border-line px-3 py-3 text-center text-[12px] text-ink-subtle">
          No exercises yet. Search the library or type a new name.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {value.map((exercise) => (
            <div key={exercise.key} className="rounded-control border border-line bg-surface-2 p-2.5">
              <div className="flex items-center gap-2">
                <Input
                  value={exercise.name}
                  onChange={(e) => updateExercise(exercise.key, { name: e.target.value })}
                  maxLength={120}
                  disabled={busy}
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Remove exercise"
                  onClick={() => onChange(value.filter((e) => e.key !== exercise.key))}
                  disabled={busy}
                >
                  <X />
                </Button>
              </div>
              <div className="mt-2 flex flex-col gap-1.5">
                <div className="grid grid-cols-[auto_repeat(4,minmax(0,1fr))_auto] gap-2 text-[11px] text-ink-subtle">
                  <span className="w-4" aria-hidden />
                  <span>Reps</span>
                  <span>Weight</span>
                  <span>Time (s)</span>
                  <span>Rest (s)</span>
                  <span />
                </div>
                {exercise.sets.map((set, index) => (
                  <div key={index} className="grid grid-cols-[auto_repeat(4,minmax(0,1fr))_auto] items-center gap-2">
                    <input
                      type="checkbox"
                      checked={set.completed}
                      onChange={(e) => updateSet(exercise.key, index, { completed: e.target.checked })}
                      aria-label="Set completed"
                      disabled={busy}
                      className="size-4 accent-lime"
                    />
                    <Input type="number" min={0} className="h-9" value={set.reps} onChange={(e) => updateSet(exercise.key, index, { reps: e.target.value })} disabled={busy} />
                    <Input type="number" min={0} step="0.5" className="h-9" value={set.weight} onChange={(e) => updateSet(exercise.key, index, { weight: e.target.value })} disabled={busy} />
                    <Input type="number" min={0} className="h-9" value={set.durationSeconds} onChange={(e) => updateSet(exercise.key, index, { durationSeconds: e.target.value })} disabled={busy} />
                    <Input type="number" min={0} className="h-9" value={set.restSeconds} onChange={(e) => updateSet(exercise.key, index, { restSeconds: e.target.value })} disabled={busy} />
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Remove set"
                      onClick={() => updateExercise(exercise.key, { sets: exercise.sets.filter((_, i) => i !== index) })}
                      disabled={busy}
                    >
                      <X />
                    </Button>
                  </div>
                ))}
                <Button
                  size="xs"
                  variant="ghost"
                  className="self-start"
                  onClick={() => updateExercise(exercise.key, { sets: [...exercise.sets, blankSet()] })}
                  disabled={busy}
                >
                  <Plus /> Add set
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A shared set of muscle-group chips with a custom-value input. */
function MuscleGroupsPicker({
  value,
  onChange,
  busy,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  busy: boolean;
}) {
  const [custom, setCustom] = React.useState("");
  const available = MUSCLE_GROUP_PRESETS.filter((g) => !value.includes(g));

  return (
    <div className="flex flex-col gap-2">
      {value.length ? (
        <div className="flex flex-wrap gap-1">
          {value.map((group) => (
            <button
              key={group}
              type="button"
              disabled={busy}
              onClick={() => onChange(value.filter((g) => g !== group))}
              className="inline-flex items-center gap-1 rounded-full bg-lime-soft px-2 py-0.5 text-[11px] text-lime"
            >
              {group}
              <X className="size-3" />
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-ink-subtle">No muscle groups yet.</p>
      )}

      <div className="flex flex-wrap gap-1">
        {available.map((group) => (
          <button
            key={group}
            type="button"
            disabled={busy}
            onClick={() => onChange([...value, group])}
            className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-subtle hover:border-line-strong hover:text-ink"
          >
            + {group}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const v = custom.trim();
              if (v && !value.includes(v)) onChange([...value, v]);
              setCustom("");
            }
          }}
          placeholder="Custom group…"
          disabled={busy}
          className="h-9"
        />
      </div>
    </div>
  );
}

function draftFromSets(
  sets: {
    reps: number | null;
    weight: number | null;
    durationSeconds: number | null;
    restSeconds?: number | null;
    completed?: boolean;
  }[],
): DraftSet[] {
  return sets.length
    ? sets.map((set) => ({
        reps: set.reps != null ? String(set.reps) : "",
        weight: set.weight != null ? String(set.weight) : "",
        durationSeconds: set.durationSeconds != null ? String(set.durationSeconds) : "",
        restSeconds: set.restSeconds != null ? String(set.restSeconds) : "",
        completed: set.completed ?? true,
      }))
    : [blankSet()];
}

function setsPayload(sets: DraftSet[]) {
  return sets.map((set) => ({
    reps: numberOrNull(set.reps),
    weight: numberOrNull(set.weight),
    durationSeconds: numberOrNull(set.durationSeconds),
    restSeconds: numberOrNull(set.restSeconds),
    completed: set.completed,
  }));
}

function exercisesPayload(draft: DraftExercise[]) {
  return draft
    .filter((e) => e.name.trim())
    .map((e) => ({
      exerciseId: e.exerciseId,
      name: e.name.trim(),
      sets: setsPayload(e.sets),
    }));
}

function ScheduledWorkoutDialog({
  date,
  initial,
  exercises,
  onClose,
  onSaved,
}: {
  date: string;
  initial?: WorkoutView;
  exercises: ExerciseOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState(initial?.name ?? "");
  const [day, setDay] = React.useState(initial?.date ?? date);
  const [start, setStart] = React.useState(minutesToTime(localStartMinutes(initial?.startAt ?? null)));
  const [minutes, setMinutes] = React.useState(initial?.minutes != null ? String(initial.minutes) : "");
  const [muscleGroups, setMuscleGroups] = React.useState<string[]>(initial?.muscleGroups ?? []);
  const [notes, setNotes] = React.useState(initial?.notes ?? "");
  const [draft, setDraft] = React.useState<DraftExercise[]>(
    initial
      ? initial.exercises.map((exercise) => ({
          key: exercise.id,
          exerciseId: exercise.exerciseId ?? null,
          name: exercise.name,
          sets: draftFromSets(exercise.sets),
        }))
      : [],
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const body = {
      name: name.trim(),
      date: day,
      startMinutes: timeToMinutes(start),
      minutes: numberOrNull(minutes),
      notes: notes.trim() || null,
      muscleGroups,
      exercises: exercisesPayload(draft),
    };
    try {
      if (initial) {
        await api.patch(`/api/v1/workouts/${initial.id}`, body);
        toast.success("Session updated.");
      } else {
        await api.post("/api/v1/workouts", { ...body, status: "PLANNED" });
        toast.success("Session scheduled.");
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save that session.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit session" : "Schedule a workout"}</DialogTitle>
          <DialogDescription>
            {initial
              ? "Changes apply to this day only, not to the routine behind it."
              : "Add a session to a day. Give it a time, and it appears on the planner too."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-6 py-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" error={error ?? undefined}>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Push day" disabled={busy} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} disabled={busy} />
              </Field>
              <Field label="Time">
                <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} disabled={busy} />
              </Field>
            </div>
          </div>

          <Field label="Target minutes">
            <Input type="number" min={0} max={1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="45" disabled={busy} />
          </Field>

          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium text-ink-muted">Muscle groups</span>
            <MuscleGroupsPicker value={muscleGroups} onChange={setMuscleGroups} busy={busy} />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium text-ink-muted">Exercises</span>
            <ExerciseListEditor value={draft} onChange={setDraft} options={exercises} busy={busy} datalistId="weekly-workout-exercises" />
          </div>

          <Field label="Notes (optional)">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} className="min-h-16" disabled={busy} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            <X /> Cancel
          </Button>
          <Button variant="lime" onClick={submit} loading={busy} loadingText="Saving" disabled={!name.trim()}>
            {initial ? "Save changes" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RescheduleDialog({
  workout,
  onClose,
  onSaved,
}: {
  workout: WorkoutView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [day, setDay] = React.useState(workout.date);
  const [start, setStart] = React.useState(minutesToTime(localStartMinutes(workout.startAt)));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/v1/workouts/${workout.id}/reschedule`, {
        date: day,
        startMinutes: timeToMinutes(start),
      });
      toast.success("Session rescheduled.");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not reschedule that session.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Move “{workout.name}”</DialogTitle>
          <DialogDescription>
            The original slot is kept as rescheduled, so the week shows the move.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 px-6 py-1 sm:grid-cols-2">
          <Field label="New date" error={error ?? undefined}>
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} disabled={busy} />
          </Field>
          <Field label="Time">
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} disabled={busy} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            <X /> Cancel
          </Button>
          <Button variant="lime" onClick={submit} loading={busy} loadingText="Moving">
            Move session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------- routine editor

interface DraftRoutineDay {
  weekday: number;
  name: string;
  isRest: boolean;
  muscleGroups: string[];
  targetMinutes: string;
  startMinutes: string;
  exercises: DraftExercise[];
}

function blankRoutineDay(weekday: number): DraftRoutineDay {
  return {
    weekday,
    name: "",
    isRest: false,
    muscleGroups: [],
    targetMinutes: "",
    startMinutes: "",
    exercises: [],
  };
}

function RoutineDialog({
  initial,
  exerciseOptions,
  onClose,
  onSaved,
}: {
  initial: RoutineView | null;
  exerciseOptions: ExerciseOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState(initial?.name ?? "");
  const [description, setDescription] = React.useState(initial?.description ?? "");
  const [days, setDays] = React.useState<DraftRoutineDay[]>(() =>
    WEEKDAYS.map((weekday) => {
      const existing = initial?.days.find((d) => d.weekday === weekday.index);
      if (!existing) return blankRoutineDay(weekday.index);
      return {
        weekday: weekday.index,
        name: existing.name,
        isRest: existing.isRest,
        muscleGroups: existing.muscleGroups,
        targetMinutes: existing.targetMinutes != null ? String(existing.targetMinutes) : "",
        startMinutes: minutesToTime(existing.startMinutes),
        exercises: existing.exercises.map((exercise) => ({
          key: exercise.id,
          exerciseId: exercise.exerciseId,
          name: exercise.name,
          sets: draftFromSets(exercise.sets),
        })),
      };
    }),
  );
  const [openDay, setOpenDay] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function update(weekday: number, patch: Partial<DraftRoutineDay>) {
    setDays((list) => list.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      days: days.map((d) => ({
        weekday: d.weekday,
        name: d.isRest ? d.name.trim() || "Rest" : d.name.trim() || "Training day",
        muscleGroups: d.isRest ? [] : d.muscleGroups,
        isRest: d.isRest,
        targetMinutes: d.isRest ? null : numberOrNull(d.targetMinutes),
        startMinutes: d.isRest ? null : timeToMinutes(d.startMinutes),
        exercises: d.isRest ? [] : exercisesPayload(d.exercises),
      })),
    };
    try {
      if (initial) {
        await api.patch(`/api/v1/workout-routines/${initial.id}`, payload);
        toast.success("Routine updated.");
      } else {
        await api.post("/api/v1/workout-routines", payload);
        toast.success("Routine created.");
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save that routine.");
    } finally {
      setBusy(false);
    }
  }

  const activeDays = days.filter((d) => !d.isRest && (d.name.trim() || d.exercises.length)).length;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{initial ? `Edit “${initial.name}”` : "New weekly routine"}</DialogTitle>
          <DialogDescription>
            A repeating week. Save it, then activate it or apply it to fill the calendar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[72vh] flex-col gap-4 overflow-y-auto px-6 py-1">
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field label="Routine name" error={error ?? undefined}>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Push Pull Legs" disabled={busy} />
            </Field>
            <Field label="Description">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} placeholder="6-day split" disabled={busy} />
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium text-ink-muted">
              Days · {activeDays} training day{activeDays === 1 ? "" : "s"}
            </span>
            <div className="flex flex-col divide-y divide-line rounded-control border border-line">
              {days.map((day) => {
                const label = weekdayShort(day.weekday);
                const isOpen = openDay === day.weekday;
                return (
                  <div key={day.weekday} className="flex flex-col">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <span className="w-9 shrink-0 text-[12px] font-semibold uppercase text-ink-subtle">
                        {label}
                      </span>
                      <Input
                        value={day.name}
                        onChange={(e) => update(day.weekday, { name: e.target.value })}
                        placeholder={day.isRest ? "Rest" : "Name the day"}
                        disabled={busy || day.isRest}
                        className="h-9 flex-1"
                      />
                      <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-ink-muted">
                        <input
                          type="checkbox"
                          checked={day.isRest}
                          onChange={(e) => update(day.weekday, { isRest: e.target.checked })}
                          disabled={busy}
                          className="size-4 accent-lime"
                        />
                        Rest
                      </label>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => setOpenDay(isOpen ? null : day.weekday)}
                        disabled={busy}
                      >
                        {isOpen ? "Done" : day.exercises.length ? `${day.exercises.length} ex` : "Edit"}
                      </Button>
                    </div>

                    {isOpen && !day.isRest ? (
                      <div className="flex flex-col gap-3 border-t border-line bg-surface-2/50 px-3 py-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label="Target minutes">
                            <Input
                              type="number"
                              min={0}
                              max={1440}
                              className="h-9"
                              value={day.targetMinutes}
                              onChange={(e) => update(day.weekday, { targetMinutes: e.target.value })}
                              disabled={busy}
                            />
                          </Field>
                          <Field label="Default start time">
                            <Input
                              type="time"
                              className="h-9"
                              value={day.startMinutes}
                              onChange={(e) => update(day.weekday, { startMinutes: e.target.value })}
                              disabled={busy}
                            />
                          </Field>
                        </div>
                        <div className="flex flex-col gap-2">
                          <span className="text-[12px] font-medium text-ink-muted">Muscle groups</span>
                          <MuscleGroupsPicker
                            value={day.muscleGroups}
                            onChange={(next) => update(day.weekday, { muscleGroups: next })}
                            busy={busy}
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <span className="text-[12px] font-medium text-ink-muted">Exercises</span>
                          <ExerciseListEditor
                            value={day.exercises}
                            onChange={(next) => update(day.weekday, { exercises: next })}
                            options={exerciseOptions}
                            busy={busy}
                            datalistId={`routine-day-${day.weekday}`}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            <X /> Cancel
          </Button>
          <Button variant="lime" onClick={submit} loading={busy} loadingText="Saving" disabled={!name.trim()}>
            {initial ? "Save routine" : "Create routine"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SaveWeekDialog({
  weekStart,
  suggestedName,
  onClose,
  onSaved,
}: {
  weekStart: string;
  suggestedName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState(suggestedName);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/v1/workout-routines/from-week", { name: name.trim(), week: weekStart });
      toast.success("Saved as a routine.");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save that week.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Save this week as a routine</DialogTitle>
          <DialogDescription>
            Every planned day this week becomes a repeating weekly day.
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 py-1">
          <Field label="Routine name" error={error ?? undefined}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} disabled={busy} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            <X /> Cancel
          </Button>
          <Button variant="lime" onClick={submit} loading={busy} loadingText="Saving" disabled={!name.trim()}>
            Save routine
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
