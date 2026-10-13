"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlarmClock,
  Bell,
  BellOff,
  BellRing,
  Check,
  CheckCheck,
  Flame,
  Plus,
  Repeat,
  Target,
  Trash2,
} from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
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
import { Input, Textarea } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/api/client";
import { isSameLocalDay } from "@/lib/date";
import { cn } from "@/lib/utils";

/**
 * Reminders and notifications.
 *
 * The unread mark is applied optimistically, because the one action a user takes
 * on a notification - "I've seen this" - should not make the list jump while the
 * request is in flight. A failed mark restores the row rather than silently
 * leaving the bell wrong.
 *
 * Reminder times are read and written as local time and never as UTC. A reminder
 * for the morning routine at 07:00 is 07:00 wherever the user happens to be when
 * the alert reaches them, and round-tripping it through UTC is how it ends up
 * arriving at 01:30 for someone in Chennai.
 */

export interface ScreenNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  actionUrl: string | null;
  read: boolean;
  createdAt: string;
}

export interface ScreenReminder {
  id: string;
  title: string;
  body: string | null;
  targetType: string;
  scheduledFor: string;
  recurrenceLabel: string;
}

export interface ScreenTask {
  id: string;
  title: string;
}

const TYPE_ICON: Record<string, typeof Bell> = {
  TASK: Target,
  HABIT: Repeat,
  GOAL: Flame,
  AI: Bell,
  SYSTEM: Bell,
  ACHIEVEMENT: Flame,
};

const REPEATS = [
  { value: "none", label: "Once" },
  { value: "DAILY", label: "Every day" },
  { value: "WEEKLY", label: "Every week" },
  { value: "MONTHLY", label: "Every month" },
] as const;

