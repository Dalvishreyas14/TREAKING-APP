"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  ClipboardList,
  Dumbbell,
  Pencil,
  Plus,
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
import { api, ApiClientError } from "@/lib/api/client";
import { formatLocalClockTime } from "@/lib/format/date";
import { cn } from "@/lib/utils";

/**
 * The workout log.
 *
 * This is the one place in Fitness that is not a view over habits: a structured
 * session with exercises and sets is data a habit row genuinely cannot hold.
 * The habits screen is still rendered underneath, unchanged, because a "walk
 * 3 km" habit is a valid fitness record too.
 *
 * Every figure here is derived from COMPLETED workouts only. A planned session
 * is a schedule, and counting it as training would inflate the very numbers the
 * page exists to report.
 */

export interface WorkoutSetView {
  reps: number | null;
  weight: number | null;
  durationSeconds: number | null;
  /** Present on sets read back from the API; the planner carries it through. */
  restSeconds?: number | null;
  completed: boolean;
}

export interface WorkoutExerciseView {
  id: string;
  /** Set when the exercise still resolves to a library entry. */
  exerciseId?: string | null;
  name: string;
  sets: WorkoutSetView[];
}

export type WorkoutStatusView =
  | "PLANNED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "SKIPPED"
  | "RESCHEDULED";

export interface WorkoutView {
  id: string;
  name: string;
  date: string;
  startAt: string | null;
  minutes: number | null;
  notes: string | null;
  status: WorkoutStatusView;
  muscleGroups: string[];
  rescheduledFromDate: string | null;
  /** Provenance: set when this session was materialised from a routine. */
  routineId?: string | null;
  habitId?: string | null;
  category: { id: string; name: string; color: string } | null;
  exercises: WorkoutExerciseView[];
}

export interface ExerciseOption {
  id: string;
  name: string;
  muscleGroup: string;
  equipment: string | null;
  isSystem: boolean;
}

export interface CategoryOption {
  id: string;
  name: string;
}

const MUSCLE_GROUPS = [
  "CHEST",
  "BACK",
  "SHOULDERS",
  "ARMS",
  "CORE",
  "LEGS",
  "GLUTES",
  "FULL_BODY",
  "CARDIO",
  "OTHER",
] as const;

function muscleLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

/**
 * `2026-10-16` -> `Fri, 16 Oct`.
 *
 * The date is already a plain calendar string, so it is formatted from the UTC
 * components with an explicit locale. Both details are load-bearing for
 * hydration: the default locale differs between the Node server and the browser
 * (which renders the field differently and fails hydration), and reading the
 * day in local time would shift it a day west of Greenwich.
 */
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** A real instant, rendered through the app's locale-stable date-fns formatter. */
function clockLabel(iso: string): string {
  return formatLocalClockTime(new Date(iso));
}

function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Total volume in kg, ignoring timed sets and any set missing reps or weight. */
function workoutVolume(workout: WorkoutView): number {
  let total = 0;
  for (const exercise of workout.exercises) {
    for (const set of exercise.sets) {
      if (set.completed && set.reps && set.weight) total += set.reps * set.weight;
    }
  }
  return total;
}

function setSummary(set: WorkoutSetView): string {
  if (set.durationSeconds) {
    const sec = set.durationSeconds;
    return sec >= 60 ? `${Math.round(sec / 60)} min` : `${sec}s`;
  }
  if (set.reps && set.weight) return `${set.reps} × ${set.weight} kg`;
  if (set.reps) return `${set.reps} reps`;
  return "—";
}

/**
 * The one badge for a workout's lifecycle, shared by the history list and the
 * weekly planner so the two can never disagree about what a status looks like.
 */
export function WorkoutStatusBadge({ status }: { status: WorkoutStatusView }) {
  switch (status) {
    case "COMPLETED":
      return (
        <Badge variant="lime" size="sm">
          <Check /> Done
        </Badge>
      );
    case "IN_PROGRESS":
      return (
        <Badge variant="iris" size="sm">
          In progress
        </Badge>
      );
    case "SKIPPED":
      return <Badge variant="neutral" size="sm">Skipped</Badge>;
    case "RESCHEDULED":
      return <Badge variant="amber" size="sm">Rescheduled</Badge>;
    case "PLANNED":
    default:
      return (
        <Badge variant="outline" size="sm">
          <ClipboardList /> Planned
        </Badge>
      );
  }
}

