"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarDays,
  Check,
  Flag,
  FolderKanban,
  Loader2,
  Plus,
  Search,
  Target,
  Trash2,
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
import { formatFocusSeconds } from "@/lib/format/duration";
import { formatLocalDayMonth } from "@/lib/format/date";
import { cn } from "@/lib/utils";

/**
 * The task list.
 *
 * Completion is optimistic: the row strikes through immediately and is reverted
 * if the request fails. A checkbox that waits for a round trip feels broken even
 * when the write succeeds in 40ms, and the failure path is rare enough that the
 * revert costs less than the perceived latency.
 *
 * `useOptimistic` is deliberately not used. It requires the mutation to be
 * wrapped in a transition that React owns, which fights the `router.refresh()`
 * below; a local copy plus an explicit revert is easier to reason about and
 * behaves identically here.
 */

export interface TaskRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  importance: number;
  urgency: number;
  dueAt: string | null;
  completedAt: string | null;
  estimatedMinutes: number | null;
  createdAt: string;
  category: { id: string; name: string; color: string } | null;
  goal: { id: string; title: string } | null;
  /**
   * Projects this task is linked to. A task can sit in more than one, which is
   * why this is a list rather than a single field — collapsing it to one would
   * silently drop a real link depending on row order.
   */
  projects?: { id: string; name: string }[];
  /** Focus time actually spent on this task, across all sessions. */
  focusSeconds?: number;
  /** When it was last worked on, or null if it never has been. */
  lastFocusAt?: string | null;
  subtaskCount?: number;
}

const FILTERS = [
  { value: "open", label: "Open", statuses: ["TODO", "IN_PROGRESS", "BLOCKED"] },
  { value: "today", label: "Today", statuses: ["TODO", "IN_PROGRESS", "BLOCKED"] },
  { value: "done", label: "Done", statuses: ["DONE"] },
  { value: "all", label: "All", statuses: null },
] as const;

type FilterValue = (typeof FILTERS)[number]["value"];

const PRIORITY_TONE: Record<string, string> = {
  URGENT: "text-negative",
  HIGH: "text-warning",
  MEDIUM: "text-ink-muted",
  LOW: "text-ink-subtle",
};

function formatDue(iso: string | null): string | null {
  if (!iso) return null;
  const due = new Date(iso);
  const now = new Date();
  const days = Math.round(
    (due.setHours(0, 0, 0, 0) - now.setHours(0, 0, 0, 0)) / 86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days <= 7) return `In ${days}d`;
  return formatLocalDayMonth(due);
}

