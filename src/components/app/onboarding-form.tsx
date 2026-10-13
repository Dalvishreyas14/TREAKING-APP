"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";

import { Field } from "@/components/auth/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api, ApiClientError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

/**
 * First-run onboarding.
 *
 * Four short steps rather than one long form, because the questions are only
 * answerable in context: nobody can tell you their realistic weekday capacity
 * until they have seen what the planner will do with it. Each step is skippable
 * and every answer has a default, so a user who leaves at step one still lands
 * on a working dashboard — this collects preferences, it does not gate the app.
 *
 * Times are held as minutes-from-midnight in state rather than as `Date`s, for
 * the reason described in `src/lib/date.ts`.
 */

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

interface OnboardingState {
  name: string;
  timezone: string;
  weekStartsOn: number;
  dailySummaryTime: number;
  gamificationOn: boolean;
  wakeMinutes: number;
  sleepMinutes: number;
  availableWeekdayMinutes: number;
  availableWeekendMinutes: number;
  occupation: string;
  workLabel: string;
  workStartMinutes: number | null;
  workEndMinutes: number | null;
  workDays: number[];
  importantHabits: string[];
  goalsSummary: string;
}

const STEPS = ["You", "Rhythm", "Work", "Focus"] as const;

function initialState(defaults: Partial<OnboardingState> = {}): OnboardingState {
  return {
    name: "",
    timezone: "UTC",
    weekStartsOn: 1,
    dailySummaryTime: 20 * 60,
    gamificationOn: true,
    wakeMinutes: 7 * 60,
    sleepMinutes: 23 * 60,
    availableWeekdayMinutes: 4 * 60,
    availableWeekendMinutes: 4 * 60,
    occupation: "",
    workLabel: "",
    workStartMinutes: null,
    workEndMinutes: null,
    workDays: [1, 2, 3, 4, 5],
    importantHabits: [],
    goalsSummary: "",
    ...defaults,
  };
}

