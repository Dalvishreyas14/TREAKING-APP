"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  List,
  Pencil,
  Play,
  Plus,
  Repeat,
  Trash2,
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/overlays";
import {
  StudySessionDialog,
  type StudyHabitOption,
  type StudySessionView,
} from "@/components/app/study/session-dialog";
import { api, ApiClientError } from "@/lib/api/client";
import { STUDY_WEEKDAYS } from "@/lib/study/presets";
import {
  completionPercent,
  deriveSessionStatus,
  formatClock,
  parseClock,
  plannedVersusActual,
  repeatLabel,
  shiftIsoDay,
  weekdayOfIsoDay,
} from "@/lib/study/schedule";
import { cn } from "@/lib/utils";

/**
 * The weekly study timetable.
 *
 * Seven days, Monday first, each holding the sessions scheduled for it. The
 * screen is built around one distinction: **the plan and the record are
 * different numbers.** A session is planned for an hour; what the user
 * actually studied is written back when the timer closes, and the two are shown
 * side by side rather than blended. "I planned 60 and did 35" is the most
 * useful sentence this screen can say, and a single combined figure would
 * destroy it.
 *
 * The second distinction is **a session and a schedule**. A one-off session is
 * a day on the timetable. A repeating schedule is a rule that fills the week,
 * and it is edited in one place rather than seven. Editing one occurrence of a
 * schedule marks it an exception, so the rule leaves it alone - the same split
 * the fitness planner makes between a template and a workout.
 *
 * Everything here is real. Creating, editing, moving, completing, starting a
 * timer and deleting all hit the API, and the page re-reads from the database
 * afterwards rather than trusting a local guess.
 */

export interface StudySeriesView {
  id: string;
  title: string;
  subject: string;
  notes: string | null;
  color: string;
  repeat: string;
  daysOfWeek: number[];
  startMinutes: number;
  durationMinutes: number;
  endMinutes: number;
  reminderLeadMinutes: number | null;
  habitId: string | null;
  categoryId: string | null;
  isActive: boolean;
  habit: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
}

