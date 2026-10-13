"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarPlus,
  Clock,
  Lock,
  Plus,
  Trash2,
} from "lucide-react";

import { Field } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/primitives";
import { Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/feedback/empty-state";
import { toast } from "sonner";
import { api, ApiClientError } from "@/lib/api/client";
import {
  DAY_START_MINUTES,
  MAX_BLOCK_MINUTES,
  MIN_BLOCK_MINUTES,
  WORKDAY_START_MINUTES,
  dayTotals,
  findFreeSlots,
  firstFreeSlot,
  formatClock,
  formatDuration,
  fromTimeValue,
  layoutColumns,
  snapToQuarter,
  toTimeValue,
} from "@/lib/planner/layout";
import { dateOnlyLocal } from "@/lib/date";
import { formatIndianLong, formatIndianShort, formatWeekdayShort, indianWeek } from "@/lib/format/date";
import { cn } from "@/lib/utils";

/**
 * The planner.
 *
 * A day view of `TimeBlock`s, plus the unscheduled work that could fill it. The
 * two halves matter together: a timeline with nothing in it is a blank grid, and
 * a task list with no times is the `/tasks` page. The planner's job is the join —
 * "you have four hours free and these six tasks are not on the calendar yet".
 *
 * Deliberately no drag-and-drop. Moving a block by dragging looks better in a
 * demo, but with overlap detection turned on it is a worse editor than clicking:
 * every drop is a conflict decision, and a drag that silently refuses to land is
 * more confusing than a form that tells you which block is in the way. Clicking
 * an empty slot, or scheduling a task from the tray, gets to the same place with
 * a readable outcome. A drag affordance is a reasonable follow-up once blocks
 * can overlap deliberately.
 */

export interface PlannerBlock {
  id: string;
  title: string;
  date: string;
  startAt: string;
  endAt: string;
  startMinutes: number;
  endMinutes: number;
  source: "AI" | "MANUAL" | "ROUTINE" | "CALENDAR" | "FOCUS";
  color: string;
  notes: string | null;
  locked: boolean;
  taskId: string | null;
  habitId: string | null;
  task: { id: string; title: string; status: string } | null;
  habit: { id: string; name: string; color: string } | null;
}

export interface PlannerTask {
  id: string;
  title: string;
  estimatedMinutes: number | null;
  priority: string;
}

/** Minutes of vertical space per minute of the day. 1080 minutes => ~1300px. */
const PX_PER_MINUTE = 1.2;

const DURATION_PRESETS = [15, 30, 45, 60, 90, 120];

/** `yyyy-mm-dd` for a Date on the local calendar, the form every API here uses. */
function toIsoDay(date: Date): string {
  const d = dateOnlyLocal(date);
  return d.toISOString().slice(0, 10);
}

function fromIsoDay(isoDay: string): Date {
  const [y, m, d] = isoDay.split("-").map(Number) as [number, number, number];
  // Local noon, so the rendered day cannot shift under a date arithmetic step.
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function shiftIsoDay(isoDay: string, days: number): string {
  const current = fromIsoDay(isoDay);
  current.setDate(current.getDate() + days);
  return toIsoDay(current);
}

/** Minutes from midnight for "now", used to draw the current-time marker. */
function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function PlannerDay({
  initialBlocks,
  initialDate,
  initialTasks,
}: {
  initialBlocks: PlannerBlock[];
  initialDate: string;
  initialTasks: PlannerTask[];
}) {
  const router = useRouter();
  const [blocks, setBlocks] = React.useState(initialBlocks);
  const [date, setDate] = React.useState(initialDate);
  const [loading, setLoading] = React.useState(false);
  const [dialog, setDialog] = React.useState<DialogState | null>(null);

  /**
   * `router.refresh()` hands back a new `initialBlocks` array; the local copy has
   * to yield to it, adjusted during render rather than in an effect so the stale
   * day is never committed for a frame. Same pattern as `task-list`.
   */
  const [syncedBlocks, setSyncedBlocks] = React.useState(initialBlocks);
  if (syncedBlocks !== initialBlocks) {
    setSyncedBlocks(initialBlocks);
    setBlocks(initialBlocks);
  }

  const today = toIsoDay(new Date());
  const isToday = date === today;
  const dayDate = fromIsoDay(date);

  async function goTo(next: string) {
    if (next === date) return;
    setLoading(true);
    setDate(next);
    try {
      const result = await api.get<{ items: PlannerBlock[] }>(
        `/api/v1/time-blocks?from=${next}`,
      );
      setBlocks(result.items);
    } catch {
      toast.error("Could not load that day.");
      // Put the date back so the header and the grid never disagree.
      setDate(date);
    } finally {
      setLoading(false);
    }
  }

  const positioned = React.useMemo(() => layoutColumns(blocks), [blocks]);
  const totals = React.useMemo(
    () =>
      dayTotals(
        blocks.map((b) => ({ startMinutes: b.startMinutes, endMinutes: b.endMinutes })),
      ),
    [blocks],
  );
  const hasConflict = totals.bookedMinutes > totals.plannedMinutes;

  const scheduledTaskIds = React.useMemo(
    () => new Set(blocks.map((b) => b.taskId).filter((id): id is string => Boolean(id))),
    [blocks],
  );

  /**
   * A "schedule this" default. For today the search starts at the next quarter
   * hour after now, because offering someone a slot two hours in the past is
   * technically valid and practically useless.
   */
  function defaultStartFor(durationMinutes: number): number {
    const from = isToday
      ? Math.max(WORKDAY_START_MINUTES, snapToQuarter(nowMinutes()))
      : WORKDAY_START_MINUTES;
    const start = firstFreeSlot(
      blocks.map((b) => ({ startMinutes: b.startMinutes, endMinutes: b.endMinutes })),
      durationMinutes,
      { fromMinutes: from },
    );
    // Fall back to the window start rather than null: a full day should still
    // open the form, and the server's conflict check gives the real answer.
    return start ?? DAY_START_MINUTES;
  }

  function openCreate(startMinutes?: number) {
    const start = startMinutes ?? defaultStartFor(60);
    setDialog({
      mode: "create",
      title: "",
      date,
      startMinutes: start,
      durationMinutes: 60,
      notes: "",
      locked: false,
      taskId: null,
      blockId: null,
    });
  }

  function openEdit(block: PlannerBlock) {
    setDialog({
      mode: "edit",
      title: block.title,
      date: block.date,
      startMinutes: block.startMinutes,
      durationMinutes: Math.max(block.endMinutes - block.startMinutes, 5),
      notes: block.notes ?? "",
      locked: block.locked,
      taskId: block.taskId,
      blockId: block.id,
    });
  }

  function scheduleTask(task: PlannerTask) {
    const duration = snapToQuarter(task.estimatedMinutes ?? 30) || 30;
    setDialog({
      mode: "create",
      title: task.title,
      date,
      startMinutes: defaultStartFor(duration),
      durationMinutes: duration,
      notes: "",
      locked: false,
      taskId: task.id,
      blockId: null,
    });
  }

  async function remove(block: PlannerBlock) {
    const before = blocks;
    setBlocks((list) => list.filter((b) => b.id !== block.id));
    try {
      await api.delete(`/api/v1/time-blocks/${block.id}`);
      toast.success("Block removed.");
      router.refresh();
    } catch (error) {
      setBlocks(before);
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not remove that block.",
      );
    }
  }

  const unscheduled = initialTasks.filter((t) => !scheduledTaskIds.has(t.id));
  const week = indianWeek(dayDate);
  const nowOffset = isToday ? nowMinutes() - DAY_START_MINUTES : null;

  /**
   * Blocks before 06:00 are real and the seed produces them — a routine that
   * starts at 00:30, an early shift. The grid cannot draw them, and clamping them
   * to the top of the window would render 00:30 *as though it were 06:00*, which
   * is the planner quietly lying about the one thing it exists to lay out. They
   * get their own list above the grid instead, so nothing is hidden and nothing
   * is mislabelled.
   */
  const earlyBlocks = blocks.filter((b) => b.startMinutes < DAY_START_MINUTES);
  const earlyMinutes = earlyBlocks.reduce(
    (sum, b) => sum + (b.endMinutes - b.startMinutes),
    0,
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">Planner</h1>
            <p className="mt-1 text-[13px] text-ink-muted">
              {formatIndianLong(dayDate)}
              {isToday ? " · today" : ""}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void goTo(shiftIsoDay(date, -1))}
              aria-label="Previous day"
            >
              <ArrowLeft aria-hidden />
              <span className="sr-only sm:not-sr-only">Prev</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isToday}
              onClick={() => void goTo(today)}
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void goTo(shiftIsoDay(date, 1))}
              aria-label="Next day"
            >
              <span className="sr-only sm:not-sr-only">Next</span>
              <ArrowRight aria-hidden />
            </Button>
            <Button variant="lime" size="sm" onClick={() => openCreate()}>
              <Plus aria-hidden />
              Add block
            </Button>
          </div>
        </div>

        {/*
          The week strip is a day picker here, unlike the read-only habit strip
          on the dashboard: every cell is a button, the current one is marked
          `aria-current`, and cells outside the current week go to that week's
          own days rather than doing nothing.
        */}
        <ol className="grid grid-cols-7 gap-1.5" aria-label="Pick a day">
          {week.map((day) => {
            const iso = toIsoDay(day);
            const active = iso === date;
            const future = iso > today;
            return (
              <li key={iso}>
                <button
                  type="button"
                  onClick={() => void goTo(iso)}
                  aria-current={active ? "date" : undefined}
                  className={cn(
                    "flex w-full flex-col items-center gap-0.5 rounded-control border px-1 py-2 text-[12px] transition-colors",
                    active
                      ? "border-lime bg-lime/8 text-ink"
                      : "border-line bg-surface text-ink-muted hover:bg-surface-2",
                    future && !active && "opacity-55",
                  )}
                >
                  <span className="text-[10px] tracking-wide uppercase opacity-80">
                    {formatWeekdayShort(day)}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatIndianShort(day)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Summary
          label="Planned"
          value={formatDuration(totals.plannedMinutes)}
          hint={`${totals.blockCount} block${totals.blockCount === 1 ? "" : "s"}`}
        />
        <Summary
          label="Day covered"
          value={`${totals.coveragePercent}%`}
          hint={`of 24 hours`}
        />
        <Summary
          label="Longest gap"
          value={formatDuration(totals.longestGapMinutes)}
          hint="free, unscheduled"
        />
        <Summary
          label="Unscheduled"
          value={String(unscheduled.length)}
          hint={unscheduled.length === 1 ? "task to place" : "tasks to place"}
          tone={unscheduled.length > 0 ? "iris" : "neutral"}
        />
      </section>

      {/*
        `bookedMinutes` exceeding `plannedMinutes` is only possible when blocks
        overlap, which the API refuses to create. It is shown rather than
        swallowed because the data can still arrive that way from an external
        calendar, and silently drawing a double-booked day as fine is the one
        thing a planner must not do.
      */}
      {hasConflict ? (
        <p
          role="status"
          className="rounded-control border border-negative/40 bg-negative/8 px-3 py-2 text-[13px] text-negative"
        >
          This day is double-booked by {formatDuration(totals.bookedMinutes - totals.plannedMinutes)}.
          Two blocks are claiming the same time.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-[13px]">
              {isToday ? "Today" : formatIndianLong(dayDate).split(",")[0]}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {blocks.length === 0 ? (
              <EmptyState
                icon={CalendarPlus}
                title="Nothing planned"
                description="Click a time in the grid, or schedule a task from the list."
              />
            ) : null}

            {earlyBlocks.length > 0 ? (
              <div className="mb-3 rounded-control border border-line bg-surface-2 px-3 py-2">
                <p className="text-[11px] tracking-wide text-ink-subtle uppercase">
                  Before 6:00 AM · {formatDuration(earlyMinutes)}
                </p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {earlyBlocks.map((block) => (
                    <li key={block.id} className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12px]">{block.title}</span>
                      <span className="shrink-0 text-[11px] text-ink-subtle tabular-nums">
                        {formatClock(block.startMinutes)} – {formatClock(block.endMinutes)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div
              className={cn(
                "relative",
                loading && "pointer-events-none opacity-50",
              )}
              onClick={(event) => {
                // Only an empty click on the grid itself opens the composer;
                // clicks on a block are handled by the block.
                if (event.target !== event.currentTarget) return;
                const rect = event.currentTarget.getBoundingClientRect();
                const minutes =
                  DAY_START_MINUTES +
                  Math.round((event.clientY - rect.top) / PX_PER_MINUTE / 15) * 15;
                openCreate(Math.min(Math.max(minutes, DAY_START_MINUTES), 1425));
              }}
            >
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="relative border-t border-line"
                  style={{ height: 60 * PX_PER_MINUTE }}
                >
                  <span className="absolute -top-2 right-2 bg-surface px-1 text-[10px] text-ink-subtle tabular-nums">
                    {formatClock(hour * 60)}
                  </span>
                </div>
              ))}

              {nowOffset !== null && nowOffset > 0 ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 z-20 border-t border-lime"
                  style={{ top: nowOffset * PX_PER_MINUTE }}
                >
                  <span className="absolute -left-1 -top-1 size-2 rounded-full bg-lime" />
                </div>
              ) : null}

              {blocks.map((block) => {
                const pos = positioned.get(block.id);
                if (!pos) return null;
                return (
                  <BlockChip
                    key={block.id}
                    block={block}
                    position={pos}
                    onEdit={() => openEdit(block)}
                    onDelete={() => void remove(block)}
                  />
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-[13px]">Unscheduled</CardTitle>
            <p className="text-[12px] text-ink-subtle">
              Open tasks with no block yet.
            </p>
          </CardHeader>
          <CardContent>
            {unscheduled.length === 0 ? (
              <EmptyState
                icon={Clock}
                title="Everything has a slot"
                description="Every open task you estimated already has a time."
              />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {unscheduled.map((task) => {
                  const duration = task.estimatedMinutes;
                  const fit = firstFreeSlot(
                    blocks.map((b) => ({
                      startMinutes: b.startMinutes,
                      endMinutes: b.endMinutes,
                    })),
                    snapToQuarter(duration ?? 30) || 30,
                    {
                      fromMinutes: isToday
                        ? Math.max(WORKDAY_START_MINUTES, snapToQuarter(nowMinutes()))
                        : WORKDAY_START_MINUTES,
                    },
                  );
                  return (
                    <li key={task.id}>
                      <button
                        type="button"
                        onClick={() => scheduleTask(task)}
                        className="flex w-full items-center justify-between gap-2 rounded-control border border-line bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-2"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium">
                            {task.title}
                          </span>
                          <span className="block text-[11px] text-ink-subtle">
                            {duration
                              ? `${formatDuration(duration)} est.`
                              : "No estimate"}{" "}
                            ·{" "}
                            {fit === null
                              ? "no room left"
                              : `fits at ${formatClock(fit)}`}
                          </span>
                        </span>
                        <Plus aria-hidden className="size-4 shrink-0 text-ink-subtle" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {dialog ? (
        <BlockDialog
          state={dialog}
          busySlots={findFreeSlots(
            blocks.map((b) => ({ startMinutes: b.startMinutes, endMinutes: b.endMinutes })),
            dialog.durationMinutes,
            { fromMinutes: DAY_START_MINUTES },
          )}
          onCancel={() => setDialog(null)}
          onDeleted={(blockId) => {
            setBlocks((list) => list.filter((b) => b.id !== blockId));
            setDialog(null);
            toast.success("Block removed.");
            router.refresh();
          }}
          onSaved={(saved) => {
            setBlocks((list) => {
              const rest = list.filter((b) => b.id !== saved.id);
              return [...rest, saved].sort((a, b) => a.startMinutes - b.startMinutes);
            });
            setDialog(null);
            toast.success(dialog.mode === "edit" ? "Block updated." : "Block added.");
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

interface DialogState {
  mode: "create" | "edit";
  title: string;
  date: string;
  startMinutes: number;
  durationMinutes: number;
  notes: string;
  locked: boolean;
  taskId: string | null;
  blockId: string | null;
}

const HOURS = Array.from({ length: 24 - DAY_START_MINUTES / 60 }, (_, i) => DAY_START_MINUTES / 60 + i);

function Summary({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "neutral" | "iris";
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-[11px] tracking-wide text-ink-subtle uppercase">{label}</p>
        <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
        <p className={cn("text-[11px]", tone === "iris" ? "text-iris" : "text-ink-subtle")}>
          {hint}
        </p>
      </CardContent>
    </Card>
  );
}

function BlockChip({
  block,
  position,
  onEdit,
  onDelete,
}: {
  block: PlannerBlock;
  position: { column: number; columnCount: number; topMinutes: number; heightMinutes: number };
  onEdit: () => void;
  onDelete: () => void;
}) {
  const width = 100 / position.columnCount;
  return (
    <div
      className="absolute z-10 px-1"
      style={{
        top: position.topMinutes * PX_PER_MINUTE,
        height: position.heightMinutes * PX_PER_MINUTE,
        left: `${position.column * width}%`,
        width: `${width}%`,
      }}
    >
      <div
        className="flex h-full min-h-0 flex-col overflow-hidden rounded-[8px] border-l-[3px] bg-surface-2 px-2 py-1.5 shadow-card"
        style={{ borderLeftColor: block.color }}
      >
        <div className="flex items-start justify-between gap-1">
          <span className="truncate text-[12px] font-medium">{block.title}</span>
          {block.locked ? (
            <Lock aria-hidden className="size-3 shrink-0 text-ink-subtle" />
          ) : null}
        </div>
        <span className="text-[10px] text-ink-subtle tabular-nums">
          {formatClock(block.startMinutes)} – {formatClock(block.endMinutes)}
        </span>
        {block.task ? (
          <span className="truncate text-[10px] text-ink-subtle">{block.task.title}</span>
        ) : null}
        {position.heightMinutes >= 45 ? (
          <span className="mt-auto flex gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={onEdit}
              className="h-6 px-1.5 text-[11px]"
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={onDelete}
              aria-label={`Delete ${block.title}`}
              className="h-6 px-1.5 text-[11px]"
            >
              <Trash2 aria-hidden className="size-3" />
            </Button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function BlockDialog({
  state,
  busySlots,
  onCancel,
  onDeleted,
  onSaved,
}: {
  state: DialogState;
  busySlots: number[];
  onCancel: () => void;
  onDeleted: (blockId: string) => void;
  onSaved: (block: PlannerBlock) => void;
}) {
  const [title, setTitle] = React.useState(state.title);
  const [date, setDate] = React.useState(state.date);
  const [startMinutes, setStartMinutes] = React.useState(state.startMinutes);
  const [endMinutes, setEndMinutes] = React.useState(() =>
    Math.min(state.startMinutes + state.durationMinutes, 1439),
  );
  const [notes, setNotes] = React.useState(state.notes);
  const [locked, setLocked] = React.useState(state.locked);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  /**
   * Delete is its own path rather than an `onSaved` with a partial block.
   * Reusing the save callback here would push a block-shaped object with no
   * times into the list, and the layout pass would then compute its position
   * from `undefined`.
   */
  async function destroy() {
    if (!state.blockId) return;
    setDeleting(true);
    try {
      await api.delete(`/api/v1/time-blocks/${state.blockId}`);
      onDeleted(state.blockId);
    } catch (error) {
      setErrors(
        error instanceof ApiClientError
          ? { form: error.message }
          : { form: "Could not remove that block." },
      );
    } finally {
      setDeleting(false);
    }
  }

  /** Nearest free start to what was chosen, used to warn before the server does. */
  const nearestFree = React.useMemo(() => {
    if (busySlots.length === 0) return null;
    return busySlots.reduce((best, slot) =>
      Math.abs(slot - startMinutes) < Math.abs(best - startMinutes) ? slot : best,
    );
  }, [busySlots, startMinutes]);

  const clashes = nearestFree !== null && nearestFree !== startMinutes && busySlots.length > 0
    ? Math.abs(nearestFree - startMinutes) < 15
    : false;

  /**
   * Moving the start preserves the block's length, but never lets the end drift
   * past midnight. The range checks are deliberate: the block cannot be longer
   * than a day, and "ends before it starts" is never a valid edit.
   */
  const duration = endMinutes - startMinutes;
  const rangeError =
    duration < MIN_BLOCK_MINUTES
      ? "Ends must be after starts."
      : duration > MAX_BLOCK_MINUTES
        ? "A block cannot be longer than 12 hours."
        : null;

  function changeStart(minutes: number | null) {
    if (minutes == null) return;
    setStartMinutes(minutes);
    setEndMinutes(Math.min(minutes + Math.max(duration, MIN_BLOCK_MINUTES), 1439));
  }

  function changeEnd(minutes: number | null) {
    if (minutes == null) return;
    setEndMinutes(minutes);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (rangeError) return;
    setPending(true);
    setErrors({});
    const payload = {
      title: title.trim(),
      date,
      startMinutes,
      durationMinutes: duration,
      notes: notes.trim() || null,
      locked,
      taskId: state.taskId,
    };
    try {
      const saved = await (state.mode === "edit" && state.blockId
        ? api.patch<PlannerBlock>(`/api/v1/time-blocks/${state.blockId}`, payload)
        : api.post<PlannerBlock>("/api/v1/time-blocks", payload));
      onSaved(saved);
    } catch (error) {
      setErrors(
        error instanceof ApiClientError
          ? { ...error.fieldErrors, form: error.message }
          : { form: "Could not save that block." },
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open && onCancel())}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{state.mode === "edit" ? "Edit block" : "New block"}</DialogTitle>
            <DialogDescription>
              {state.mode === "edit"
                ? "Change the time, the title, or both."
                : "A title and a time is enough."}
            </DialogDescription>
          </DialogHeader>

          <Field
            label="What is it?"
            name="title"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            error={errors.title}
            placeholder="Write the quarterly review"
          />

          <div className="grid grid-cols-2 gap-3">
            <Field
              className="col-span-2"
              label="Date"
              name="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              error={errors.date}
            />
            <Field
              label="Starts"
              name="start"
              type="time"
              value={toTimeValue(startMinutes)}
              onChange={(e) => changeStart(fromTimeValue(e.target.value))}
              error={errors.startMinutes}
            />
            <Field
              label="Ends"
              name="end"
              type="time"
              value={toTimeValue(endMinutes)}
              onChange={(e) => changeEnd(fromTimeValue(e.target.value))}
              error={rangeError ?? errors.durationMinutes}
            />
          </div>

          <div>
            <span className="text-[13px] font-medium text-ink-muted">How long</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {DURATION_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  size="xs"
                  variant={duration === preset ? "lime" : "outline"}
                  onClick={() => setEndMinutes(Math.min(startMinutes + preset, 1439))}
                >
                  {formatDuration(preset)}
                </Button>
              ))}
              <span className="self-center text-[12px] text-ink-subtle">
                {formatDuration(duration)} total
              </span>
            </div>
          </div>

          {/*
            A pre-emptive warning rather than a silent failure. The server rejects
            the overlap regardless, but telling the user which nearby slot is
            actually free saves a round trip and makes the constraint visible
            before they hit save.
          */}
          {clashes ? (
            <p
              role="status"
              className="rounded-control border border-iris/40 bg-iris/8 px-3 py-2 text-[12px] text-iris"
            >
              That time is taken. {formatClock(nearestFree!)} is free.
            </p>
          ) : null}

          <div>
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything to remember about this slot"
              className="mt-1.5"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="locked"
              type="checkbox"
              checked={locked}
              onChange={(e) => setLocked(e.target.checked)}
              className="size-4 accent-lime"
            />
            <Label htmlFor="locked" className="text-[13px]">
              Lock this slot
            </Label>
            <span className="text-[11px] text-ink-subtle">
              — keeps auto-scheduling from moving it
            </span>
          </div>

          {errors.form ? (
            <p role="alert" className="text-[13px] text-negative">
              {errors.form}
            </p>
          ) : null}

          <DialogFooter>
            {state.mode === "edit" && state.blockId ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => void destroy()}
                loading={deleting}
              >
                <Trash2 aria-hidden />
                Delete
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="lime" loading={pending}>
              {state.mode === "edit" ? "Save" : "Add block"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