export function WorkoutBoard({
  workouts,
  exercises,
  categories,
  today,
}: {
  workouts: WorkoutView[];
  exercises: ExerciseOption[];
  categories: CategoryOption[];
  /** `yyyy-MM-dd` in the server's UTC calendar, so "this week" is a pure derivation. */
  today: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = React.useState<"ALL" | "COMPLETED" | "PLANNED">("ALL");
  const [dialog, setDialog] = React.useState<
    | { mode: "log" }
    | { mode: "plan" }
    | { mode: "edit"; workout: WorkoutView }
    | { mode: "exercises" }
    | null
  >(null);

  const completed = workouts.filter((w) => w.status === "COMPLETED");

  // A trailing seven-day window ending today, keyed off the server's date so the
  // figure does not shift between a render and a re-render. `Date.UTC` is pure;
  // reading the clock mid-render is what the compiler forbids.
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  const weekStartUtc = Date.UTC(ty, tm - 1, td) - 6 * 86_400_000;
  const week = completed.filter((w) => {
    const [y, m, d] = w.date.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d) >= weekStartUtc;
  });
  const weekMinutes = week.reduce((n, w) => n + (w.minutes ?? 0), 0);
  const weekVolume = week.reduce((n, w) => n + workoutVolume(w), 0);
  const weekSets = week.reduce(
    (n, w) => n + w.exercises.reduce((s, e) => s + e.sets.filter((x) => x.completed).length, 0),
    0,
  );

  const personalBests = (() => {
    const best = new Map<string, { weight: number; reps: number }>();
    for (const workout of completed) {
      for (const exercise of workout.exercises) {
        for (const set of exercise.sets) {
          if (!set.completed) continue;
          if (set.weight && set.weight > 0) {
            const current = best.get(exercise.name);
            if (!current || set.weight > current.weight) {
              best.set(exercise.name, { weight: set.weight, reps: set.reps ?? 0 });
            }
          }
        }
      }
    }
    return [...best.entries()]
      .sort((a, b) => b[1].weight - a[1].weight)
      .slice(0, 5)
      .map(([name, value]) => ({ name, ...value }));
  })();

  const visible = workouts.filter((w) => filter === "ALL" || w.status === filter);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-[-0.01em]">Workout log</h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            Sessions with exercises and sets. Planned sessions land on the planner.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setDialog({ mode: "exercises" })}>
            <Dumbbell /> Exercises
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDialog({ mode: "plan" })}>
            <ClipboardList /> Plan
          </Button>
          <Button size="sm" variant="lime" onClick={() => setDialog({ mode: "log" })}>
            <Plus /> Log workout
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Sessions this week" value={String(week.length)} />
        <Stat label="Minutes this week" value={`${weekMinutes}`} unit="min" />
        <Stat label="Sets this week" value={String(weekSets)} />
        <Stat label="Volume this week" value={weekVolume > 0 ? weekVolume.toLocaleString("en-IN") : "0"} unit="kg" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>History</CardTitle>
            <div className="flex items-center gap-1 rounded-control border border-line p-0.5">
              {(["ALL", "COMPLETED", "PLANNED"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={cn(
                    "rounded-[6px] px-2.5 py-1 text-[12px] transition-colors",
                    filter === key ? "bg-surface-2 text-ink" : "text-ink-subtle hover:text-ink",
                  )}
                >
                  {key === "ALL" ? "All" : key === "COMPLETED" ? "Done" : "Planned"}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {visible.length === 0 ? (
              <EmptyState
                icon={Dumbbell}
                size="sm"
                title={workouts.length === 0 ? "No workouts logged yet" : "Nothing in this view"}
                description={
                  workouts.length === 0
                    ? "Log your first session and it will show up here with its exercises and sets."
                    : "Try a different filter, or log a new session."
                }
                action={{ label: "Log workout", onClick: () => setDialog({ mode: "log" }) }}
              />
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {visible.map((workout) => (
                  <li key={workout.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-ink">{workout.name}</p>
                          <WorkoutStatusBadge status={workout.status} />
                          {workout.category ? (
                            <Badge variant="neutral" size="sm">
                              {workout.category.name}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-[11px] text-ink-subtle">
                          {dayLabel(workout.date)}
                          {workout.startAt ? ` · ${clockLabel(workout.startAt)}` : ""}
                          {workout.minutes ? ` · ${workout.minutes} min` : ""}
                          {workout.exercises.length
                            ? ` · ${workout.exercises.length} exercise${workout.exercises.length === 1 ? "" : "s"}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {workout.status === "PLANNED" || workout.status === "IN_PROGRESS" ? (
                          <Button
                            size="xs"
                            variant="lime"
                            onClick={() => void complete(workout)}
                          >
                            <Check /> Complete
                          </Button>
                        ) : null}
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label="Edit workout"
                          onClick={() => setDialog({ mode: "edit", workout })}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label="Delete workout"
                          onClick={() => void remove(workout)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>

                    {workout.exercises.length ? (
                      <ul className="flex flex-col gap-1 pl-1">
                        {workout.exercises.map((exercise) => (
                          <li key={exercise.id} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                            <span className="font-medium text-ink-muted">{exercise.name}</span>
                            <span className="text-ink-subtle">
                              {exercise.sets.map(setSummary).join(" · ")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Personal bests</CardTitle>
          </CardHeader>
          <CardContent>
            {personalBests.length === 0 ? (
              <p className="text-[13px] text-ink-muted">
                Log a weighted exercise and your heaviest set for each movement appears
                here.
              </p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {personalBests.map((best) => (
                  <li key={best.name} className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[13px] text-ink-muted">{best.name}</span>
                    <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink">
                      {best.weight} kg
                      {best.reps ? (
                        <span className="font-normal text-ink-subtle"> × {best.reps}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {dialog && dialog.mode !== "exercises" ? (
        <WorkoutForm
          mode={dialog.mode}
          initial={dialog.mode === "edit" ? dialog.workout : undefined}
          exercises={exercises}
          categories={categories}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      ) : null}

      {dialog?.mode === "exercises" ? (
        <ExerciseManager
          exercises={exercises}
          onClose={() => setDialog(null)}
          onChanged={() => router.refresh()}
        />
      ) : null}
    </div>
  );

  async function complete(workout: WorkoutView) {
    try {
      await api.patch(`/api/v1/workouts/${workout.id}`, { status: "COMPLETED" });
      toast.success("Workout completed.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not update that workout.");
    }
  }

  async function remove(workout: WorkoutView) {
    if (!window.confirm(`Delete “${workout.name}”? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/v1/workouts/${workout.id}`);
      toast.success("Workout deleted.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not delete that workout.");
    }
  }
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <Card tone="sunken">
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="text-[11px] uppercase tracking-wide text-ink-subtle">{label}</span>
        <span className="text-xl font-semibold tabular-nums text-ink">
          {value}
          {unit ? <span className="ml-1 text-[13px] font-normal text-ink-muted">{unit}</span> : null}
        </span>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------- form

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

function WorkoutForm({
  mode,
  initial,
  exercises,
  categories,
  onClose,
  onSaved,
}: {
  mode: "log" | "plan" | "edit";
  initial?: WorkoutView;
  exercises: ExerciseOption[];
  categories: CategoryOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState(initial?.name ?? "");
  const [date, setDate] = React.useState(initial?.date ?? todayIso());
  const [time, setTime] = React.useState(() => {
    if (!initial?.startAt) return "";
    const d = new Date(initial.startAt);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  const [minutes, setMinutes] = React.useState(initial?.minutes ? String(initial.minutes) : "");
  const [categoryId, setCategoryId] = React.useState(initial?.category?.id ?? "");
  const [notes, setNotes] = React.useState(initial?.notes ?? "");
  const status = mode === "plan" ? "PLANNED" : "COMPLETED";
  const [draft, setDraft] = React.useState<DraftExercise[]>(
    initial
      ? initial.exercises.map((exercise) => ({
          key: exercise.id,
          exerciseId:
            exercises.find((e) => e.name.toLowerCase() === exercise.name.toLowerCase())?.id ?? null,
          name: exercise.name,
          sets: exercise.sets.map((set) => ({
            reps: set.reps != null ? String(set.reps) : "",
            weight: set.weight != null ? String(set.weight) : "",
            durationSeconds: set.durationSeconds != null ? String(set.durationSeconds) : "",
            restSeconds: "",
            completed: set.completed,
          })),
        }))
      : [],
  );
  const [query, setQuery] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function addExercise() {
    const value = query.trim();
    if (!value) return;
    const match = exercises.find((e) => e.name.toLowerCase() === value.toLowerCase());
    setDraft((list) => [
      ...list,
      {
        key: `${Date.now()}-${list.length}`,
        exerciseId: match?.id ?? null,
        name: match?.name ?? value,
        sets: [blankSet()],
      },
    ]);
    setQuery("");
  }

  function updateExercise(key: string, patch: Partial<DraftExercise>) {
    setDraft((list) => list.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  }

  function updateSet(key: string, index: number, patch: Partial<DraftSet>) {
    setDraft((list) =>
      list.map((e) =>
        e.key === key
          ? { ...e, sets: e.sets.map((s, i) => (i === index ? { ...s, ...patch } : s)) }
          : e,
      ),
    );
  }

  function numberOrNull(value: string): number | null {
    if (value.trim() === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  async function submit() {
    setBusy(true);
    setError(null);

    const startMinutes = time
      ? Number(time.split(":")[0]) * 60 + Number(time.split(":")[1])
      : null;

    const body = {
      name: name.trim(),
      date,
      startMinutes,
      minutes: numberOrNull(minutes),
      notes: notes.trim() || null,
      status,
      categoryId: categoryId || null,
      exercises: draft
        .filter((e) => e.name.trim())
        .map((e) => ({
          exerciseId: e.exerciseId,
          name: e.name.trim(),
          sets: e.sets.map((s) => ({
            reps: numberOrNull(s.reps),
            weight: numberOrNull(s.weight),
            durationSeconds: numberOrNull(s.durationSeconds),
            restSeconds: numberOrNull(s.restSeconds),
            completed: s.completed,
          })),
        })),
    };

    try {
      if (mode === "edit" && initial) {
        await api.patch(`/api/v1/workouts/${initial.id}`, body);
      } else {
        await api.post("/api/v1/workouts", body);
      }
      toast.success(mode === "plan" ? "Workout planned." : mode === "edit" ? "Workout updated." : "Workout logged.");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save that workout.");
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "plan" ? "Plan a workout" : mode === "edit" ? "Edit workout" : "Log a workout";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {mode === "plan"
              ? "A planned session appears on the planner for the day and time you choose."
              : "Record what you did. Volume is weight × reps across completed sets."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-6 py-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" error={error ?? undefined}>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                placeholder="Push day"
                disabled={busy}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
              </Field>
              <Field label="Time (optional)">
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={busy} />
              </Field>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Duration (minutes)">
              <Input
                type="number"
                min={0}
                max={1440}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                placeholder="45"
                disabled={busy}
              />
            </Field>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-muted">Category</span>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={busy}
                className="h-10 rounded-control border border-line bg-surface px-2.5 text-sm text-ink"
              >
                <option value="">Uncategorised</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium text-ink-muted">Exercises</span>

            <div className="flex gap-2">
              <Input
                list="fitness-exercise-library"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addExercise();
                  }
                }}
                placeholder="Add an exercise…"
                disabled={busy}
              />
              <datalist id="fitness-exercise-library">
                {exercises.map((e) => (
                  <option key={e.id} value={e.name}>
                    {muscleLabel(e.muscleGroup)}
                  </option>
                ))}
              </datalist>
              <Button variant="secondary" onClick={addExercise} disabled={busy || !query.trim()}>
                <Plus /> Add
              </Button>
            </div>

            {draft.length === 0 ? (
              <p className="rounded-control border border-dashed border-line px-3 py-4 text-center text-[12px] text-ink-subtle">
                No exercises yet. Search the library above, or type a new name.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {draft.map((exercise) => (
                  <div key={exercise.key} className="rounded-control border border-line bg-surface-2 p-3">
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
                        onClick={() => setDraft((list) => list.filter((e) => e.key !== exercise.key))}
                        disabled={busy}
                      >
                        <X />
                      </Button>
                    </div>

                    <div className="mt-2 flex flex-col gap-2">
                      <div className="grid grid-cols-[repeat(4,minmax(0,1fr))_auto_auto] items-center gap-2 text-[11px] text-ink-subtle">
                        <span>Reps</span>
                        <span>Weight (kg)</span>
                        <span>Time (sec)</span>
                        <span>Rest (sec)</span>
                        <span />
                        <span />
                      </div>
                      {exercise.sets.map((set, index) => (
                        <div
                          key={index}
                          className="grid grid-cols-[repeat(4,minmax(0,1fr))_auto_auto] items-center gap-2"
                        >
                          <Input
                            type="number"
                            min={0}
                            value={set.reps}
                            onChange={(e) => updateSet(exercise.key, index, { reps: e.target.value })}
                            className="h-9"
                            disabled={busy}
                          />
                          <Input
                            type="number"
                            min={0}
                            step="0.5"
                            value={set.weight}
                            onChange={(e) => updateSet(exercise.key, index, { weight: e.target.value })}
                            className="h-9"
                            disabled={busy}
                          />
                          <Input
                            type="number"
                            min={0}
                            value={set.durationSeconds}
                            onChange={(e) =>
                              updateSet(exercise.key, index, { durationSeconds: e.target.value })
                            }
                            className="h-9"
                            disabled={busy}
                          />
                          <Input
                            type="number"
                            min={0}
                            value={set.restSeconds}
                            onChange={(e) => updateSet(exercise.key, index, { restSeconds: e.target.value })}
                            className="h-9"
                            disabled={busy}
                          />
                          <input
                            type="checkbox"
                            checked={set.completed}
                            onChange={(e) => updateSet(exercise.key, index, { completed: e.target.checked })}
                            aria-label="Set completed"
                            disabled={busy}
                            className="size-4 accent-lime"
                          />
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label="Remove set"
                            onClick={() =>
                              updateExercise(exercise.key, {
                                sets: exercise.sets.filter((_, i) => i !== index),
                              })
                            }
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
                        onClick={() =>
                          updateExercise(exercise.key, { sets: [...exercise.sets, blankSet()] })
                        }
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

          <Field label="Notes (optional)">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={4000}
              disabled={busy}
              className="min-h-16"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            <X /> Cancel
          </Button>
          <Button
            variant="lime"
            onClick={submit}
            loading={busy}
            loadingText="Saving"
            disabled={!name.trim()}
          >
            {mode === "plan" ? "Plan workout" : mode === "edit" ? "Save changes" : "Log workout"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------- exercise manager

function ExerciseManager({
  exercises,
  onClose,
  onChanged,
}: {
  exercises: ExerciseOption[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = React.useState("");
  const [muscleGroup, setMuscleGroup] = React.useState<string>("OTHER");
  const [equipment, setEquipment] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const own = exercises.filter((e) => !e.isSystem);
  const system = exercises.filter((e) => e.isSystem);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/v1/exercises", {
        name: name.trim(),
        muscleGroup,
        equipment: equipment.trim() || null,
      });
      setName("");
      setEquipment("");
      setMuscleGroup("OTHER");
      toast.success("Exercise added.");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not add that exercise.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.delete(`/api/v1/exercises/${id}`);
      toast.success("Exercise removed.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not remove that exercise.");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Exercise library</DialogTitle>
          <DialogDescription>
            Built-in movements are shared and read-only. Add your own to fill a gap.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-6 py-1">
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
            <Field label="Name" error={error ?? undefined}>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} disabled={busy} />
            </Field>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-muted">Muscle group</span>
              <select
                value={muscleGroup}
                onChange={(e) => setMuscleGroup(e.target.value)}
                disabled={busy}
                className="h-10 rounded-control border border-line bg-surface px-2.5 text-sm text-ink"
              >
                {MUSCLE_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {muscleLabel(g)}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Equipment">
              <Input
                value={equipment}
                onChange={(e) => setEquipment(e.target.value)}
                maxLength={80}
                disabled={busy}
                placeholder="Barbell"
              />
            </Field>
            <Button variant="lime" onClick={create} loading={busy} disabled={!name.trim()}>
              <Plus /> Add
            </Button>
          </div>

          <div className="max-h-72 overflow-y-auto rounded-control border border-line">
            <ul className="divide-y divide-line">
              {[...own, ...system].map((exercise) => (
                <li key={exercise.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-ink">{exercise.name}</p>
                    <p className="text-[11px] text-ink-subtle">
                      {muscleLabel(exercise.muscleGroup)}
                      {exercise.equipment ? ` · ${exercise.equipment}` : ""}
                    </p>
                  </div>
                  {exercise.isSystem ? (
                    <Badge variant="outline" size="sm">
                      Built-in
                    </Badge>
                  ) : (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Remove exercise"
                      onClick={() => void remove(exercise.id)}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            <X /> Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