/** "07:30" from 450, for a native time input. */
function toTimeValue(minutes: number): string {
  const h = String(Math.floor(minutes / 60) % 24).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

/** 450 from "07:30", for a native time input's change event. */
function fromTimeValue(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

function StepDots({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="Progress">
      {STEPS.map((step, index) => (
        <li key={step} className="flex items-center gap-1.5">
          <span
            aria-current={index === current ? "step" : undefined}
            className={cn(
              "grid size-5 place-items-center rounded-full text-[10px] font-semibold transition-colors",
              index < current
                ? "bg-lime text-ink-inverse"
                : index === current
                  ? "border border-lime text-lime"
                  : "border border-line text-ink-subtle",
            )}
          >
            {index < current ? <Check aria-hidden className="size-3" /> : index + 1}
          </span>
          <span className="sr-only">
            {step}
            {index === current ? ", current step" : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function OnboardingForm({
  defaults,
}: {
  defaults: Partial<OnboardingState>;
}) {
  const router = useRouter();
  const detectedTimezone = useDetectedTimezone();
  const [step, setStep] = React.useState(0);
  const [state, setState] = React.useState<OnboardingState>(() =>
    initialState(defaults),
  );
  const [habitDraft, setHabitDraft] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);

  const set = <K extends keyof OnboardingState>(
    key: K,
    value: OnboardingState[K],
  ) => setState((s) => ({ ...s, [key]: value }));

  function addHabit() {
    const value = habitDraft.trim();
    if (!value) return;
    if (state.importantHabits.length >= 12) return;
    if (
      state.importantHabits.some(
        (h) => h.toLowerCase() === value.toLowerCase(),
      )
    ) {
      setHabitDraft("");
      return;
    }
    set("importantHabits", [...state.importantHabits, value]);
    setHabitDraft("");
  }

  function toggleDay(day: number) {
    set(
      "workDays",
      state.workDays.includes(day)
        ? state.workDays.filter((d) => d !== day)
        : [...state.workDays, day].sort((a, b) => a - b),
    );
  }

  async function finish() {
    setPending(true);
    setErrors({});
    try {
      await api.post("/api/v1/onboarding", {
        ...state,
        // The browser's zone wins over the stored default, which is UTC for a
        // freshly created account.
        timezone: detectedTimezone ?? state.timezone,
        occupation: state.occupation || null,
        workLabel: state.workLabel || null,
        goalsSummary: state.goalsSummary || null,
      });
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      setPending(false);
      if (error instanceof ApiClientError) {
        setErrors({ ...error.fieldErrors, form: error.message });
        // A validation failure on a later field means the user is looking at the
        // wrong step, so send them back rather than only colouring a hidden input.
        setStep(0);
      } else {
        setErrors({ form: "Something went wrong. Please try again." });
      }
    }
  }

  const isLast = step === STEPS.length - 1;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
      <div className="flex items-center justify-between">
        <StepDots current={step} />
        <Button variant="ghost" size="xs" onClick={finish} disabled={pending}>
          Skip for now
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {step === 0 ? (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.015em]">
                  What should we call you?
                </h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
                  This is the only thing we ask before you see the app.
                </p>
              </div>
              <Field
                label="Name"
                name="name"
                autoComplete="name"
                autoFocus
                value={state.name}
                onChange={(e) => set("name", e.target.value)}
                error={errors.name}
                placeholder="Alex"
              />
              <TimezoneField value={detectedTimezone ?? state.timezone} />
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-ink-muted">
                  Week starts on
                </span>
                <div className="flex gap-2">
                  {[
                    { value: 1, label: "Monday" },
                    { value: 0, label: "Sunday" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => set("weekStartsOn", option.value)}
                      aria-pressed={state.weekStartsOn === option.value}
                      className={cn(
                        "h-9 flex-1 rounded-control border text-[13px] font-medium transition-colors",
                        state.weekStartsOn === option.value
                          ? "border-lime bg-lime-soft text-ink"
                          : "border-line text-ink-muted hover:bg-surface-2",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.015em]">
                  What does your day look like?
                </h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
                  The planner will only suggest times you actually have free.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="I usually wake at"
                  type="time"
                  name="wake"
                  value={toTimeValue(state.wakeMinutes)}
                  onChange={(e) => {
                    const v = fromTimeValue(e.target.value);
                    if (v != null) set("wakeMinutes", v);
                  }}
                />
                <Field
                  label="And sleep at"
                  type="time"
                  name="sleep"
                  value={toTimeValue(state.sleepMinutes)}
                  onChange={(e) => {
                    const v = fromTimeValue(e.target.value);
                    if (v != null) set("sleepMinutes", v);
                  }}
                  error={errors.sleepMinutes}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <MinutesField
                  label="Free on a weekday"
                  minutes={state.availableWeekdayMinutes}
                  onChange={(v) => set("availableWeekdayMinutes", v)}
                />
                <MinutesField
                  label="Free on a weekend"
                  minutes={state.availableWeekendMinutes}
                  onChange={(v) => set("availableWeekendMinutes", v)}
                />
              </div>
              <p className="text-[12px] leading-relaxed text-ink-subtle">
                An honest number helps more than an ambitious one. You can change
                all of this later in settings.
              </p>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.015em]">
                  Where does your time go?
                </h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
                  Optional. It lets LIFEOS protect the hours that are already
                  spoken for.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="What you do"
                  name="occupation"
                  value={state.occupation}
                  onChange={(e) => set("occupation", e.target.value)}
                  placeholder="Software engineer"
                />
                <Field
                  label="Called what"
                  name="workLabel"
                  value={state.workLabel}
                  onChange={(e) => set("workLabel", e.target.value)}
                  placeholder="Work, University…"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Starts at"
                  type="time"
                  name="workStart"
                  value={
                    state.workStartMinutes == null
                      ? ""
                      : toTimeValue(state.workStartMinutes)
                  }
                  onChange={(e) =>
                    set("workStartMinutes", fromTimeValue(e.target.value))
                  }
                />
                <Field
                  label="Ends at"
                  type="time"
                  name="workEnd"
                  value={
                    state.workEndMinutes == null
                      ? ""
                      : toTimeValue(state.workEndMinutes)
                  }
                  onChange={(e) =>
                    set("workEndMinutes", fromTimeValue(e.target.value))
                  }
                  error={errors.workStartMinutes}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-ink-muted">
                  Which days
                </span>
                <div className="flex gap-1.5">
                  {DAY_NAMES.map((day, index) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(index)}
                      aria-pressed={state.workDays.includes(index)}
                      aria-label={day}
                      className={cn(
                        "h-8 flex-1 rounded-control border text-[12px] font-medium transition-colors",
                        state.workDays.includes(index)
                          ? "border-lime bg-lime-soft text-ink"
                          : "border-line text-ink-muted hover:bg-surface-2",
                      )}
                    >
                      {day[0]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.015em]">
                  What are you working towards?
                </h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
                  Optional, and the most valuable thing here. Goals become
                  milestones, and milestones become tasks.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="onboard-habits"
                  className="text-[13px] font-medium text-ink-muted"
                >
                  Habits you want to keep
                </label>
                <div className="flex gap-2">
                  <input
                    id="onboard-habits"
                    value={habitDraft}
                    onChange={(e) => setHabitDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addHabit();
                      }
                    }}
                    placeholder="Morning walk"
                    className="h-9 min-w-0 flex-1 rounded-control border border-line bg-canvas px-3 text-[13px] outline-none focus:border-lime"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={addHabit}
                    disabled={!habitDraft.trim()}
                  >
                    Add
                  </Button>
                </div>
                {state.importantHabits.length > 0 ? (
                  <ul className="flex flex-wrap gap-1.5 pt-1">
                    {state.importantHabits.map((habit) => (
                      <li key={habit}>
                        <button
                          type="button"
                          onClick={() =>
                            set(
                              "importantHabits",
                              state.importantHabits.filter((h) => h !== habit),
                            )
                          }
                          className="inline-flex h-7 items-center gap-1.5 rounded-control border border-line bg-surface-2 px-2.5 text-[12px] text-ink-muted transition-colors hover:text-negative"
                        >
                          {habit}
                          <span aria-hidden>&times;</span>
                          <span className="sr-only">Remove {habit}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="onboard-goals"
                  className="text-[13px] font-medium text-ink-muted"
                >
                  In your own words
                </label>
                <textarea
                  id="onboard-goals"
                  rows={4}
                  value={state.goalsSummary}
                  onChange={(e) => set("goalsSummary", e.target.value)}
                  placeholder="Run a half marathon by spring. Read more. Stop checking my phone in bed."
                  className="resize-y rounded-control border border-line bg-canvas px-3 py-2.5 text-[13px] leading-relaxed outline-none focus:border-lime"
                />
              </div>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-control border border-line bg-surface-2 p-3">
                <input
                  type="checkbox"
                  checked={state.gamificationOn}
                  onChange={(e) => set("gamificationOn", e.target.checked)}
                  className="mt-0.5 size-4 accent-lime"
                />
                <span>
                  <span className="text-[13px] font-medium text-ink">
                    Streaks and levels
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-muted">
                    A little external structure. Turn it off any time — the
                    tracker works identically without it.
                  </span>
                </span>
              </label>
            </div>
          ) : null}

          {errors.form ? (
            <p
              role="alert"
              className="mt-4 rounded-control border border-negative/30 bg-negative/8 px-3 py-2.5 text-[13px] leading-relaxed text-negative"
            >
              {errors.form}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || pending}
        >
          <ArrowLeft aria-hidden />
          Back
        </Button>
        {isLast ? (
          <Button variant="lime" onClick={finish} loading={pending}>
            {pending ? "Finishing" : "Open my dashboard"}
            {!pending ? <ArrowRight aria-hidden /> : null}
          </Button>
        ) : (
          <Button variant="lime" onClick={() => setStep((s) => s + 1)}>
            Continue
            <ArrowRight aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The browser's IANA timezone, or null during SSR.
 *
 * The server cannot know this, and it cannot be read in an effect without
 * cascading a render, so the snapshot is asked for directly: null on the server,
 * the real zone once the client takes over. React reconciles that itself.
 */
function useDetectedTimezone(): string | null {
  return React.useSyncExternalStore(
    () => () => {},
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    () => null,
  );
}

function TimezoneField({ value }: { value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink-muted">Timezone</span>
      <p className="flex items-center gap-2 text-[13px] text-ink">
        {value}
        {value !== "UTC" ? (
          <Badge variant="lime" className="text-[10px]">
            detected
          </Badge>
        ) : null}
      </p>
      <p className="text-[12px] leading-relaxed text-ink-subtle">
        Your days are planned in this zone, so &ldquo;today&rdquo; means what you
        think it means. Change it in settings at any time.
      </p>
    </div>
  );
}

function MinutesField({
  label,
  minutes,
  onChange,
}: {
  label: string;
  minutes: number;
  onChange: (minutes: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink-muted">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={12 * 60}
          step={15}
          value={minutes}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
          className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-surface-3 accent-lime"
        />
        <span className="w-16 shrink-0 text-right font-mono text-[12px] text-ink-muted">
          {Math.floor(minutes / 60)}h {String(minutes % 60).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}
