"use client";

import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, Repeat } from "lucide-react";

import { Field } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/primitives";
import { api, ApiClientError } from "@/lib/api/client";
import { STUDY_COLOR_PRESETS, STUDY_SUBJECT_PRESETS, STUDY_WEEKDAYS } from "@/lib/study/presets";
import {
  findOverlap,
  formatClock,
  parseClock,
  repeatLabel,
  weekdayOfIsoDay,
} from "@/lib/study/schedule";
import { cn } from "@/lib/utils";

/**
 * The add / edit session form.
 *
 * A session is a title, a subject, a day, a start and a length. The form thinks
 * in start and end times because that is how people say it - "7 to 8" - and the
 * database stores a length, because a stored end time is a second number that
 * can disagree with the first. The conversion happens once, in
 * `resolveStudyDuration`, and the same function decides whether the end is
 * after the start, so the form cannot save something the API would reject.
 *
 * The overlap check is a *warning*. A study timetable is a plan the user is
 * allowed to overcommit on; telling them what it collides with and letting
 * them decide is more useful than refusing to record what they intend to do.
 */

export interface StudySessionView {
  id: string;
  seriesId: string | null;
  title: string;
  subject: string;
  notes: string | null;
  color: string;
  date: string;
  startMinutes: number;
  durationMinutes: number;
  endMinutes: number;
  status: string;
  actualMinutes: number;
  reminderLeadMinutes: number | null;
  habitId: string | null;
  categoryId: string | null;
  isException: boolean;
  rescheduledFromDate: string | null;
  series: {
    id: string;
    title: string;
    subject: string;
    repeat: string;
    daysOfWeek: number[];
  } | null;
}

export interface StudyHabitOption {
  id: string;
  name: string;
  type: string;
  targetValue: number;
}