export function WeeklySchedule({
  weekStart,
  sessions,
  series,
  habits,
  today,
}: {
  weekStart: string;
  sessions: StudySessionView[];
  series: StudySeriesView[];
  habits: StudyHabitOption[];
  today: string;
}) {
  const router = useRouter();

  const [view, setView] = React.useState<"week" | "agenda">("week");
  const [dialog, setDialog] = React.useState<
    | { mode: "create"; date: string }
    | { mode: "edit"; session: StudySessionView }
    | { mode: "reschedule"; session: StudySessionView }
    | { mode: "series"; series: StudySeriesView | null }
    | null
  >(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const days = React.useMemo(
    () => Array.from({ length: 7 }, (_, i) => shiftIsoDay(weekStart, i)),
    [weekStart],
  );

  const now = React.useMemo(() => {
    const nowDate = new Date();
    return {
      isoDay: today,
      minutes: nowDate.getHours() * 60 + nowDate.getMinutes(),
    };
  }, [today]);

  const byDay = React.useMemo(() => {
    const map = new Map<string, StudySessionView[]>();
    for (const day of days) map.set(day, []);
    for (const session of sessions) {
      const bucket = map.get(session.date);
      if (bucket) bucket.push(session);
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => a.startMinutes - b.startMinutes);
    }
    return map;
  }, [days, sessions]);

  const totals = React.useMemo(
    () => plannedVersusActual(sessions.map((s) => ({ ...s, status: s.status }))),
    [sessions],
  );
  const rate = React.useMemo(() => completionPercent(sessions, now), [sessions, now]);
  const doneCount = sessions.filter((s) => s.status === "COMPLETED").length;

  function goToWeek(iso: string) {
    router.push(`/study?week=${iso}`);
  }

  async function runAction(
    session: StudySessionView,
    action: "complete" | "miss" | "delete" | "start",
  ) {
    if (action === "delete") {
      const ok = window.confirm(
        session.seriesId
          ? `Delete this session? It will stay deleted — the schedule will not put it back.`
          : `Delete “${session.title}”? This cannot be undone.`,
      );
      if (!ok) return;
    }

    setBusyId(session.id);
    try {
      if (action === "delete") {
        await api.delete(`/api/v1/study-sessions/${session.id}`);
        toast.success("Session deleted.");
      } else if (action === "start") {
        await api.post(`/api/v1/study-sessions/${session.id}/start`);
        toast.success("Timer started.");
        router.push("/focus");
        return;
      } else {
        await api.patch(`/api/v1/study-sessions/${session.id}`, {
          status: action === "complete" ? "COMPLETED" : "MISSED",
        });
        toast.success(action === "complete" ? "Nice — marked done." : "Marked as missed.");
      }
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not update that session.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-[-0.01em]">
            <CalendarDays className="size-4 text-lime" />
            Weekly schedule
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {sessions.length === 0
              ? "Nothing scheduled yet — add a session and it lands here."
              : `${doneCount} of ${sessions.length} done · ${Math.round(totals.plannedMinutes / 60 * 10) / 10}h planned · ${Math.round(totals.actualMinutes / 60 * 10) / 10}h focused`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as "week" | "agenda")}>
            <TabsList>
              <TabsTrigger value="week">
                <CalendarDays /> Week
              </TabsTrigger>
              <TabsTrigger value="agenda">
                <List /> Agenda
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-1 rounded-control border border-line p-0.5">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Previous week"
              onClick={() => goToWeek(shiftIsoDay(weekStart, -7))}
            >
              <ChevronLeft />
            </Button>
            <span className="px-2 text-[12px] tabular-nums text-ink-muted">
              {dayLabel(weekStart)} – {dayLabel(shiftIsoDay(weekStart, 6))}
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Next week"
              onClick={() => goToWeek(shiftIsoDay(weekStart, 7))}
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

          <Button size="sm" variant="lime" onClick={() => setDialog({ mode: "create", date: today })}>
            <Plus /> Add session
          </Button>
        </div>
      </header>

      {rate !== null ? (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
          <span className="font-medium text-ink">{rate}% of what was due</span>
          <span className="text-ink-subtle">
            only sessions whose time has passed count — a week that has not happened yet
            is not a week of failures
          </span>
        </div>
      ) : null}

      {view === "week" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {days.map((day) => (
            <DayColumn
              key={day}
              day={day}
              sessions={byDay.get(day) ?? []}
              today={today}
              now={now}
              busyId={busyId}
              onAdd={() => setDialog({ mode: "create", date: day })}
              onEdit={(session) => setDialog({ mode: "edit", session })}
              onReschedule={(session) => setDialog({ mode: "reschedule", session })}
              onAction={runAction}
            />
          ))}
        </div>
      ) : (
        <AgendaView
          days={days}
          byDay={byDay}
          today={today}
          now={now}
          busyId={busyId}
          onAdd={(day) => setDialog({ mode: "create", date: day })}
          onEdit={(session) => setDialog({ mode: "edit", session })}
          onReschedule={(session) => setDialog({ mode: "reschedule", session })}
          onAction={runAction}
        />
      )}

      <SeriesCard
        series={series}
        onEdit={(one) => setDialog({ mode: "series", series: one })}
        onChanged={() => router.refresh()}
      />

      {dialog?.mode === "create" || dialog?.mode === "edit" ? (
        <StudySessionDialog
          mode={dialog.mode}
          date={dialog.mode === "create" ? dialog.date : dialog.session.date}
          session={dialog.mode === "edit" ? dialog.session : undefined}
          sessions={sessions}
          habits={habits}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      ) : null}

      {dialog?.mode === "reschedule" ? (
        <RescheduleDialog
          session={dialog.session}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      ) : null}

      {dialog?.mode === "series" ? (
        <SeriesDialog
          initial={dialog.series}
          habits={habits}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------- day column

function DayColumn({
  day,
  sessions,
  today,
  now,
  busyId,
  onAdd,
  onEdit,
  onReschedule,
  onAction,
}: {
  day: string;
  sessions: StudySessionView[];
  today: string;
  now: { isoDay: string; minutes: number };
  busyId: string | null;
  onAdd: () => void;
  onEdit: (session: StudySessionView) => void;
  onReschedule: (session: StudySessionView) => void;
  onAction: (session: StudySessionView, action: "complete" | "miss" | "delete" | "start") => void;
}) {
  const isToday = day === today;
  const weekday = STUDY_WEEKDAYS.find((w) => w.jsDay === weekdayOfIsoDay(day));

  return (
    <Card
      tone={isToday ? "raised" : "default"}
      className={cn("flex flex-col", isToday && "ring-1 ring-lime/40")}
    >
      <CardHeader className="flex-row items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
            {weekday?.short}
          </p>
          <p className="text-[13px] font-medium text-ink">{dayLabel(day)}</p>
        </div>
        {isToday ? (
          <Badge variant="lime" size="sm">
            Today
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2 p-3 pt-0">
        {sessions.length === 0 ? (
          <p className="rounded-control border border-dashed border-line px-2.5 py-3 text-center text-[12px] text-ink-subtle">
            Nothing scheduled
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                now={now}
                busy={busyId === session.id}
                onEdit={() => onEdit(session)}
                onReschedule={() => onReschedule(session)}
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

// ---------------------------------------------------------------- agenda

function AgendaView({
  days,
  byDay,
  today,
  now,
  busyId,
  onAdd,
  onEdit,
  onReschedule,
  onAction,
}: {
  days: string[];
  byDay: Map<string, StudySessionView[]>;
  today: string;
  now: { isoDay: string; minutes: number };
  busyId: string | null;
  onAdd: (day: string) => void;
  onEdit: (session: StudySessionView) => void;
  onReschedule: (session: StudySessionView) => void;
  onAction: (session: StudySessionView, action: "complete" | "miss" | "delete" | "start") => void;
}) {
  const withSessions = days.filter((day) => (byDay.get(day) ?? []).length > 0);

  if (withSessions.length === 0) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={CalendarDays}
            size="sm"
            title="Nothing scheduled this week"
            description="Add a session and it will show up here, day by day."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {withSessions.map((day) => {
        const weekday = STUDY_WEEKDAYS.find((w) => w.jsDay === weekdayOfIsoDay(day));
        return (
          <Card key={day}>
            <CardHeader className="flex-row items-center justify-between gap-2 p-3 pb-2">
              <div className="flex items-center gap-2">
                <p className="text-[13px] font-semibold text-ink">
                  {weekday?.long} {dayLabel(day)}
                </p>
                {day === today ? (
                  <Badge variant="lime" size="sm">
                    Today
                  </Badge>
                ) : null}
              </div>
              <Button size="xs" variant="ghost" onClick={() => onAdd(day)}>
                <Plus /> Add
              </Button>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <ul className="flex flex-col divide-y divide-line">
                {(byDay.get(day) ?? []).map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    now={now}
                    busy={busyId === session.id}
                    onEdit={() => onEdit(session)}
                    onReschedule={() => onReschedule(session)}
                    onAction={onAction}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------- session card

function SessionCard({
  session,
  now,
  busy,
  onEdit,
  onReschedule,
  onAction,
}: {
  session: StudySessionView;
  now: { isoDay: string; minutes: number };
  busy: boolean;
  onEdit: () => void;
  onReschedule: () => void;
  onAction: (session: StudySessionView, action: "complete" | "miss" | "delete" | "start") => void;
}) {
  const view = deriveSessionStatus(session, now);
  const canAct = session.status === "PLANNED" || session.status === "IN_PROGRESS";

  return (
    <li
      className="rounded-control border border-line bg-surface p-2.5"
      style={{ borderLeftWidth: 3, borderLeftColor: session.color }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-[13px] font-semibold text-ink">{session.title}</p>
        <StatusDot view={view} />
      </div>

      <p className="mt-0.5 truncate text-[11px] text-ink-subtle">{session.subject}</p>

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className="text-[11px] tabular-nums text-ink-muted">
          {formatClock(session.startMinutes)} – {formatClock(session.endMinutes)}
        </span>
        <Badge variant="outline" size="sm">
          {session.durationMinutes}m
        </Badge>
        {session.seriesId ? (
          <Badge variant="iris" size="sm">
            <Repeat /> {repeatLabel(session.series?.repeat ?? "WEEKLY", session.series?.daysOfWeek ?? [])}
          </Badge>
        ) : null}
        {session.status === "COMPLETED" && session.actualMinutes > 0 ? (
          <Badge variant="lime" size="sm">
            {session.actualMinutes}m done
          </Badge>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {canAct ? (
          <>
            <Button size="xs" variant="lime" disabled={busy} onClick={() => onAction(session, "start")}>
              <Play /> Start
            </Button>
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => onAction(session, "complete")}>
              <Check /> Done
            </Button>
          </>
        ) : null}
        {session.status !== "COMPLETED" ? (
          <Button size="icon-xs" variant="ghost" aria-label="Edit session" onClick={onEdit} disabled={busy}>
            <Pencil />
          </Button>
        ) : null}
        {canAct ? (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Move session"
            onClick={onReschedule}
            disabled={busy}
          >
            <Clock />
          </Button>
        ) : null}
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Delete session"
          onClick={() => onAction(session, "delete")}
          disabled={busy}
        >
          <Trash2 />
        </Button>
      </div>
    </li>
  );
}

function SessionRow({
  session,
  now,
  busy,
  onEdit,
  onReschedule,
  onAction,
}: {
  session: StudySessionView;
  now: { isoDay: string; minutes: number };
  busy: boolean;
  onEdit: () => void;
  onReschedule: () => void;
  onAction: (session: StudySessionView, action: "complete" | "miss" | "delete" | "start") => void;
}) {
  const view = deriveSessionStatus(session, now);
  const canAct = session.status === "PLANNED" || session.status === "IN_PROGRESS";

  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5">
      <span className="w-28 shrink-0 text-[12px] tabular-nums text-ink-subtle">
        {formatClock(session.startMinutes)} – {formatClock(session.endMinutes)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{session.title}</span>
        <span className="block truncate text-[11px] text-ink-subtle">
          {session.subject} · {session.durationMinutes}m
          {session.status === "COMPLETED" && session.actualMinutes > 0
            ? ` · ${session.actualMinutes}m focused`
            : ""}
        </span>
      </span>
      <StatusDot view={view} />
      {canAct ? (
        <>
          <Button size="xs" variant="lime" disabled={busy} onClick={() => onAction(session, "start")}>
            <Play /> Start
          </Button>
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => onAction(session, "complete")}>
            <Check /> Done
          </Button>
        </>
      ) : null}
      {session.status !== "COMPLETED" ? (
        <Button size="icon-xs" variant="ghost" aria-label="Edit session" onClick={onEdit} disabled={busy}>
          <Pencil />
        </Button>
      ) : null}
      {canAct ? (
        <Button size="icon-xs" variant="ghost" aria-label="Move session" onClick={onReschedule} disabled={busy}>
          <Clock />
        </Button>
      ) : null}
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Delete session"
        onClick={() => onAction(session, "delete")}
        disabled={busy}
      >
        <Trash2 />
      </Button>
    </li>
  );
}

/** A small coloured mark, so the state of a session is readable at a glance. */
function StatusDot({ view }: { view: string }) {
  const tone =
    view === "COMPLETED"
      ? "bg-lime"
      : view === "IN_PROGRESS"
        ? "bg-iris"
        : view === "MISSED"
          ? "bg-coral"
          : "bg-line-strong";
  const label =
    view === "COMPLETED"
      ? "Done"
      : view === "IN_PROGRESS"
        ? "In progress"
        : view === "MISSED"
          ? "Missed"
          : "Upcoming";
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-subtle">
      <span className={cn("size-2 rounded-full", tone)} aria-hidden />
      {label}
    </span>
  );
}

// ---------------------------------------------------------- series card

function SeriesCard({
  series,
  onEdit,
  onChanged,
}: {
  series: StudySeriesView[];
  onEdit: (one: StudySeriesView) => void;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = React.useState<string | null>(null);

  async function toggle(one: StudySeriesView) {
    setBusyId(one.id);
    try {
      await api.patch(`/api/v1/study-series/${one.id}`, { isActive: !one.isActive });
      toast.success(one.isActive ? "Schedule paused." : "Schedule resumed.");
      onChanged();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not update the schedule.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(one: StudySeriesView) {
    if (!window.confirm(`Delete “${one.title}”? Sessions you already completed are kept.`)) {
      return;
    }
    setBusyId(one.id);
    try {
      await api.delete(`/api/v1/study-series/${one.id}`);
      toast.success("Schedule deleted.");
      onChanged();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not delete the schedule.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-[13px]">
          <Repeat className="size-3.5 text-ink-subtle" />
          Repeating schedules
        </CardTitle>
        <span className="text-[11px] text-ink-subtle">
          {series.length === 0 ? "none yet" : `${series.length} saved`}
        </span>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {series.length === 0 ? (
          <p className="rounded-control border border-dashed border-line px-3 py-3 text-center text-[12px] text-ink-subtle">
            Add a session and set it to repeat, and the rule appears here.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {series.map((one) => (
              <li key={one.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: one.color }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">
                    {one.title}
                  </span>
                  <span className="block truncate text-[11px] text-ink-subtle">
                    {repeatLabel(one.repeat, one.daysOfWeek)} · {formatClock(one.startMinutes)} ·{" "}
                    {one.durationMinutes}m
                    {one.habit ? ` · counts towards ${one.habit.name}` : ""}
                  </span>
                </span>
                {!one.isActive ? (
                  <Badge variant="outline" size="sm">
                    Paused
                  </Badge>
                ) : null}
                <Button size="xs" variant="ghost" disabled={busyId === one.id} onClick={() => onEdit(one)}>
                  <Pencil /> Edit
                </Button>
                <Button size="xs" variant="ghost" disabled={busyId === one.id} onClick={() => toggle(one)}>
                  {one.isActive ? "Pause" : "Resume"}
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Delete schedule"
                  disabled={busyId === one.id}
                  onClick={() => remove(one)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------- reschedule modal

function RescheduleDialog({
  session,
  onClose,
  onSaved,
}: {
  session: StudySessionView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [day, setDay] = React.useState(session.date);
  const [startTime, setStartTime] = React.useState(minutesToTime(session.startMinutes));
  const [endTime, setEndTime] = React.useState(minutesToTime(session.endMinutes));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const startMinutes = parseClock(startTime);
  const endMinutes = parseClock(endTime);
  const timingError =
    startMinutes === null || endMinutes === null
      ? "Pick a start and an end time."
      : endMinutes <= startMinutes
        ? "The end time has to be after the start time."
        : endMinutes > 1440
          ? "A session cannot run past midnight."
          : null;

  async function save() {
    setError(null);
    if (timingError) {
      setError(timingError);
      return;
    }
    setBusy(true);
    try {
      const saved = await api.post<{ warning: string | null }>(
        `/api/v1/study-sessions/${session.id}/reschedule`,
        {
          date: day,
          startMinutes: startMinutes!,
          durationMinutes: endMinutes! - startMinutes!,
        },
      );
      if (saved.warning) toast.warning(saved.warning);
      else toast.success("Session moved.");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not move the session.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move session</DialogTitle>
          <DialogDescription>
            The original slot is closed and a new one opens here, so the week shows the
            move rather than pretending it was always here.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Day" type="date" value={day} onChange={(e) => setDay(e.target.value)} disabled={busy} />
            <Field label="Starts" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={busy} />
            <Field label="Ends" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={busy} />
          </div>
          {error ? (
            <p role="alert" className="text-xs text-negative">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="lime" onClick={save} loading={busy} loadingText="Moving">
            Move session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------- series modal

function SeriesDialog({
  initial,
  habits,
  onClose,
  onSaved,
}: {
  initial: StudySeriesView | null;
  habits: StudyHabitOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = React.useState(initial?.title ?? "");
  const [subject, setSubject] = React.useState(initial?.subject ?? "");
  const [days, setDays] = React.useState<number[]>(initial?.daysOfWeek ?? []);
  const [startTime, setStartTime] = React.useState(
    initial ? minutesToTime(initial.startMinutes) : "18:00",
  );
  const [endTime, setEndTime] = React.useState(
    initial ? minutesToTime(initial.endMinutes) : "19:00",
  );
  const [habitId, setHabitId] = React.useState(initial?.habitId ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const startMinutes = parseClock(startTime);
  const endMinutes = parseClock(endTime);
  const timingError =
    startMinutes === null || endMinutes === null
      ? "Pick a start and an end time."
      : endMinutes <= startMinutes
        ? "The end time has to be after the start time."
        : endMinutes > 1440
          ? "A session cannot run past midnight."
          : null;

  async function save() {
    setError(null);
    if (!title.trim()) {
      setError("Give the schedule a title.");
      return;
    }
    if (days.length === 0) {
      setError("Pick at least one day.");
      return;
    }
    if (timingError) {
      setError(timingError);
      return;
    }

    setBusy(true);
    try {
      const payload = {
        title: title.trim(),
        subject: subject.trim() || title.trim(),
        // One day is the "every week" case; more than one is a custom pattern.
        // The schema enforces that a `WEEKLY` series carries exactly one day.
        repeat: days.length === 1 ? "WEEKLY" : "CUSTOM",
        daysOfWeek: days,
        startMinutes: startMinutes!,
        durationMinutes: endMinutes! - startMinutes!,
        habitId: habitId || null,
      };

      if (initial) {
        await api.patch(`/api/v1/study-series/${initial.id}`, payload);
        toast.success("Schedule updated.");
      } else {
        await api.post("/api/v1/study-series", payload);
        toast.success("Schedule added.");
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save the schedule.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit schedule" : "New repeating schedule"}</DialogTitle>
          <DialogDescription>
            Changing a schedule rewrites the days ahead of you. Days you have already
            completed are left exactly as they are.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Field
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="DSA"
            maxLength={120}
            disabled={busy}
          />
          <Field
            label="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Problem solving"
            maxLength={80}
            disabled={busy}
          />

          <div className="flex flex-col gap-1.5">
            <p className="text-[13px] font-medium text-ink-muted">Days</p>
            <div className="flex flex-wrap gap-1">
              {STUDY_WEEKDAYS.map((weekday) => {
                const on = days.includes(weekday.jsDay);
                return (
                  <button
                    key={weekday.jsDay}
                    type="button"
                    disabled={busy}
                    aria-pressed={on}
                    onClick={() =>
                      setDays(
                        on
                          ? days.filter((d) => d !== weekday.jsDay)
                          : [...days, weekday.jsDay].sort((a, b) => a - b),
                      )
                    }
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                      on
                        ? "border-lime bg-lime-soft text-lime"
                        : "border-line text-ink-subtle hover:border-line-strong hover:text-ink",
                    )}
                  >
                    {weekday.short}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={busy} />
            <Field label="Ends" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={busy} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="series-habit" className="text-[13px] font-medium text-ink-muted">
              Counts towards a habit
            </label>
            <select
              id="series-habit"
              value={habitId}
              onChange={(e) => setHabitId(e.target.value)}
              disabled={busy}
              className="h-9 rounded-control border border-line bg-surface px-2.5 text-[13px] text-ink"
            >
              <option value="">No habit</option>
              {habits.map((habit) => (
                <option key={habit.id} value={habit.id}>
                  {habit.name}
                </option>
              ))}
            </select>
          </div>

          {error ? (
            <p role="alert" className="text-xs text-negative">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="lime" onClick={save} loading={busy} loadingText="Saving">
            {initial ? "Save changes" : "Add schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------- helpers

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function minutesToTime(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** `2026-10-26` -> `26 Oct`, from the UTC fields with an explicit locale. */
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** The Monday of the week containing `iso`. */
function mondayOf(iso: string): string {
  return shiftIsoDay(iso, -((weekdayOfIsoDay(iso) + 6) % 7));
}
