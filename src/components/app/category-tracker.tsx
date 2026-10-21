"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Minus, Plus, Target, X } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";

/**
 * The habit list behind the Fitness and Study screens.
 *
 * Both screens are **views over `Category.kind`**: a habit filed under a FITNESS
 * or STUDY category is already logged, already streak-tracked, and already on
 * the dashboard, and this component is the same list with a different lens. It
 * is the lighter record for both domains — "walk 3 km" in Fitness, "read 30 min"
 * in Study — and stays independent of the structured `Workout` log so a session
 * is never recorded in two places and double-counted.
 *
 * Study now has a session model of its own — the timetable's `StudySession` and
 * `StudySeries` — but this list deliberately stays independent of it. A session
 * that feeds a habit writes one habit log and nothing else, so the two never
 * double-count; a habit is still the right home for the countable, repeatable
 * part ("read 30 min") and the timetable for the scheduled part ("DSA, Tuesday
 * 7pm"). Fitness has the same split with `Workout`, but only because a set of
 * reps and weights is data a habit row genuinely cannot hold.
 *
 * The consequence is stated honestly in the UI: these screens show what you
 * categorised as fitness and study. If a habit is uncategorised it will not
 * appear, and the empty state says so instead of rendering a bare zero.
 *
 * Logging is optimistic and rolls back to the exact previous value on failure,
 * for the same reason the main habit grid does it: a tracker that lags a tap
 * gets abandoned.
 */

export interface DomainHabit {
  id: string;
  name: string;
  color: string;
  type: string;
  unit: string | null;
  targetValue: number;
  targetMinutes: number | null;
  frequency: string;
  timesPerPeriod: number | null;
  categoryName: string;
  today: { value: number; completed: boolean } | null;
  weekValue: number;
  sessionCount: number;
}

export interface DomainCategory {
  id: string;
  name: string;
}

interface Preset {
  label: string;
  name: string;
  type: "BOOLEAN" | "COUNT" | "DURATION" | "DISTANCE" | "QUANTITY";
  unit: string | null;
  targetValue: number;
  targetMinutes?: number;
  frequency: "DAILY" | "WEEKLY";
  timesPerPeriod?: number;
}

const PRESETS: Record<"FITNESS" | "STUDY", Preset[]> = {
  FITNESS: [
    { label: "Workout", name: "Workout", type: "DURATION", unit: "min", targetValue: 45, targetMinutes: 45, frequency: "DAILY" },
    { label: "Run 3 km", name: "Run 3 km", type: "DISTANCE", unit: "km", targetValue: 3, frequency: "DAILY" },
    { label: "Steps", name: "Steps", type: "QUANTITY", unit: "steps", targetValue: 8000, frequency: "DAILY" },
    { label: "Train 3× a week", name: "Strength training", type: "COUNT", unit: "sessions", targetValue: 1, frequency: "WEEKLY", timesPerPeriod: 3 },
    { label: "Mobility", name: "Mobility", type: "DURATION", unit: "min", targetValue: 10, frequency: "DAILY" },
  ],
  STUDY: [
    { label: "Read 20 pages", name: "Read 20 pages", type: "QUANTITY", unit: "pages", targetValue: 20, frequency: "DAILY" },
    { label: "Study 45 min", name: "Study 45 min", type: "DURATION", unit: "min", targetValue: 45, targetMinutes: 45, frequency: "DAILY" },
    { label: "Revise 3× a week", name: "Revision", type: "COUNT", unit: "sessions", targetValue: 1, frequency: "WEEKLY", timesPerPeriod: 3 },
    { label: "Vocabulary", name: "Vocabulary", type: "COUNT", unit: "words", targetValue: 10, frequency: "DAILY" },
    { label: "Flashcards", name: "Flashcards", type: "COUNT", unit: "cards", targetValue: 30, frequency: "DAILY" },
  ],
};

function isPaceMetric(habit: DomainHabit): boolean {
  return habit.type === "DISTANCE" || habit.type === "QUANTITY";
}