const REMINDER_OPTIONS = [
  { label: "No reminder", value: null },
  { label: "10 min before", value: 10 },
  { label: "30 min before", value: 30 },
  { label: "1 hour before", value: 60 },
  { label: "1 day before", value: 1440 },
] as const;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function minutesToTime(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function timeToMinutes(value: string): number | null {
  return parseClock(value);
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

type Repeat = "NONE" | "WEEKLY" | "CUSTOM";

export function StudySessionDialog({
  mode,
  date,
  session,
  sessions,
  habits,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  /** The day a new session starts on. */
  date: string;
  /** The session being edited. */
  session?: StudySessionView;
  /** Every session in the visible range, used for the overlap warning. */
  sessions: StudySessionView[];
  habits: StudyHabitOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = mode === "edit" && session ? session : null;
  const lockedToSeries = Boolean(editing?.seriesId);

  const [title, setTitle] = React.useState(editing?.title ?? "");
  const [subject, setSubject] = React.useState(editing?.subject ?? "");
  const [day, setDay] = React.useState(editing?.date ?? date);
  const [startTime, setStartTime] = React.useState(
    editing ? minutesToTime(editing.startMinutes) : "18:00",
  );
  const [endTime, setEndTime] = React.useState(
    editing ? minutesToTime(editing.endMinutes) : "19:00",
  );
  const [repeat, setRepeat] = React.useState<Repeat>(
    editing?.series ? (editing.series.repeat as Repeat) : "NONE",
  );
  const [days, setDays] = React.useState<number[]>(
    editing?.series?.daysOfWeek ?? [],
  );
  const [reminderLead, setReminderLead] = React.useState<number | null>(
    editing?.reminderLeadMinutes ?? null,
  );
  const [habitId, setHabitId] = React.useState(editing?.habitId ?? "");
  const [notes, setNotes] = React.useState(editing?.notes ?? "");
  const [color, setColor] = React.useState(editing?.color ?? STUDY_COLOR_PRESETS[0]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  const timingError = React.useMemo(() => {
    if (startMinutes === null) return "Pick a start time.";
    if (endMinutes === null) return "Pick an end time.";
    if (endMinutes <= startMinutes) return "The end time has to be after the start time.";
    if (endMinutes > 1440) return "A session cannot run past midnight.";
    return null;
  }, [startMinutes, endMinutes]);

  const durationMinutes =
    timingError || startMinutes === null || endMinutes === null
      ? null
      : endMinutes - startMinutes;

  /**
   * What this slot would collide with.
   *
   * Checked against the sessions already on the timetable, ignoring the one
   * being edited. A clash is shown as a warning, not a block.
   */
  const conflict = React.useMemo(() => {
    if (durationMinutes === null || startMinutes === null) return null;
    return findOverlap(
      { startMinutes, durationMinutes },
      sessions
        .filter((s) => s.date === day && s.status !== "RESCHEDULED")
        .map((s) => ({ id: s.id, title: s.title, startMinutes: s.startMinutes, durationMinutes: s.durationMinutes })),
      editing?.id,
    );
  }, [sessions, day, startMinutes, durationMinutes, editing?.id]);

  async function save() {
    setError(null);
    setFieldErrors({});

    if (!title.trim()) {
      setFieldErrors({ title: "Give the session a title" });
      return;
    }
    if (!subject.trim()) {
      setFieldErrors({ subject: "Name the subject" });
      return;
    }
    if (timingError) {
      setFieldErrors({ endTime: timingError });
      return;
    }
    if (repeat === "CUSTOM" && days.length === 0) {
      setFieldErrors({ days: "Pick at least one day" });
      return;
    }

    setBusy(true);
    try {
      const timing = {
        date: day,
        startMinutes: startMinutes!,
        durationMinutes: durationMinutes!,
      };

      if (editing) {
        const saved = await api.patch<{ warning: string | null }>(
          `/api/v1/study-sessions/${editing.id}`,
          {
            ...timing,
            title: title.trim(),
            subject: subject.trim(),
            notes: notes.trim() || null,
            color,
            reminderLeadMinutes: reminderLead,
            habitId: habitId || null,
          },
        );
        if (saved.warning) toast.warning(saved.warning);
        else toast.success("Session updated.");
      } else {
        const saved = await api.post<{ warning: string | null }>("/api/v1/study-sessions", {
          ...timing,
          title: title.trim(),
          subject: subject.trim(),
          notes: notes.trim() || null,
          color,
          reminderLeadMinutes: reminderLead,
          habitId: habitId || null,
          ...(repeat === "NONE"
            ? {}
            : {
                series: {
                  repeat,
                  daysOfWeek:
                    repeat === "WEEKLY" ? [weekdayOfIsoDay(day)] : days,
                },
              }),
        });
        if (saved.warning) toast.warning(saved.warning);
        else toast.success("Session added.");
      }

      onSaved();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors);
      } else {
        setError("Could not save the session.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit session" : "Add a session"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Changes apply to this session only."
              : "Pick a day and a time. A repeating session fills the week for you."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Field
            label="What are you studying"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Revise graph traversal"
            maxLength={120}
            error={fieldErrors.title}
            disabled={busy}
          />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="study-subject">Subject</Label>
            <Input
              id="study-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="DSA"
              maxLength={80}
              disabled={busy}
              aria-invalid={fieldErrors.subject ? true : undefined}
            />
            <div className="flex flex-wrap gap-1">
              {STUDY_SUBJECT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={busy}
                  onClick={() => setSubject(preset)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                    subject === preset
                      ? "border-lime bg-lime-soft text-lime"
                      : "border-line text-ink-subtle hover:border-line-strong hover:text-ink",
                  )}
                >
                  {preset}
                </button>
              ))}
            </div>
            {fieldErrors.subject ? (
              <p role="alert" className="text-xs text-negative">
                {fieldErrors.subject}
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label="Day"
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              disabled={busy || lockedToSeries}
              hint={lockedToSeries ? "Move it with reschedule" : undefined}
            />
            <Field
              label="Starts"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              disabled={busy}
            />
            <Field
              label="Ends"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              disabled={busy}
              error={fieldErrors.endTime}
            />
          </div>

          {durationMinutes !== null ? (
            <p className="-mt-1 text-[11px] text-ink-subtle">
              {durationMinutes} minutes · {formatClock(startMinutes!)} – {formatClock(endMinutes!)}
            </p>
          ) : null}

          {conflict ? (
            <p className="flex items-start gap-2 rounded-control bg-amber/10 px-2.5 py-2 text-[12px] text-amber">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                That overlaps “{conflict.title}” (
                {formatClock(conflict.startMinutes)} –{" "}
                {formatClock(conflict.startMinutes + conflict.durationMinutes)}). You can
                still save it.
              </span>
            </p>
          ) : null}

          {lockedToSeries ? (
            <p className="flex items-start gap-2 rounded-control bg-surface-2 px-2.5 py-2 text-[12px] text-ink-subtle">
              <Repeat className="mt-0.5 size-3.5 shrink-0" />
              <span>
                This session belongs to “{editing?.series?.title}”. Editing it here only
                changes this one - the rest of the schedule is left alone.
              </span>
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label>Repeats</Label>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { value: "NONE", label: "Does not repeat" },
                    { value: "WEEKLY", label: "Every week" },
                    { value: "CUSTOM", label: "Custom days" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setRepeat(option.value);
                      if (option.value === "WEEKLY") {
                        setDays([weekdayOfIsoDay(day)]);
                      }
                    }}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                      repeat === option.value
                        ? "border-lime bg-lime-soft text-lime"
                        : "border-line text-ink-subtle hover:border-line-strong hover:text-ink",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {repeat === "CUSTOM" ? (
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
                          "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
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
              ) : null}

              {repeat !== "NONE" ? (
                <p className="text-[11px] text-ink-subtle">
                  {repeat === "WEEKLY"
                    ? `Every ${STUDY_WEEKDAYS.find((w) => w.jsDay === weekdayOfIsoDay(day))?.long ?? "week"}, from ${dayLabel(day)}`
                    : days.length > 0
                      ? repeatLabel("CUSTOM", days)
                      : "Pick the days it happens on."}
                </p>
              ) : null}
              {fieldErrors.days ? (
                <p role="alert" className="text-xs text-negative">
                  {fieldErrors.days}
                </p>
              ) : null}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="study-habit">Counts towards a habit</Label>
              <select
                id="study-habit"
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
              <p className="text-[11px] text-ink-subtle">
                Finishing the session logs this habit under its own rules.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="study-reminder">Reminder</Label>
              <select
                id="study-reminder"
                value={reminderLead === null ? "" : String(reminderLead)}
                onChange={(e) =>
                  setReminderLead(e.target.value === "" ? null : Number(e.target.value))
                }
                disabled={busy}
                className="h-9 rounded-control border border-line bg-surface px-2.5 text-[13px] text-ink"
              >
                {REMINDER_OPTIONS.map((option) => (
                  <option key={String(option.value)} value={option.value ?? ""}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-ink-subtle">
                Reminders arrive with your notifications.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Colour</Label>
            <div className="flex flex-wrap gap-1.5">
              {STUDY_COLOR_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={busy}
                  aria-label={`Use colour ${preset}`}
                  aria-pressed={color === preset}
                  onClick={() => setColor(preset)}
                  style={{ backgroundColor: preset }}
                  className={cn(
                    "size-6 rounded-full border-2 transition-transform",
                    color === preset ? "border-ink scale-110" : "border-transparent",
                  )}
                />
              ))}
            </div>
          </div>

          <Field
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Chapter 4, past papers"
            maxLength={4000}
            disabled={busy}
            hint="Optional"
          >
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} disabled={busy} />
          </Field>

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
          <Button
            variant="lime"
            onClick={save}
            loading={busy}
            loadingText="Saving"
            disabled={Boolean(timingError)}
          >
            {editing ? "Save changes" : "Add session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
