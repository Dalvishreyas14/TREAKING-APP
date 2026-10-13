"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Archive,
  Check,
  Flame,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Target,
} from "lucide-react";

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
import { api, ApiClientError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

/**
 * Habits.
 *
 * Logging is optimistic for the same reason task completion is: a habit
 * tracker that lags a second per tap stops being used. The rollback restores the
 * previous log exactly, so a failed tap leaves no trace.
 *
 * The trailing strip is the honest part of this screen. A streak number alone
 * rewards the person who happened to have a good month; showing the last 28 days
 * makes a broken streak visible immediately rather than at the end.
 */

export interface HabitItem {
  id: string;
  name: string;
  color: string;
  type: string;
  unit: string | null;
  targetValue: number;
  frequency: string;
  archivedAt: string | null;
  today: { value: number; completed: boolean };
  history: { date: string; value: number; completed: boolean }[];
}

const STRIP_DAYS = 28;

function formatValue(habit: HabitItem): string {
  if (habit.type === "BOOLEAN") return habit.today.completed ? "Done" : "Not yet";
  const value = habit.today.value;
  const target = habit.targetValue;
  const unit = habit.unit ?? "";
  return `${value % 1 === 0 ? value : value.toFixed(1)} / ${target % 1 === 0 ? target : target.toFixed(1)}${unit ? ` ${unit}` : ""}`;
}

/** Days since each of the last `count` days, oldest first, as ISO date keys. */
function stripKeys(count: number): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

export function HabitList({
  initialHabits,
}: {
  initialHabits: HabitItem[];
}) {
  const router = useRouter();
  const [habits, setHabits] = React.useState(initialHabits);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [composerOpen, setComposerOpen] = React.useState(false);
  const [showArchived, setShowArchived] = React.useState(false);

  const [syncedFrom, setSyncedFrom] = React.useState(initialHabits);
  if (syncedFrom !== initialHabits) {
    setSyncedFrom(initialHabits);
    setHabits(initialHabits);
  }

  const strip = React.useMemo(() => stripKeys(STRIP_DAYS), []);

  const active = habits.filter((h) => !h.archivedAt);
  const archived = habits.filter((h) => h.archivedAt);
  const visibleHabits = showArchived ? [...active, ...archived] : active;
  const doneCount = active.filter((h) => h.today.completed).length;

  async function log(habit: HabitItem, value: number) {
    const before = habits;
    const target = habit.targetValue > 0 ? habit.targetValue : 1;
    const completed = habit.type === "BOOLEAN" ? value > 0 : value >= target;

    setBusyId(habit.id);
    setHabits((list) =>
      list.map((h) => (h.id === habit.id ? { ...h, today: { value, completed } } : h)),
    );

    try {
      await api.post(`/api/v1/habits/${habit.id}/log`, { value });
      router.refresh();
    } catch (error) {
      setHabits(before);
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not save that.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function archive(habit: HabitItem) {
    const before = habits;
    setHabits((list) =>
      list.map((h) => (h.id === habit.id ? { ...h, archivedAt: new Date().toISOString() } : h)),
    );
    try {
      await api.delete(`/api/v1/habits/${habit.id}`);
      toast.success(`“${habit.name}” archived. Its history is kept.`);
      router.refresh();
    } catch (error) {
      setHabits(before);
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not archive that.",
      );
    }
  }

  /** Undo for archive, which is reversible precisely because nothing is deleted. */
  async function restore(habit: HabitItem) {
    const before = habits;
    setHabits((list) => list.map((h) => (h.id === habit.id ? { ...h, archivedAt: null } : h)));
    try {
      await api.patch(`/api/v1/habits/${habit.id}`, { archived: false });
      toast.success(`“${habit.name}” restored.`);
      router.refresh();
    } catch (error) {
      setHabits(before);
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not restore that.",
      );
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] text-ink-muted">
          {active.length === 0
            ? "Nothing tracked yet."
            : `${doneCount} of ${active.length} done today.`}
        </p>
        <div className="ml-auto flex items-center gap-2">
          {archived.length > 0 || showArchived ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setShowArchived((v) => !v)}
              aria-pressed={showArchived}
            >
              <RotateCcw aria-hidden />
              {showArchived ? "Hide archived" : `Archived (${archived.length})`}
            </Button>
          ) : null}
          <Button variant="lime" size="sm" onClick={() => setComposerOpen(true)}>
            <Plus aria-hidden />
            New habit
          </Button>
        </div>
      </div>

      {active.length === 0 ? (
        <Card>
          <CardContent className="pt-4">
            <EmptyState
              icon={Target}
              title="No habits yet"
              description="Pick one or two you already do most days. Starting with three you will not keep is the usual reason habit trackers end up abandoned."
              action={{ label: "Add a habit", onClick: () => setComposerOpen(true) }}
            />
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {visibleHabits.map((habit) => {
            const byDate = new Map(habit.history.map((h) => [h.date.slice(0, 10), h]));
            const isCount = habit.type !== "BOOLEAN";
            const step = isCount ? Math.max(1, Math.ceil(habit.targetValue / 4)) : 1;
            const isArchived = habit.archivedAt !== null;

            return (
              <li key={habit.id}>
                <Card className={cn("h-full", isArchived && "opacity-60")}>
                  <CardContent className="flex flex-col gap-3 pt-4">
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className="mt-1 size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: habit.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium leading-snug">
                          {habit.name}
                        </p>
                        <p className="mt-0.5 text-[12px] text-ink-muted">
                          {isArchived
                            ? "Archived — history kept"
                            : formatValue(habit)}
                          {!isArchived && habit.frequency !== "DAILY" ? (
                            <span className="ml-1.5 text-ink-subtle">
                              {habit.frequency.toLowerCase()}
                            </span>
                          ) : null}
                        </p>
                      </div>

                      {isArchived ? (
                        <Button
                          variant="secondary"
                          size="xs"
                          onClick={() => restore(habit)}
                        >
                          <RotateCcw aria-hidden />
                          Restore
                        </Button>
                      ) : isCount ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="secondary"
                            size="icon-sm"
                            aria-label={`Decrease ${habit.name}`}
                            disabled={busyId === habit.id || habit.today.value <= 0}
                            onClick={() =>
                              log(habit, Math.max(0, habit.today.value - step))
                            }
                          >
                            <Minus aria-hidden />
                          </Button>
                          <Button
                            variant="secondary"
                            size="icon-sm"
                            aria-label={`Increase ${habit.name}`}
                            disabled={busyId === habit.id}
                            onClick={() => log(habit, habit.today.value + step)}
                          >
                            <Plus aria-hidden />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant={habit.today.completed ? "lime" : "secondary"}
                          size="icon-sm"
                          aria-label={
                            habit.today.completed
                              ? `Undo ${habit.name}`
                              : `Complete ${habit.name}`
                          }
                          aria-pressed={habit.today.completed}
                          disabled={busyId === habit.id}
                          onClick={() => log(habit, habit.today.completed ? 0 : 1)}
                        >
                          {busyId === habit.id ? (
                            <Loader2 aria-hidden className="animate-spin" />
                          ) : habit.today.completed ? (
                            <Check aria-hidden />
                          ) : (
                            <Check aria-hidden className="opacity-0" />
                          )}
                        </Button>
                      )}
                    </div>

                    <div className="flex items-end justify-between gap-3">
                      <div
                        className="flex gap-px"
                        role="img"
                        aria-label={`${strip.filter((d) => byDate.get(d)?.completed).length} of the last ${STRIP_DAYS} days completed`}
                      >
                        {strip.map((day) => {
                          const hit = byDate.get(day)?.completed;
                          const isToday = day === strip[strip.length - 1];
                          return (
                            <span
                              key={day}
                              title={day}
                              className={cn(
                                "h-5 w-1.5 rounded-[2px]",
                                hit
                                  ? "opacity-90"
                                  : "bg-surface-3",
                                isToday && "ring-1 ring-line-strong",
                              )}
                              style={
                                hit
                                  ? { backgroundColor: habit.color }
                                  : undefined
                              }
                            />
                          );
                        })}
                      </div>

                      <div className="flex items-center gap-2">
                        {habit.today.completed && !isArchived ? (
                          <Badge variant="lime" className="gap-1">
                            <Flame aria-hidden className="size-2.5" />
                            Done
                          </Badge>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          // Matches the icon and the handler below: a rotated
                          // icon on an archived habit restores it, and the plain
                          // archive icon archives an active one. Labelling these
                          // by current state instead had screen readers announce
                          // the opposite of the action.
                          aria-label={
                            isArchived
                              ? `Restore ${habit.name}`
                              : `Archive ${habit.name}`
                          }
                          onClick={() => (isArchived ? restore(habit) : archive(habit))}
                        >
                          {isArchived ? (
                            <RotateCcw aria-hidden />
                          ) : (
                            <Archive aria-hidden />
                          )}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <HabitComposer
        open={composerOpen}
        onOpenChange={setComposerOpen}
        onCreated={() => router.refresh()}
      />
    </div>
  );
}

const PRESET_COLORS = ["#C8F751", "#7C6BFF", "#4ECDC4", "#FFB020", "#FF6B6B", "#5BA8FF"];

function HabitComposer({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <HabitForm
          onCancel={() => onOpenChange(false)}
          onCreated={() => {
            onCreated();
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function HabitForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState("BOOLEAN");
  const [targetValue, setTargetValue] = React.useState("1");
  const [unit, setUnit] = React.useState("");
  const [frequency, setFrequency] = React.useState("DAILY");
  const [daysOfWeek, setDaysOfWeek] = React.useState<number[]>([1, 2, 3, 4, 5]);
  const [color, setColor] = React.useState(PRESET_COLORS[0]!);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);

  const isCount = type !== "BOOLEAN";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    try {
      await api.post("/api/v1/habits", {
        name: name.trim(),
        type,
        color,
        frequency,
        // A BOOLEAN habit is a yes/no; the target is always exactly one and the
        // unit is meaningless, so sending anything else would only store noise.
        targetValue: isCount ? Number(targetValue) || 1 : 1,
        unit: isCount && unit.trim() ? unit.trim() : null,
        daysOfWeek: frequency === "CUSTOM" ? daysOfWeek : [],
        // The schema requires a start date; today is the only sensible default
        // and matches what the list shows.
        startDate: new Date().toISOString(),
      });
      toast.success("Habit added.");
      onCreated();
    } catch (error) {
      setErrors(
        error instanceof ApiClientError
          ? { ...error.fieldErrors, form: error.message }
          : { form: "Could not save that habit." },
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>New habit</DialogTitle>
        <DialogDescription>
          Start with something you already do most days.
        </DialogDescription>
      </DialogHeader>

      <Field
        label="Habit"
        name="name"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
        placeholder="Drink water"
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="habit-type"
            className="text-[13px] font-medium text-ink-muted"
          >
            Tracked as
          </label>
          <select
            id="habit-type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="h-9 rounded-control border border-line bg-canvas px-2.5 text-[13px] outline-none focus:border-lime"
          >
            <option value="BOOLEAN">Did or did not</option>
            <option value="COUNT">A count</option>
            <option value="DURATION">Minutes</option>
            <option value="DISTANCE">Distance</option>
            <option value="QUANTITY">Quantity</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="habit-frequency"
            className="text-[13px] font-medium text-ink-muted"
          >
            Repeats
          </label>
          <select
            id="habit-frequency"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
            className="h-9 rounded-control border border-line bg-canvas px-2.5 text-[13px] outline-none focus:border-lime"
          >
            <option value="DAILY">Every day</option>
            <option value="WEEKLY">Once a week</option>
            <option value="CUSTOM">Certain days</option>
          </select>
        </div>
      </div>

      {isCount ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Daily target"
            type="number"
            name="targetValue"
            min={1}
            step="any"
            value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
            error={errors.targetValue}
          />
          <Field
            label="Unit"
            name="unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="pages"
            hint="Optional"
          />
        </div>
      ) : null}

      {frequency === "CUSTOM" ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-muted">On these days</span>
          <div className="flex gap-1.5">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => (
              <button
                key={day}
                type="button"
                aria-pressed={daysOfWeek.includes(index)}
                aria-label={day}
                onClick={() =>
                  setDaysOfWeek((current) =>
                    current.includes(index)
                      ? current.filter((d) => d !== index)
                      : [...current, index].sort((a, b) => a - b),
                  )
                }
                className={cn(
                  "h-8 flex-1 rounded-control border text-[12px] font-medium transition-colors",
                  daysOfWeek.includes(index)
                    ? "border-lime bg-lime-soft text-ink"
                    : "border-line text-ink-muted hover:bg-surface-2",
                )}
              >
                {day[0]}
              </button>
            ))}
          </div>
          {daysOfWeek.length === 0 ? (
            <p className="text-[12px] text-negative">Pick at least one day.</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-muted">Colour</span>
        <div className="flex gap-1.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Use colour ${c}`}
              aria-pressed={color === c}
              className={cn(
                "size-7 rounded-full border-2 transition-transform",
                color === c ? "border-ink scale-110" : "border-transparent",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      {errors.form ? (
        <p
          role="alert"
          className="rounded-control border border-negative/30 bg-negative/8 px-3 py-2.5 text-[13px] text-negative"
        >
          {errors.form}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="lime" loading={pending}>
          Add habit
        </Button>
      </DialogFooter>
    </form>
  );
}