export function NotificationsScreen({
  notifications: initialNotifications,
  reminders: initialReminders,
  tasks,
  unreadCount: initialUnreadCount,
  figures,
}: {
  notifications: ScreenNotification[];
  reminders: ScreenReminder[];
  tasks: ScreenTask[];
  unreadCount: number;
  figures: { label: string; value: number; icon: "unread" | "reminders" }[];
}) {
  const router = useRouter();
  const [items, setItems] = React.useState(initialNotifications);
  const [unread, setUnread] = React.useState(initialUnreadCount);
  const [composing, setComposing] = React.useState(false);
  const hydrated = useHydrated();

  const [seen, setSeen] = React.useState(initialNotifications);
  if (seen !== initialNotifications) {
    setSeen(initialNotifications);
    setItems(initialNotifications);
  }
  const [unreadSeen, setUnreadSeen] = React.useState(initialUnreadCount);
  if (unreadSeen !== initialUnreadCount) {
    setUnreadSeen(initialUnreadCount);
    setUnread(initialUnreadCount);
  }

  async function markRead(item: ScreenNotification) {
    if (item.read) return;
    setItems((current) => current.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
    setUnread((n) => Math.max(0, n - 1));
    try {
      await api.patch("/api/v1/notifications", { ids: [item.id], read: true });
    } catch {
      setItems((current) => current.map((n) => (n.id === item.id ? { ...n, read: false } : n)));
      setUnread((n) => n + 1);
      toast.error("Could not mark that as read.");
    }
  }

  async function markAll() {
    const previous = items;
    setItems((current) => current.map((n) => ({ ...n, read: true })));
    setUnread(0);
    try {
      await api.patch("/api/v1/notifications", { all: true, read: true });
      toast.success("All caught up.");
    } catch {
      setItems(previous);
      setUnread(previous.filter((n) => !n.read).length);
      toast.error("Could not mark them as read.");
    }
  }

  async function removeReminder(id: string) {
    try {
      await api.delete(`/api/v1/reminders/${id}`);
      toast.success("Reminder removed.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not remove that.");
    }
  }

  async function toggleReminder(reminder: ScreenReminder) {
    try {
      await api.patch(`/api/v1/reminders/${reminder.id}`, { enabled: false });
      toast.message("Reminder paused.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not pause that.");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Reminders</h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            {unread > 0
              ? `${unread} waiting for you.`
              : items.length > 0
                ? "Nothing waiting. All read."
                : "Nothing has come in yet."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unread > 0 ? (
            <Button size="sm" variant="ghost" onClick={markAll}>
              <CheckCheck /> Mark all read
            </Button>
          ) : null}
          <Button size="sm" variant="lime" onClick={() => setComposing(true)}>
            <Plus /> New reminder
          </Button>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {figures.map((figure) => {
          const Icon = figure.icon === "unread" ? BellRing : AlarmClock;
          return (
            <div key={figure.label} className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4">
              <span className="flex items-center gap-1.5 text-[11px] text-ink-subtle">
                <Icon className="size-3" />
                {figure.label}
              </span>
              <span className="text-2xl font-semibold tabular-nums text-ink">{figure.value}</span>
            </div>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coming up</CardTitle>
        </CardHeader>
        <CardContent>
          {initialReminders.length === 0 ? (
            <EmptyState
              icon={AlarmClock}
              title="No reminders set"
              description="Set one for the thing you keep forgetting, and it will show up here when it is time."
              action={{ label: "New reminder", onClick: () => setComposing(true) }}
            />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {initialReminders.map((reminder) => (
                <li
                  key={reminder.id}
                  className="group flex items-center gap-3 rounded-control px-1 py-1.5 hover:bg-surface-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-ink">{reminder.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-subtle">
                      <span>{formatWhen(reminder.scheduledFor, hydrated)}</span>
                      {reminder.recurrenceLabel !== "Once" ? (
                        <span className="flex items-center gap-1">
                          <Repeat className="size-2.5" />
                          {reminder.recurrenceLabel}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button size="xs" variant="ghost" onClick={() => void toggleReminder(reminder)}>
                      <BellOff /> Pause
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => void removeReminder(reminder.id)}
                      aria-label={`Delete ${reminder.title}`}
                      className="text-ink-subtle hover:text-negative"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What came in</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="Nothing yet"
              description="Reminders land here once they fire, and stay until you've read them."
            />
          ) : (
            <ul className="flex flex-col gap-1">
              {items.map((item) => {
                const Icon = TYPE_ICON[item.type] ?? Bell;
                const content = (
                  <>
                    <span
                      className={cn(
                        "mt-0.5 grid size-7 shrink-0 place-items-center rounded-full",
                        item.read ? "bg-surface-2 text-ink-subtle" : "bg-lime-soft text-ink",
                      )}
                    >
                      <Icon className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-[13px]", item.read ? "text-ink-muted" : "font-medium text-ink")}>
                        {item.title}
                      </p>
                      {item.body ? (
                        <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-ink-subtle">
                          {item.body}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[10px] text-ink-subtle">{formatWhen(item.createdAt, hydrated)}</p>
                    </div>
                    {!item.read ? (
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-lime" aria-label="Unread" />
                    ) : null}
                  </>
                );

                return (
                  <li key={item.id} className="group flex items-start gap-2.5 rounded-control px-1 py-1.5 hover:bg-surface-2">
                    {item.actionUrl ? (
                      <Link
                        href={item.actionUrl}
                        onClick={() => void markRead(item)}
                        className="flex min-w-0 flex-1 items-start gap-2.5"
                      >
                        {content}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void markRead(item)}
                        className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
                      >
                        {content}
                      </button>
                    )}
                    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      {item.read ? null : (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => void markRead(item)}
                          aria-label={`Mark ${item.title} as read`}
                        >
                          <Check />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Mounted only while open, so its fields reset and its "an hour from now"
          default is re-read each time. See the useState initialiser above. */}
      {composing ? <ReminderDialog tasks={tasks} onClose={() => setComposing(false)} /> : null}
    </div>
  );
}

/**
 * True only after hydration.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: an effect that
 * calls `setState` on mount triggers a second render pass, and every call to
 * `useHydrated` exists to keep the first one cheap. Same pattern as
 * `charts.tsx`.
 */
function useHydrated(): boolean {
  return React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/**
 * "in 20 minutes", "an hour ago", "tomorrow at 07:00" - and a bare date for
 * anything further off, because the exact instant of an hour-old notification is
 * the one piece of information nobody is looking for.
 *
 * Hydration is the constraint here, and it is a real one rather than a
 * theoretical one. This component is server-rendered, and the server's timezone
 * is not the browser's, so *any* locale-formatted string it produces can differ
 * from the browser's for the same instant - which is a hydration mismatch that
 * makes React throw away and rebuild the whole tree. Two things avoid it:
 *
 * 1. Before hydration there is no `new Date()` to compare against, so the value
 *    is a short date rendered with the timezone and locale pinned to UTC. Pinned
 *    means byte-identical on both sides, so the first client render matches what
 *    the server sent.
 * 2. After hydration the real local formatting is used, and there is no server
 *    output left to disagree with - so the local time is safe exactly when it
 *    starts mattering, and never at the moment it would break the page.
 */
function formatWhen(iso: string, hydrated: boolean): string {
  const date = new Date(iso);

  if (!hydrated) {
    return date.toLocaleDateString("en-GB", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
    });
  }

  const now = new Date();
  if (isSameLocalDay(date, now)) {
    const minutes = Math.round((now.getTime() - date.getTime()) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameLocalDay(date, tomorrow)) {
    return `tomorrow at ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function localInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function ReminderDialog({
  tasks,
  onClose,
}: {
  tasks: ScreenTask[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [taskId, setTaskId] = React.useState("");
  const [repeatValue, setRepeatValue] = React.useState<string>("none");
  /*
   * The default is an hour from *now*, which is a clock reading and so cannot be
   * computed during render - it would also mean every re-render moved the
   * suggestion and the field would fight the user while they type. This dialog is
   * only mounted while open, so an initialiser here runs once per open, which is
   * a stable "soon" default that costs no effect and resets every field for free.
   */
  const [when, setWhen] = React.useState(() => localInputValue(new Date(Date.now() + 3600_000)));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/v1/reminders", {
        title,
        body: body || null,
        scheduledFor: new Date(when).toISOString(),
        recurrence: repeatValue === "none" ? null : { freq: repeatValue, interval: 1 },
        targetType: taskId ? "TASK" : "CUSTOM",
        targetId: taskId || null,
      });
      toast.success("Reminder set.");
      setTitle("");
      setBody("");
      setTaskId("");
      setRepeatValue("none");
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not set that reminder.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New reminder</DialogTitle>
          <DialogDescription>
            It will appear on this page the next time you open LIFEOS after it
            comes due. Repeating reminders skip any slots they missed rather
            than stacking up a backlog.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-ink">What for</span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Take the vitamins"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-medium text-ink">When</span>
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-medium text-ink">Repeat</span>
              <select
                value={repeatValue}
                onChange={(e) => setRepeatValue(e.target.value)}
                className="h-9 rounded-control border border-line bg-surface px-2.5 text-[13px] text-ink"
              >
                {REPEATS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {tasks.length > 0 ? (
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-medium text-ink">About a task</span>
              <select
                value={taskId}
                onChange={(e) => {
                  const id = e.target.value;
                  setTaskId(id);
                  // Adopting the task's name is the common case, but an existing
                  // title is never overwritten - the user may have written
                  // something more specific than the task's name.
                  if (id && !title) {
                    const task = tasks.find((t) => t.id === id);
                    if (task) setTitle(task.title);
                  }
                }}
                className="h-9 rounded-control border border-line bg-surface px-2.5 text-[13px] text-ink"
              >
                <option value="">Nothing in particular</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-ink">Anything to add</span>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} />
          </label>

          {error ? <p className="text-[12px] text-negative">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="lime"
            onClick={submit}
            loading={busy}
            loadingText="Setting"
            disabled={!title.trim() || !when}
          >
            Set reminder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}



