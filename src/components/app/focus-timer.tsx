"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookOpen, Check, Flame, Pause, Play, Star, Trash2, Zap } from "lucide-react";

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
import { Input, Textarea } from "@/components/ui/input";
import { ProgressRing } from "@/components/ui/progress-ring";
import { api, ApiClientError } from "@/lib/api/client";
import { formatLocalClockTime, formatLocalDayMonth } from "@/lib/format/date";
import { cn } from "@/lib/utils";

/**
 * The focus timer.
 *
 * Two decisions carry most of the weight here.
 *
 * **The clock is local, the session is not.** Elapsed time is a display concern,
 * so it ticks on `setInterval` in the browser and looks right immediately. What
 * gets written to the database is the session row created on start and closed by
 * the server on finish — `actualSeconds` is computed there from its own
 * `startedAt`, so a client that tampers with its own timer cannot inflate a
 * number that feeds into XP and the analytics screen.
 *
 * **A page reload is not a lost session.** The server row is the source of truth,
 * so on mount the timer adopts an unfinished session and recomputes elapsed time
 * from its real start. Someone who closes the laptop mid-session and comes back
 * sees the time they actually did, not zero.
 */

export interface FocusSessionRow {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  startedAt: string;
  endedAt: string | null;
  plannedSeconds: number;
  actualSeconds: number;
  type: string;
  rating: number | null;
  notes: string | null;
  endedEarly: boolean;
  xpAwarded: number;
  pausedAt: string | null;
  pausedSeconds: number;
  studySessionId: string | null;
  studyTitle: string | null;
  studySubject: string | null;
  unfinished: boolean;
}

export interface FocusTask {
  id: string;
  title: string;
}

const PRESETS = [
  { label: "25 min", seconds: 25 * 60 },
  { label: "50 min", seconds: 50 * 60 },
  { label: "90 min", seconds: 90 * 60 },
];

function clock(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  return `${hours > 0 ? `${hours}:` : ""}${mm}:${String(seconds).padStart(2, "0")}`;
}

function relativeDay(iso: string): string {
  const then = new Date(iso);
  const now = new Date();
  const days = Math.round(
    (then.setHours(0, 0, 0, 0) - now.setHours(0, 0, 0, 0)) / 86_400_000,
  );
  if (days === 0) return "Today";
  if (days === -1) return "Yesterday";
  return formatLocalDayMonth(then);
}

