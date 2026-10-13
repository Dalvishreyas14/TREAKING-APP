"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Pencil,
  Plus,
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
import { Input, Textarea } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/api/client";
import {
  formatLocalClock24,
  formatLocalClockTime,
  formatWeekdayLong,
} from "@/lib/format/date";
import { cn } from "@/lib/utils";

/**
 * The month grid.
 *
 * Events are bucketed by **local** day, not by UTC day. An event is a real-world
 * instant stored with a timestamp, so bucketing it by `toISOString().slice(0,10)`
 * would move a 7pm dinner into the next day's cell for anyone east of UTC, and
 * a 6am run into the previous day for anyone west of it. The month grid is the one
 * place where being off by a day per event is immediately obvious, so it reads
 * the same local fields the user sees on their OS clock.
 *
 * Everything else that reads `@db.Date` columns (habits, planner, streak logic)
 * buckets by UTC deliberately — that is a *storage* decision and lives in
 * `src/lib/date.ts`. The two are not interchangeable and mixing them up is the
 * single most likely bug in this file, which is why it is written out here.
 */

export interface CalendarEventRow {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string | null;
  color: string;
  source: string;
}

function localKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Every local day an event touches, inclusive of both ends. */
function daysCovered(event: CalendarEventRow): string[] {
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const keys: string[] = [];

  // A month can hold 31 days and a stored event can be malformed enough to span
  // years, so the loop is capped rather than trusting the input to be sane.
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  for (let i = 0; i < 370; i++) {
    keys.push(localKey(cursor));
    if (cursor.getTime() >= last.getTime()) break;
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

const SOURCE_LABEL: Record<string, string> = {
  LOCAL: "Added here",
  GOOGLE: "Google",
  OUTLOOK: "Outlook",
};

export function CalendarGrid({
  events: initialEvents,
  monthStartIso,
  monthLabel,
  weekdayLabels,
  todayIso,
  prevHref,
  nextHref,
  todayHref,
  isCurrentMonth,
}: {
  events: CalendarEventRow[];
  monthStartIso: string;
  monthLabel: string;
  weekdayLabels: string[];
  todayIso: string;
  prevHref: string;
  nextHref: string;
  todayHref: string;
  isCurrentMonth: boolean;
}) {
  const router = useRouter();
  const [events, setEvents] = React.useState(initialEvents);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<CalendarEventRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const [syncedFrom, setSyncedFrom] = React.useState(initialEvents);
  if (syncedFrom !== initialEvents) {
    setSyncedFrom(initialEvents);
    setEvents(initialEvents);
  }

  const monthStart = new Date(monthStartIso);
  const gridStart = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth(),
    1 - monthStart.getDay(),
  );
  const monthIndex = monthStart.getMonth();

  const days = Array.from({ length: 42 }, (_, i) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    return { date, inMonth: date.getMonth() === monthIndex };
  });

  const byDay = new Map<string, CalendarEventRow[]>();
  for (const event of events) {
    for (const key of daysCovered(event)) {
      const bucket = byDay.get(key) ?? [];
      bucket.push(event);
      byDay.set(key, bucket);
    }
  }

  const todayKey = localKey(new Date(todayIso));
  const selectedDay = selected ? new Date(`${selected}T00:00:00`) : null;
  const dayEvents = selectedDay ? (byDay.get(localKey(selectedDay)) ?? []) : [];

  async function remove(event: CalendarEventRow) {
    setBusyId(event.id);
    try {
      await api.delete(`/api/v1/calendar-events/${event.id}`);
      setEvents((prev) => prev.filter((e) => e.id !== event.id));
      setSelected(null);
      setEditing(null);
      toast.success("Event deleted.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not delete that event.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button size="xs" variant="ghost" asChild>
            <Link href={prevHref} aria-label="Previous month">
              <ChevronLeft />
            </Link>
          </Button>
          <h2 className="min-w-40 text-center text-sm font-semibold text-ink">{monthLabel}</h2>
          <Button size="xs" variant="ghost" asChild>
            <Link href={nextHref} aria-label="Next month">
              <ChevronRight />
            </Link>
          </Button>
          {!isCurrentMonth ? (
            <Button size="xs" variant="ghost" asChild>
              <Link href={todayHref}>Today</Link>
            </Button>
          ) : null}
        </div>

        <Button size="sm" variant="lime" onClick={() => setCreating(true)}>
          <Plus /> New event
        </Button>
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-surface">
        <div className="grid grid-cols-7 border-b border-line">
          {weekdayLabels.map((label) => (
            <div
              key={label}
              className="px-2 py-2 text-center text-[11px] font-medium text-ink-subtle"
            >
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map(({ date, inMonth }, index) => {
            const key = localKey(date);
            const dayEvents = byDay.get(key) ?? [];
            const isToday = key === todayKey;
            const isSelected = key === selected;

            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(key)}
                className={cn(
                  "flex min-h-24 flex-col gap-1 border-b border-r border-line p-1.5 text-left transition-colors",
                  index % 7 === 6 && "border-r-0",
                  index >= 35 && "border-b-0",
                  inMonth ? "bg-surface" : "bg-surface-2",
                  isSelected ? "ring-1 ring-inset ring-lime" : "hover:bg-surface-2",
                )}
              >
                <span
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-full text-[11px] tabular-nums",
                    isToday ? "bg-lime font-semibold text-ink-inverse" : "text-ink-muted",
                    !inMonth && !isToday && "opacity-50",
                  )}
                >
                  {date.getDate()}
                </span>

                <span className="flex min-w-0 flex-col gap-0.5">
                  {dayEvents.slice(0, 3).map((event) => (
                    <span
                      key={event.id}
                      className="flex items-center gap-1 truncate rounded-[4px] px-1 py-px text-[10px] leading-tight"
                      style={{ backgroundColor: `${event.color}1f`, color: event.color }}
                    >
                      {!event.allDay ? (
                        <span className="shrink-0 tabular-nums opacity-80">
                          {formatLocalClock24(new Date(event.startAt))}
                        </span>
                      ) : null}
                      <span className="truncate">{event.title}</span>
                    </span>
                  ))}
                  {dayEvents.length > 3 ? (
                    <span className="pl-1 text-[10px] text-ink-subtle">
                      +{dayEvents.length - 3} more
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <Card tone="sunken">
        <CardContent className="flex flex-col gap-3 p-4">
          {selectedDay ? (
            <>
              <p className="text-[13px] font-semibold text-ink">
                {formatWeekdayLong(selectedDay)}
              </p>

              {dayEvents.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon={Clock}
                  title="Nothing scheduled"
                  description="This day is free. Add an event if something is meant to happen."
                  action={{ label: "Add an event", onClick: () => setCreating(true) }}
                />
              ) : (
                <ul className="flex flex-col gap-2">
                  {dayEvents.map((event) => {
                    const start = new Date(event.startAt);
                    const end = new Date(event.endAt);
                    const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
                    return (
                      <li
                        key={event.id}
                        className="flex items-start gap-3 rounded-control border border-line bg-surface p-2.5"
                      >
                        <span
                          className="mt-1 size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: event.color }}
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-ink">
                            {event.title}
                          </p>
                          <p className="mt-0.5 text-[11px] text-ink-subtle">
                            {event.allDay
                              ? "All day"
                              : `${formatLocalClockTime(start)} – ${formatLocalClockTime(end)} (${minutes} min)`}
                          </p>
                          {event.location ? (
                            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-subtle">
                              <MapPin className="size-3" />
                              {event.location}
                            </p>
                          ) : null}
                          {event.description ? (
                            <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
                              {event.description}
                            </p>
                          ) : null}
                        </div>
                        <Badge variant="outline" size="sm">
                          {SOURCE_LABEL[event.source] ?? event.source}
                        </Badge>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => setEditing(event)}
                            aria-label={`Edit ${event.title}`}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={busyId === event.id}
                            onClick={() => void remove(event)}
                            aria-label={`Delete ${event.title}`}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          ) : (
            <p className="text-[12px] text-ink-subtle">
              Pick a day to see what is on. Events are filed on the day they start,
              and an event that runs past midnight appears on both days.
            </p>
          )}
        </CardContent>
      </Card>

      <EventForm
        open={creating || editing !== null}
        event={editing}
        defaultDate={selected ?? undefined}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function EventForm({
  open,
  event,
  defaultDate,
  onClose,
  onSaved,
}: {
  open: boolean;
  event: CalendarEventRow | null;
  defaultDate?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [allDay, setAllDay] = React.useState(false);
  const [date, setDate] = React.useState("");
  const [start, setStart] = React.useState("09:00");
  const [end, setEnd] = React.useState("10:00");
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const [signature, setSignature] = React.useState("");
  const nextSignature = `${event?.id ?? "new"}:${defaultDate ?? ""}`;
  if (signature !== nextSignature) {
    setSignature(nextSignature);
    if (open) {
      if (event) {
        const startDate = new Date(event.startAt);
        const endDate = new Date(event.endAt);
        setTitle(event.title);
        setDescription(event.description ?? "");
        setLocation(event.location ?? "");
        setAllDay(event.allDay);
        setDate(toInputDate(startDate));
        setStart(toInputTime(startDate));
        setEnd(toInputTime(endDate));
      } else {
        setTitle("");
        setDescription("");
        setLocation("");
        setAllDay(false);
        setDate(defaultDate ?? toInputDate(new Date()));
        setStart("09:00");
        setEnd("10:00");
      }
      setErrors({});
    }
  }

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      /**
       * Times are assembled as *local* wall-clock instants. An all-day event ends
       * at 23:59:59 on its own date rather than at its start, so a one-day
       * all-day event occupies exactly one cell instead of zero.
       */
      const payload = {
        title,
        description: description.trim() || null,
        location: location.trim() || null,
        allDay,
        startAt: allDay ? new Date(`${date}T00:00:00`) : new Date(`${date}T${start}:00`),
        endAt: allDay
          ? new Date(`${date}T23:59:59`)
          : end <= start
            ? // An end at or before the start is a typo, not an overnight event,
              // and the API rejects `endAt <= startAt`. It is corrected to the
              // one-hour event the hint under the field already promised, rather
              // than leaving an invalid payload to be rejected. Rolling past
              // midnight rolls the date too, so a 23:30 start still ends at 00:30.
              new Date(new Date(`${date}T${start}:00`).getTime() + 60 * 60_000)
            : new Date(`${date}T${end}:00`),
      };

      if (event) {
        await api.patch(`/api/v1/calendar-events/${event.id}`, payload);
        toast.success("Event updated.");
      } else {
        await api.post("/api/v1/calendar-events", payload);
        toast.success("Event added.");
      }
      onSaved();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrors(
          Object.keys(error.fieldErrors).length > 0
            ? error.fieldErrors
            : { title: error.message },
        );
      } else {
        setErrors({ title: "Could not save that event." });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{event ? "Edit event" : "New event"}</DialogTitle>
          <DialogDescription>
            Kept on this device. Nothing is sent to Google or Outlook.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field label="Title" error={errors.title}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Dentist"
              maxLength={200}
              disabled={busy}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date" error={errors.date}>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={busy}
              />
            </Field>

            <label className="flex items-center gap-2 self-end pb-2">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
                disabled={busy}
                className="size-4 accent-lime"
              />
              <span className="text-[13px] text-ink-muted">All day</span>
            </label>
          </div>

          {!allDay ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Starts" error={errors.startAt}>
                <Input
                  type="time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  disabled={busy}
                />
              </Field>
              <Field
                label="Ends"
                error={errors.endAt}
                hint={end <= start ? "An end before the start is treated as a one-hour event." : undefined}
              >
                <Input
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  disabled={busy}
                />
              </Field>
            </div>
          ) : null}

          <Field label="Location" error={errors.location}>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Optional"
              maxLength={200}
              disabled={busy}
            />
          </Field>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-muted">Notes</span>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              disabled={busy}
            />
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
            loadingText="Saving"
            disabled={!title.trim() || !date}
          >
            {event ? "Save changes" : "Add event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toInputDate(date: Date): string {
  return localKey(date);
}

function toInputTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