export function TaskList({
  initialTasks,
  total,
  doneTotal,
  categories,
}: {
  initialTasks: TaskRow[];
  total: number;
  doneTotal: number;
  categories: { id: string; name: string; color: string }[];
}) {
  const router = useRouter();
  const [tasks, setTasks] = React.useState(initialTasks);
  const [filter, setFilter] = React.useState<FilterValue>("open");
  const [search, setSearch] = React.useState("");
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [composerOpen, setComposerOpen] = React.useState(false);

  /**
   * A `router.refresh()` delivers new server truth as a new `initialTasks`
   * array, and the optimistic local copy has to yield to it. React's documented
   * way to reset state from a prop is to adjust during render rather than in an
   * effect, which avoids committing the stale list for a frame first.
   */
  const [syncedFrom, setSyncedFrom] = React.useState(initialTasks);
  if (syncedFrom !== initialTasks) {
    setSyncedFrom(initialTasks);
    setTasks(initialTasks);
  }

  const visible = React.useMemo(() => {
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;

    return tasks.filter((task) => {
      if (filter === "done" && task.status !== "DONE") return false;
      if (filter === "open" && task.status === "DONE") return false;
      if (filter === "today") {
        if (task.status === "DONE") return false;
        if (!task.dueAt) return false;
        const d = new Date(task.dueAt);
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        // Overdue work still belongs on a "today" list; that is the point.
        if (key !== todayKey && d.getTime() > now.getTime()) return false;
      }
      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        if (!task.title.toLowerCase().includes(needle)) return false;
      }
      return true;
    });
  }, [tasks, filter, search]);

  async function toggle(task: TaskRow) {
    const done = task.status === "DONE";
    const before = tasks;
    setBusyId(task.id);
    setTasks((list) =>
      list.map((t) =>
        t.id === task.id
          ? {
              ...t,
              status: done ? "TODO" : "DONE",
              completedAt: done ? null : new Date().toISOString(),
            }
          : t,
      ),
    );

    try {
      await api.patch(`/api/v1/tasks/${task.id}`, { status: done ? "TODO" : "DONE" });
      router.refresh();
    } catch (error) {
      setTasks(before);
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not update that task.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function remove(task: TaskRow) {
    const before = tasks;
    setTasks((list) => list.filter((t) => t.id !== task.id));
    try {
      const result = await api.delete<{ deleted: boolean; archived: boolean }>(
        `/api/v1/tasks/${task.id}`,
      );
      toast.success(
        result.archived
          ? "Archived instead of deleted — it had subtasks or logged time."
          : "Task deleted.",
      );
      router.refresh();
    } catch (error) {
      setTasks(before);
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not delete that task.",
      );
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Filter tasks"
          className="flex gap-1 rounded-control border border-line bg-surface p-0.5"
        >
          {FILTERS.map((f) => {
            // Counts come from the server rather than the loaded slice: the
            // slice is capped, so counting it would report "300" for a list
            // holding thousands and would make the tabs look broken rather than
            // truncated. A tab that says "Done 0" when 92 exist is worse than
            // no tab at all, which is why these are never derived here.
            const count = f.value === "done" ? doneTotal : f.value === "open" ? total : null;
            return (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={filter === f.value}
                onClick={() => setFilter(f.value)}
                className={cn(
                  "h-7 rounded-[7px] px-2.5 text-[13px] font-medium transition-colors",
                  filter === f.value
                    ? "bg-surface-2 text-ink"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                {f.label}
                {count === null ? null : (
                  <span className="ml-1.5 text-[11px] text-ink-subtle">{count}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="relative min-w-0 flex-1 sm:max-w-56">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-subtle"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by title"
            aria-label="Filter tasks by title"
            className="h-8 w-full rounded-control border border-line bg-surface pl-8 pr-2.5 text-[13px] outline-none focus:border-lime"
          />
        </div>

        <Button variant="lime" size="sm" onClick={() => setComposerOpen(true)} className="ml-auto">
          <Plus aria-hidden />
          New task
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4">
          {visible.length === 0 ? (
            <EmptyState
              icon={search ? Search : Check}
              title={search ? "Nothing matches" : "Nothing here"}
              description={
                search
                  ? `No task title contains “${search.trim()}”.`
                  : filter === "done"
                    ? "Tasks you complete will collect here."
                    : filter === "today"
                      ? "Nothing is due today, and nothing is overdue."
                      : "Capture something and it will show up on your dashboard."
              }
              action={
                // Offering "Add a task" on an empty Done list is a dead end —
                // a new task is not a completed one, so the list stays empty.
                search || filter === "done"
                  ? undefined
                  : { label: "Add a task", onClick: () => setComposerOpen(true) }
              }
            />
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {visible.map((task) => {
                const done = task.status === "DONE";
                const due = formatDue(task.dueAt);
                const overdue = due?.endsWith("overdue");
                return (
                  <li key={task.id} className="group flex items-start gap-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggle(task)}
                      disabled={busyId === task.id}
                      aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
                      aria-pressed={done}
                      className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-[6px] border border-line-strong text-transparent transition-colors hover:border-lime hover:text-lime disabled:opacity-50 aria-pressed:border-lime aria-pressed:bg-lime aria-pressed:text-ink-inverse"
                    >
                      {busyId === task.id ? (
                        <Loader2 aria-hidden className="size-3 animate-spin" />
                      ) : (
                        <Check aria-hidden className="size-3" />
                      )}
                    </button>

                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-[14px] leading-snug",
                          done ? "text-ink-subtle line-through" : "text-ink",
                        )}
                      >
                        {task.title}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {task.category ? (
                          <Badge
                            variant="outline"
                            className="gap-1 text-[10px]"
                            style={{ borderColor: task.category.color }}
                          >
                            <span
                              aria-hidden
                              className="size-1.5 rounded-full"
                              style={{ backgroundColor: task.category.color }}
                            />
                            {task.category.name}
                          </Badge>
                        ) : null}
                        {due ? (
                          <Badge
                            variant={overdue ? "coral" : "outline"}
                            className="gap-1 text-[10px]"
                          >
                            <CalendarDays aria-hidden className="size-2.5" />
                            {due}
                          </Badge>
                        ) : null}
                        {task.subtaskCount ? (
                          <span className="text-[11px] text-ink-subtle">
                            {task.subtaskCount} subtask{task.subtaskCount === 1 ? "" : "s"}
                          </span>
                        ) : null}
                        {/* Where this task sits in the hierarchy, so the answer to
                            "which project is this for?" is on the row rather than
                            one click away. Focus time sits alongside it because
                            "0m logged" on a task you have been staring at is
                            itself the useful signal. */}
                        {task.projects?.map((p) => (
                          <Link
                            key={p.id}
                            href={`/projects?project=${p.id}`}
                            className="rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime/40"
                          >
                            <Badge
                              variant="outline"
                              className="gap-1 text-[10px] hover:border-line-strong hover:text-ink"
                            >
                              <FolderKanban aria-hidden className="size-2.5" />
                              {p.name}
                            </Badge>
                          </Link>
                        ))}
                        {task.goal ? (
                          <Link
                            href={`/goals?goal=${task.goal.id}`}
                            className="rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime/40"
                          >
                            <Badge
                              variant="outline"
                              className="gap-1 text-[10px] hover:border-line-strong hover:text-ink"
                            >
                              <Target aria-hidden className="size-2.5" />
                              {task.goal.title}
                            </Badge>
                          </Link>
                        ) : null}
                        {task.focusSeconds ? (
                          <span
                            className="text-[11px] text-ink-subtle"
                            title={
                              task.lastFocusAt
                                ? `Last focused ${task.lastFocusAt.slice(0, 10)}`
                                : undefined
                            }
                          >
                            {formatFocusSeconds(task.focusSeconds)} focused
                          </span>
                        ) : null}
                        {task.estimatedMinutes ? (
                          <span className="text-[11px] text-ink-subtle">
                            {task.estimatedMinutes}m
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <span
                      className={cn(
                        "mt-0.5 shrink-0 text-[11px] font-medium",
                        PRIORITY_TONE[task.priority] ?? "text-ink-subtle",
                      )}
                    >
                      <Flag aria-hidden className="size-3" />
                    </span>

                    <button
                      type="button"
                      onClick={() => remove(task)}
                      aria-label={`Delete ${task.title}`}
                      className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-control text-ink-subtle opacity-0 transition-opacity hover:text-negative focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 aria-hidden className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-[12px] text-ink-subtle">
        {visible.length} shown{total > visible.length ? ` of ${total}` : ""}
      </p>

      <TaskComposer
        open={composerOpen}
        onOpenChange={setComposerOpen}
        categories={categories}
        onCreated={(task) => {
          setTasks((list) => [task, ...list]);
          router.refresh();
        }}
      />
    </div>
  );
}

/**
 * The composer dialog.
 *
 * The form lives in `TaskForm`, which Radix mounts only while the dialog is
 * open. That is what clears a half-written draft between openings — no reset
 * effect, and no window where the fields briefly show yesterday's values.
 */
function TaskComposer({
  open,
  onOpenChange,
  categories,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: { id: string; name: string; color: string }[];
  onCreated: (task: TaskRow) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <TaskForm
          categories={categories}
          onCancel={() => onOpenChange(false)}
          onCreated={onCreated}
        />
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({
  categories,
  onCancel,
  onCreated,
}: {
  categories: { id: string; name: string; color: string }[];
  onCancel: () => void;
  onCreated: (task: TaskRow) => void;
}) {
  const [title, setTitle] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [priority, setPriority] = React.useState("MEDIUM");
  const [dueAt, setDueAt] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    try {
      const task = await api.post<TaskRow>("/api/v1/tasks", {
        title: title.trim(),
        priority,
        categoryId: categoryId || null,
        // A date input gives `YYYY-MM-DD`; Prisma wants a real instant, and
        // anchoring it to noon avoids the task landing on the previous day for
        // anyone west of UTC.
        dueAt: dueAt ? new Date(`${dueAt}T12:00:00`).toISOString() : null,
      });
      toast.success("Task added.");
      onCreated({ ...task, createdAt: new Date().toISOString() });
      onCancel();
    } catch (error) {
      setErrors(
        error instanceof ApiClientError
          ? { ...error.fieldErrors, form: error.message }
          : { form: "Could not save that task." },
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>New task</DialogTitle>
        <DialogDescription>
          Just the title is required. Everything else can wait.
        </DialogDescription>
      </DialogHeader>

      <Field
        label="What needs doing?"
        name="title"
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        error={errors.title}
        placeholder="Draft the Q3 review"
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="task-category"
            className="text-[13px] font-medium text-ink-muted"
          >
            Category
          </label>
          <select
            id="task-category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="h-9 rounded-control border border-line bg-canvas px-2.5 text-[13px] outline-none focus:border-lime"
          >
            <option value="">None</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="task-priority"
            className="text-[13px] font-medium text-ink-muted"
          >
            Priority
          </label>
          <select
            id="task-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="h-9 rounded-control border border-line bg-canvas px-2.5 text-[13px] outline-none focus:border-lime"
          >
            {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => (
              <option key={p} value={p}>
                {p[0] + p.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Field
        label="Due date"
        type="date"
        name="dueAt"
        value={dueAt}
        onChange={(e) => setDueAt(e.target.value)}
        error={errors.dueAt}
      />

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
          Add task
        </Button>
      </DialogFooter>
    </form>
  );
}