export function FocusTimer({
  initialSessions,
  tasks,
  todayMinutes,
  sessionCount,
  xp,
  windowDays,
}: {
  initialSessions: FocusSessionRow[];
  tasks: FocusTask[];
  todayMinutes: number;
  sessionCount: number;
  xp: number;
  windowDays: number;
}) {
  const router = useRouter();
  const [sessions, setSessions] = React.useState(initialSessions);
  const [runningId, setRunningId] = React.useState<string | null>(
    initialSessions.find((s) => s.unfinished)?.id ?? null,
  );
  const [plannedSeconds, setPlannedSeconds] = React.useState(25 * 60);
  const [taskId, setTaskId] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [rating, setRating] = React.useState(0);
  const [notes, setNotes] = React.useState("");
  const [dialogError, setDialogError] = React.useState<string | null>(null);

  const running = sessions.find((s) => s.id === runningId) ?? null;

  /**
   * Re-sync when the server sends a new list. Adjusting state during render
   * rather than in an effect is React's documented pattern for deriving state
   * from props, and it avoids briefly committing the stale list.
   */
  const [syncedFrom, setSyncedFrom] = React.useState(initialSessions);
  if (syncedFrom !== initialSessions) {
    setSyncedFrom(initialSessions);
    setSessions(initialSessions);
  }

  /**
   * The running session is adopted from props, so `startedAt` is the real one.
   * Elapsed is recomputed from it rather than resumed from a local counter,
   * because the local counter is exactly what a reload throws away.
   *
   * While paused, elapsed is measured to the *pause instant* instead of to now,
   * and the time already spent paused is subtracted. Both numbers come from the
   * server: a pause the browser only remembered would vanish on reload and the
   * paused minutes would silently reappear as work.
   *
   * `nowMs` is the only thing the interval writes, and elapsed is *derived* from
   * it during render. Storing the elapsed count directly would need the effect
   * body to call `setState` synchronously to reset it when the timer stops, which
   * is a cascading render React warns about; deriving it means the stopped state
   * falls out of the arithmetic instead of being pushed into state.
   */
  const startedAtMs = running ? new Date(running.startedAt).getTime() : null;
  const pausedAtMs = running?.pausedAt ? new Date(running.pausedAt).getTime() : null;
  const [nowMs, setNowMs] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (startedAtMs === null || pausedAtMs !== null) return;
    const tick = () => setNowMs(Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAtMs, pausedAtMs]);

  const elapsed =
    startedAtMs === null
      ? 0
      : Math.max(
          0,
          Math.floor(((pausedAtMs ?? nowMs) - startedAtMs) / 1000) -
            (running?.pausedSeconds ?? 0),
        );
  const paused = pausedAtMs !== null;

  const activePlanned = running?.plannedSeconds ?? plannedSeconds;
  const over = elapsed > activePlanned;
  const progress = activePlanned > 0 ? Math.min(100, (elapsed / activePlanned) * 100) : 0;

  const wasOver = React.useRef(over);
  React.useEffect(() => {
    if (over && !wasOver.current) {
      toast.info("Time is up. Finish the session when you are ready.");
    }
    wasOver.current = over;
  }, [over]);

  async function start() {
    setBusy(true);
    try {
      const created = await api.post<{ id: string; plannedSeconds: number; startedAt: string }>(
        "/api/v1/focus",
        { plannedSeconds, taskId: taskId || null, type: "POMODORO" },
      );
      setSessions((prev) => [
        {
          id: created.id,
          taskId: taskId || null,
          taskTitle: tasks.find((t) => t.id === taskId)?.title ?? null,
          startedAt: created.startedAt,
          endedAt: null,
          plannedSeconds: created.plannedSeconds,
          actualSeconds: 0,
          type: "POMODORO",
          rating: null,
          notes: null,
          endedEarly: false,
          xpAwarded: 0,
          pausedAt: null,
          pausedSeconds: 0,
          studySessionId: null,
          studyTitle: null,
          studySubject: null,
          unfinished: true,
        },
        ...prev,
      ]);
      setRunningId(created.id);
      setRating(0);
      setNotes("");
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not start the session.");
    } finally {
      setBusy(false);
    }
  }

  async function pause() {
    if (!runningId) return;
    setBusy(true);
    try {
      const saved = await api.post<{ pausedAt: string; pausedSeconds: number }>(
        `/api/v1/focus/${runningId}/pause`,
      );
      setSessions((prev) =>
        prev.map((s) =>
          s.id === runningId
            ? { ...s, pausedAt: saved.pausedAt, pausedSeconds: saved.pausedSeconds }
            : s,
        ),
      );
      setNowMs(Date.now());
      toast.info("Paused. The clock is stopped.");
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not pause the session.");
    } finally {
      setBusy(false);
    }
  }

  async function resumeTimer() {
    if (!runningId) return;
    setBusy(true);
    try {
      const saved = await api.post<{ pausedAt: string | null; pausedSeconds: number }>(
        `/api/v1/focus/${runningId}/resume`,
      );
      setSessions((prev) =>
        prev.map((s) =>
          s.id === runningId
            ? { ...s, pausedAt: saved.pausedAt, pausedSeconds: saved.pausedSeconds }
            : s,
        ),
      );
      setNowMs(Date.now());
      toast.success("Back to it.");
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not resume the session.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!runningId) return;
    const linkedStudyTitle = running?.studyTitle ?? null;
    setBusy(true);
    try {
      const saved = await api.patch<{
        xpAwarded: number;
        actualSeconds: number;
        endedEarly: boolean;
      }>(`/api/v1/focus/${runningId}`, {
        rating: rating > 0 ? rating : null,
        notes: notes.trim() || null,
      });
      setSessions((prev) =>
        prev.map((s) =>
          s.id === runningId
            ? {
                ...s,
                endedAt: new Date().toISOString(),
                actualSeconds: saved.actualSeconds,
                rating: rating > 0 ? rating : null,
                notes: notes.trim() || null,
                endedEarly: saved.endedEarly,
                xpAwarded: saved.xpAwarded,
                pausedAt: null,
                unfinished: false,
              }
            : s,
        ),
      );
      setRunningId(null);
      setPendingId(null);
      setRating(0);
      setNotes("");
      setDialogError(null);
      toast.success(
        linkedStudyTitle
          ? `Saved — ${linkedStudyTitle} marked done.`
          : "Session saved.",
      );
      router.refresh();
    } catch (error) {
      setDialogError(
        error instanceof ApiClientError ? error.message : "Could not save the session.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function discard(id: string) {
    try {
      await api.delete(`/api/v1/focus/${id}`);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (runningId === id) setRunningId(null);
      toast.success("Session discarded.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not discard the session.",
      );
    }
  }

  const finished = sessions.filter((s) => !s.unfinished);
  const unfinished = sessions.filter((s) => s.unfinished);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex flex-col gap-5">
        <Card>
          <CardContent className="flex flex-col items-center gap-5 py-8">
            <ProgressRing
              value={progress}
              size={216}
              thickness={10}
              label="Session progress"
              color={paused ? "var(--amber)" : over ? "var(--coral)" : "var(--lime)"}
            >
              <div className="flex flex-col items-center gap-1">
                <span className="font-mono text-[34px] leading-none font-semibold tabular-nums">
                  {clock(elapsed)}
                </span>
                <span className="text-xs text-ink-subtle">
                  {paused ? "paused" : `of ${clock(activePlanned)}`}
                </span>
              </div>
            </ProgressRing>

            {running ? (
              <div className="flex flex-col items-center gap-3">
                <div className="flex flex-col items-center gap-1">
                  <p className="text-sm text-ink-muted">
                    {running.studyTitle
                      ? `Studying ${running.studyTitle}`
                      : running.taskTitle
                        ? `Focusing on ${running.taskTitle}`
                        : "Free focus"}
                  </p>
                  {running.studyTitle ? (
                    <span className="flex items-center gap-1.5 text-[11px] text-ink-subtle">
                      <BookOpen className="size-3.5" />
                      {running.studySubject ?? "Study session"} · the time you actually
                      focus is written back to the timetable when you finish
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {paused ? (
                    <Button variant="lime" size="lg" onClick={resumeTimer} disabled={busy}>
                      <Play /> Resume
                    </Button>
                  ) : (
                    <Button variant="secondary" size="lg" onClick={pause} disabled={busy}>
                      <Pause /> Pause
                    </Button>
                  )}
                  <Button
                    variant={paused ? "secondary" : "lime"}
                    size="lg"
                    onClick={() => setPendingId(running.id)}
                    disabled={busy}
                  >
                    <Check /> Finish
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => discard(running.id)}
                    disabled={busy}
                  >
                    <Trash2 /> Discard
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex w-full max-w-md flex-col items-center gap-4">
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {PRESETS.map((preset) => (
                    <Button
                      key={preset.seconds}
                      variant={plannedSeconds === preset.seconds ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setPlannedSeconds(preset.seconds)}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>

                <label className="flex w-full flex-col gap-1.5 text-left">
                  <span className="text-[13px] font-medium text-ink-muted">
                    What are you working on
                  </span>
                  <Input
                    list="focus-task-options"
                    placeholder="Optional"
                    value={tasks.find((t) => t.id === taskId)?.title ?? taskId}
                    onChange={(e) => {
                      const match = tasks.find(
                        (t) => t.title.toLowerCase() === e.target.value.toLowerCase(),
                      );
                      setTaskId(match ? match.id : "");
                    }}
                  />
                  <datalist id="focus-task-options">
                    {tasks.map((t) => (
                      <option key={t.id} value={t.title} />
                    ))}
                  </datalist>
                </label>

                <Button
                  variant="lime"
                  size="lg"
                  onClick={start}
                  loading={busy}
                  className="min-w-40"
                >
                  <Play /> Start
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {unfinished.length > 0 && !running ? (
          <Card tone="sunken">
            <CardContent className="flex flex-col gap-3 p-4">
              <p className="text-[13px] font-medium text-ink-muted">
                {unfinished.length === 1
                  ? "One session was never closed out"
                  : `${unfinished.length} sessions were never closed out`}
              </p>
              {unfinished.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm text-ink-subtle">
                    Started {relativeDay(s.startedAt)} at{" "}
                    {formatLocalClockTime(new Date(s.startedAt))}
                    {s.pausedAt ? " · paused" : ""}
                  </span>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setRunningId(s.id)}>
                      <Play /> Resume
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => discard(s.id)}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Recent sessions</CardTitle>
          </CardHeader>
          <CardContent>
            {finished.length === 0 ? (
              <EmptyState
                icon={Flame}
                size="sm"
                title="No sessions yet"
                description={`Finish one and it will show up here, with the last ${windowDays} days of history.`}
              />
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {finished.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 py-3">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium text-ink">
                        {s.taskTitle ?? s.studyTitle ?? "Free focus"}
                      </span>
                      <span className="text-xs text-ink-subtle">
                        {relativeDay(s.startedAt)} ·{" "}
                        {formatLocalClockTime(new Date(s.startedAt))}
                      </span>
                    </div>

                    <Badge
                      variant={s.endedEarly ? "amber" : "lime"}
                      size="sm"
                      className="tabular-nums"
                    >
                      {Math.round(s.actualSeconds / 60)}m
                    </Badge>

                    {s.rating ? (
                      <span className="hidden items-center gap-0.5 sm:flex" aria-label={`${s.rating} out of 5`}>
                        {Array.from({ length: 5 }, (_, i) => (
                          <Star
                            key={i}
                            className={cn(
                              "size-3.5",
                              i < s.rating! ? "fill-amber text-amber" : "text-ink-subtle",
                            )}
                          />
                        ))}
                      </span>
                    ) : null}

                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => discard(s.id)}
                      aria-label="Discard session"
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card tone="sunken" className="h-fit">
        <CardHeader>
          <CardTitle>Last {windowDays} days</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Stat label="Focused" value={`${todayMinutes}m`} />
          <Stat label="Sessions" value={String(sessionCount)} />
          <Stat label="XP earned" value={String(xp)} icon={<Zap className="size-3.5 text-amber" />} />
          <p className="text-[11px] leading-relaxed text-ink-subtle">
            XP is awarded by the server when a session closes, capped at 60 per
            session so one long sitting cannot farm a level on its own.
          </p>
        </CardContent>
      </Card>

      <Dialog open={pendingId !== null} onOpenChange={(open) => !open && setPendingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>How did that go?</DialogTitle>
            <DialogDescription>
              {clock(elapsed)} focused,{" "}
              {elapsed >= activePlanned ? "target met" : "target not reached"}. A rating
              is optional.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="text-[13px] font-medium text-ink-muted">Rating</legend>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRating(value === rating ? 0 : value)}
                    aria-pressed={rating === value}
                    className="rounded-control p-1 transition-colors hover:bg-surface-2"
                  >
                    <Star
                      className={cn(
                        "size-6",
                        value <= rating ? "fill-amber text-amber" : "text-ink-subtle",
                      )}
                    />
                    <span className="sr-only">{value} out of 5</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-muted">Notes</span>
              <Textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What got in the way?"
              />
            </label>

            {dialogError ? (
              <p role="alert" className="text-xs text-negative">
                {dialogError}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingId(null)} disabled={busy}>
              Keep going
            </Button>
            <Button variant="lime" onClick={finish} loading={busy} loadingText="Saving">
              Save session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[13px] text-ink-muted">{label}</span>
      <span className="flex items-center gap-1 text-sm font-semibold tabular-nums text-ink">
        {icon}
        {value}
      </span>
    </div>
  );
}