function formatTotal(habit: DomainHabit): string {
  if (habit.frequency === "WEEKLY") {
    return `${habit.weekValue % 1 === 0 ? habit.weekValue : habit.weekValue.toFixed(1)} of ${
      habit.timesPerPeriod ?? habit.targetValue
    } sessions this week`;
  }
  const unit = habit.unit ?? "";
  const value = habit.weekValue;
  return `${value % 1 === 0 ? value : value.toFixed(1)}${unit ? ` ${unit}` : ""} in 7 days`;
}

export function CategoryTracker({
  kind,
  title,
  description,
  habits: initialHabits,
  categories,
  emptyHint,
}: {
  kind: "FITNESS" | "STUDY";
  title: string;
  description: string;
  habits: DomainHabit[];
  categories: DomainCategory[];
  emptyHint: string;
}) {
  const router = useRouter();
  const [habits, setHabits] = React.useState(initialHabits);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  const [syncedFrom, setSyncedFrom] = React.useState(initialHabits);
  if (syncedFrom !== initialHabits) {
    setSyncedFrom(initialHabits);
    setHabits(initialHabits);
  }

  const doneCount = habits.filter((h) => h.today?.completed).length;

  async function log(habit: DomainHabit, nextValue: number) {
    const before = habits;
    const target = habit.targetValue > 0 ? habit.targetValue : 1;
    const completed = habit.type === "BOOLEAN" ? nextValue > 0 : nextValue >= target;

    setBusyId(habit.id);
    setHabits((list) =>
      list.map((h) => (h.id === habit.id ? { ...h, today: { value: nextValue, completed } } : h)),
    );

    try {
      await api.post(`/api/v1/habits/${habit.id}/log`, { value: nextValue });
      router.refresh();
    } catch (error) {
      setHabits(before);
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not save that log.",
      );
    } finally {
      setBusyId(null);
    }
  }

  function adjust(habit: DomainHabit, delta: number) {
    const current = habit.today?.value ?? 0;
    const step = habit.type === "BOOLEAN" ? 1 : habit.targetValue > 0 && !isPaceMetric(habit) ? 1 : Math.max(1, habit.targetValue / 5);
    const next = Math.min(100000, Math.max(0, current + delta * step));
    void log(habit, Number(next.toFixed(2)));
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-[-0.01em]">{title}</h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          {habits.length > 0 ? (
            <span className="text-[12px] text-ink-subtle">
              {doneCount}/{habits.length} done today
            </span>
          ) : null}
          <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
            <Plus /> Add
          </Button>
        </div>
      </header>

      {habits.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Target}
              size="sm"
              title={`No ${kind === "FITNESS" ? "fitness" : "study"} habits yet`}
              description={emptyHint}
              action={{ label: "Add one from a preset", onClick: () => setCreating(true) }}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {habits.map((habit) => {
            const target = habit.targetValue > 0 ? habit.targetValue : 1;
            const value = habit.today?.value ?? 0;
            const completed = habit.today?.completed ?? false;
            const percent = Math.min(100, Math.round((value / target) * 100));
            const busy = busyId === habit.id;

            return (
              <Card key={habit.id} tone={completed ? "default" : "sunken"}>
                <CardContent className="flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{habit.name}</p>
                      <p className="mt-0.5 truncate text-[11px] text-ink-subtle">
                        {habit.categoryName} · {formatTotal(habit)}
                      </p>
                    </div>
                    {completed ? (
                      <Badge variant="limeSolid" size="sm">
                        <Check /> Done
                      </Badge>
                    ) : habit.frequency === "WEEKLY" ? (
                      <Badge variant="outline" size="sm">
                        {habit.timesPerPeriod ?? habit.targetValue}× weekly
                      </Badge>
                    ) : null}
                  </div>

                  {habit.type === "BOOLEAN" ? (
                    <Button
                      variant={completed ? "secondary" : "lime"}
                      size="sm"
                      loading={busy}
                      onClick={() => void log(habit, completed ? 0 : 1)}
                    >
                      {completed ? "Logged today" : "Log it"}
                    </Button>
                  ) : (
                    <>
                      <Progress value={percent} />
                      <div className="flex items-center gap-2">
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={busy || value <= 0}
                          onClick={() => adjust(habit, -1)}
                          aria-label={`Decrease ${habit.name}`}
                        >
                          <Minus />
                        </Button>
                        <span className="flex-1 text-center text-[13px] tabular-nums text-ink">
                          {value % 1 === 0 ? value : value.toFixed(1)}
                          <span className="text-ink-subtle">
                            {" "}
                            / {target % 1 === 0 ? target : target.toFixed(1)}{" "}
                            {habit.unit ?? ""}
                          </span>
                        </span>
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => adjust(habit, 1)}
                          aria-label={`Increase ${habit.name}`}
                        >
                          <Plus />
                        </Button>
                        <Button
                          size="xs"
                          variant={completed ? "ghost" : "secondary"}
                          disabled={busy}
                          onClick={() => void log(habit, target)}
                        >
                          {completed ? "Undo" : "Fill"}
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <HabitCreator
        kind={kind}
        open={creating}
        categories={categories}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          router.refresh();
        }}
      />
    </div>
  );
}

function HabitCreator({
  kind,
  open,
  categories,
  onClose,
  onSaved,
}: {
  kind: "FITNESS" | "STUDY";
  open: boolean;
  categories: DomainCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [preset, setPreset] = React.useState<Preset>(PRESETS[kind][0]!);
  const [name, setName] = React.useState(PRESETS[kind][0]!.name);
  const [categoryId, setCategoryId] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [wasOpen, setWasOpen] = React.useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setPreset(PRESETS[kind][0]!);
      setName(PRESETS[kind][0]!.name);
      setCategoryId("");
      setError(null);
    }
  }

  function pick(next: Preset) {
    setPreset(next);
    setName(next.name);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // `startDate` is required by habitCreateSchema; a new habit starts today.
      // Sent as a Date so the API can pin it to UTC midnight.
      await api.post("/api/v1/habits", {
        name,
        type: preset.type,
        unit: preset.unit,
        targetValue: preset.targetValue,
        targetMinutes: preset.targetMinutes ?? null,
        frequency: preset.frequency,
        timesPerPeriod: preset.timesPerPeriod ?? null,
        startDate: new Date(),
        categoryId: categoryId || null,
      });
      toast.success("Habit created.");
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : "Could not create that habit.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a {kind === "FITNESS" ? "fitness" : "study"} habit</DialogTitle>
          <DialogDescription>
            Start from a preset, then adjust the target. The category decides which
            screen it shows up on.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS[kind].map((p) => (
              <button
                key={p.label}
                type="button"
                disabled={busy}
                onClick={() => pick(p)}
                className={cn(
                  "rounded-control border px-2.5 py-1.5 text-[12px] transition-colors",
                  p.label === preset.label
                    ? "border-lime bg-lime-soft text-lime"
                    : "border-line text-ink-muted hover:border-line-strong",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <Field label="Name" error={error ?? undefined}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} disabled={busy} />
          </Field>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-muted">
              Category ({kind === "FITNESS" ? "fitness" : "study"})
            </span>
            {categories.length === 0 ? (
              <Textarea
                readOnly
                value="No category of this kind exists yet. The habit is still created and can be recategorised on the Habits screen."
                className="text-[12px] text-ink-subtle"
              />
            ) : (
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={busy}
                className="h-9 rounded-control border border-line bg-surface px-2.5 text-[13px] text-ink"
              >
                <option value="">Uncategorised</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </label>

          <p className="text-[11px] leading-relaxed text-ink-subtle">
            {preset.type === "BOOLEAN"
              ? "A yes/no habit, logged with one tap."
              : `Target ${preset.targetValue}${preset.unit ? ` ${preset.unit}` : ""} ${
                  preset.frequency === "WEEKLY"
                    ? `× ${preset.timesPerPeriod} a week`
                    : "a day"
                }.`}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            <X /> Cancel
          </Button>
          <Button variant="lime" onClick={submit} loading={busy} loadingText="Creating" disabled={!name.trim()}>
            Create habit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
