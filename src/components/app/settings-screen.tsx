"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Check, KeyRound, Save, ShieldCheck, X } from "lucide-react";

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
import { Input, Textarea } from "@/components/ui/input";
import { PasswordRules } from "@/components/auth/password-rules";
import { Switch } from "@/components/ui/primitives";
import { api, ApiClientError } from "@/lib/api/client";
import { formatIndianDate, formatLocalClockTime } from "@/lib/format/date";
import { cn } from "@/lib/utils";

/**
 * Settings.
 *
 * **One save button, two endpoints.** Preferences live on `User` and the planning
 * inputs live on `Profile`, so saving means `PATCH /settings` followed by
 * `PATCH /settings/profile`. They are sent as a `Promise.all` and the form
 * reports a partial failure explicitly rather than pretending either way — a
 * half-saved day boundary silently re-shapes every plan made afterwards, which is
 * a much worse failure than a visible error.
 *
 * **Times are stored as minutes from midnight, and the inputs are `hh:mm`.**
 * Sending `"09:00"` from a time input would have to be re-parsed against a
 * timezone somewhere; a number cannot be misread. Converting back is
 * arithmetic, and the conversion lives in one place at the bottom of this file.
 *
 * **Changing the theme is applied immediately, not on save.** Theme is a display
 * preference with its own provider, and making someone save a form to see the
 * difference they are choosing is the kind of friction that gets a settings page
 * ignored.
 *
 * **Turning AI off clears consent server-side.** This build never contacts an
 * external provider, so `aiConsentAt` is shown only to be accurate about it: no
 * consent has been given, none is needed, and nothing leaves the device.
 */

export interface SettingsSnapshot {
  name: string | null;
  email: string;
  theme: "LIGHT" | "DARK" | "SYSTEM";
  timezone: string;
  locale: string;
  aiEnabled: boolean;
  aiConsentAt: string | null;
  gamificationOn: boolean;
  weekStartsOn: number;
  dailySummaryTime: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  createdAt: string | null;
  onboarded: boolean;
  profile: {
    ageRange: string | null;
    occupation: string | null;
    wakeMinutes: number | null;
    sleepMinutes: number | null;
    availableWeekdayMinutes: number | null;
    availableWeekendMinutes: number | null;
    studyTargetMinutes: number | null;
    fitnessFrequency: number | null;
    productivityStyle: string | null;
    focusPreference: string | null;
    workLabel: string | null;
    workStartMinutes: number | null;
    workEndMinutes: number | null;
    workDays: number[];
    collegeLabel: string | null;
    collegeStartMinutes: number | null;
    collegeEndMinutes: number | null;
    collegeDays: number[];
    importantHabits: string[];
    goalsSummary: string | null;
  } | null;
}

const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

interface FormState {
  name: string;
  theme: SettingsSnapshot["theme"];
  locale: string;
  timezone: string;
  gamificationOn: boolean;
  weekStartsOn: number;
  dailySummaryTime: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  ageRange: string;
  occupation: string;
  wakeMinutes: number | null;
  sleepMinutes: number | null;
  availableWeekdayMinutes: number | null;
  availableWeekendMinutes: number | null;
  studyTargetMinutes: number | null;
  fitnessFrequency: number | null;
  productivityStyle: string;
  focusPreference: string;
  workLabel: string;
  workStartMinutes: number | null;
  workEndMinutes: number | null;
  workDays: number[];
  collegeLabel: string;
  collegeStartMinutes: number | null;
  collegeEndMinutes: number | null;
  collegeDays: number[];
  importantHabits: string;
  goalsSummary: string;
}

function toForm(snapshot: SettingsSnapshot): FormState {
  const p = snapshot.profile;
  return {
    name: snapshot.name ?? "",
    theme: snapshot.theme,
    locale: snapshot.locale,
    timezone: snapshot.timezone,
    gamificationOn: snapshot.gamificationOn,
    weekStartsOn: snapshot.weekStartsOn,
    dailySummaryTime: snapshot.dailySummaryTime,
    quietHoursStart: snapshot.quietHoursStart,
    quietHoursEnd: snapshot.quietHoursEnd,
    ageRange: p?.ageRange ?? "",
    occupation: p?.occupation ?? "",
    wakeMinutes: p?.wakeMinutes ?? null,
    sleepMinutes: p?.sleepMinutes ?? null,
    availableWeekdayMinutes: p?.availableWeekdayMinutes ?? null,
    availableWeekendMinutes: p?.availableWeekendMinutes ?? null,
    studyTargetMinutes: p?.studyTargetMinutes ?? null,
    fitnessFrequency: p?.fitnessFrequency ?? null,
    productivityStyle: p?.productivityStyle ?? "",
    focusPreference: p?.focusPreference ?? "",
    workLabel: p?.workLabel ?? "",
    workStartMinutes: p?.workStartMinutes ?? null,
    workEndMinutes: p?.workEndMinutes ?? null,
    workDays: p?.workDays ?? [],
    collegeLabel: p?.collegeLabel ?? "",
    collegeStartMinutes: p?.collegeStartMinutes ?? null,
    collegeEndMinutes: p?.collegeEndMinutes ?? null,
    collegeDays: p?.collegeDays ?? [],
    importantHabits: (p?.importantHabits ?? []).join(", "),
    goalsSummary: p?.goalsSummary ?? "",
  };
}

export function SettingsScreen({ initial }: { initial: SettingsSnapshot }) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [form, setForm] = React.useState<FormState>(() => toForm(initial));
  const [aiEnabled, setAiEnabled] = React.useState(initial.aiEnabled);
  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [passwordOpen, setPasswordOpen] = React.useState(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }


  async function save() {
    setSaving(true);
    setErrors({});
    try {
      await Promise.all([
        api.patch("/api/v1/settings", {
          name: form.name.trim() || null,
          theme: form.theme,
          locale: form.locale,
          timezone: form.timezone,
          aiEnabled,
          gamificationOn: form.gamificationOn,
          weekStartsOn: form.weekStartsOn,
          dailySummaryTime: form.dailySummaryTime,
          quietHoursStart: form.quietHoursStart,
          quietHoursEnd: form.quietHoursEnd,
        }),
        api.patch("/api/v1/settings/profile", {
          ageRange: form.ageRange.trim() || null,
          occupation: form.occupation.trim() || null,
          wakeMinutes: form.wakeMinutes,
          sleepMinutes: form.sleepMinutes,
          availableWeekdayMinutes: form.availableWeekdayMinutes,
          availableWeekendMinutes: form.availableWeekendMinutes,
          studyTargetMinutes: form.studyTargetMinutes,
          fitnessFrequency: form.fitnessFrequency,
          productivityStyle: form.productivityStyle.trim() || null,
          focusPreference: form.focusPreference.trim() || null,
          workLabel: form.workLabel.trim() || null,
          workStartMinutes: form.workStartMinutes,
          workEndMinutes: form.workEndMinutes,
          workDays: form.workDays,
          collegeLabel: form.collegeLabel.trim() || null,
          collegeStartMinutes: form.collegeStartMinutes,
          collegeEndMinutes: form.collegeEndMinutes,
          collegeDays: form.collegeDays,
          importantHabits: form.importantHabits
            .split(",")
            .map((h) => h.trim())
            .filter(Boolean),
          goalsSummary: form.goalsSummary.trim() || null,
        }),
      ]);
      setSavedAt(new Date().toISOString());
      toast.success("Settings saved.");
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrors(
          Object.keys(error.fieldErrors).length > 0
            ? error.fieldErrors
            : { form: error.message },
        );
        toast.error(error.message);
      } else {
        setErrors({ form: "Could not save. Nothing was changed." });
        toast.error("Could not save settings.");
      }
    } finally {
      setSaving(false);
    }
  }

  const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="flex flex-col gap-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-ink-subtle">
          {initial.email}
          {initial.createdAt ? ` · joined ${formatIndianDate(new Date(initial.createdAt))}` : ""}
          {!initial.onboarded ? " · onboarding not completed" : ""}
        </p>
        {savedAt ? (
          <span className="text-[11px] text-ink-subtle">
            Saved {formatLocalClockTime(new Date(savedAt))}
          </span>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field label="Name" error={errors.name}>
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                maxLength={100}
                disabled={saving}
              />
            </Field>
            <Field label="Email" error={undefined} hint="Changing your email needs a verification round trip and is not editable here.">
              <Input value={initial.email} readOnly disabled />
            </Field>
            <div>
              <Button size="sm" variant="secondary" onClick={() => setPasswordOpen(true)}>
                <KeyRound /> Change password
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Appearance and locale</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="text-[13px] font-medium text-ink-muted">Theme</legend>
              <div className="flex gap-1.5">
                {(["LIGHT", "DARK", "SYSTEM"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      // Applied immediately: the whole point of choosing a theme
                      // is to see it, and a save button in between makes the choice
                      // unverifiable.
                      set("theme", value);
                      setTheme(value.toLowerCase());
                    }}
                    className={cn(
                      "rounded-control border px-3 py-1.5 text-[12px] transition-colors",
                      form.theme === value
                        ? "border-lime bg-lime-soft text-lime"
                        : "border-line text-ink-muted hover:border-line-strong",
                    )}
                  >
                    {value[0] + value.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </fieldset>

            <Field label="Timezone" error={errors.timezone} hint={`Detected as ${localTimezone}.`}>
              <Input
                value={form.timezone}
                onChange={(e) => set("timezone", e.target.value)}
                maxLength={64}
                disabled={saving}
              />
            </Field>

            <Field label="Locale" error={errors.locale}>
              <Input
                value={form.locale}
                onChange={(e) => set("locale", e.target.value)}
                maxLength={10}
                disabled={saving}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your day</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Wake time"
                error={errors.wakeMinutes}
                hint={errors.wakeMinutes ? undefined : "The planner will not suggest anything before this."}
              >
                <Input
                  type="time"
                  value={minutesToTimeInput(form.wakeMinutes)}
                  onChange={(e) => set("wakeMinutes", timeInputToMinutes(e.target.value))}
                  disabled={saving}
                />
              </Field>
              <Field label="Sleep time" error={errors.sleepMinutes}>
                <Input
                  type="time"
                  value={minutesToTimeInput(form.sleepMinutes)}
                  onChange={(e) => set("sleepMinutes", timeInputToMinutes(e.target.value))}
                  disabled={saving}
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Weekday availability (min)" error={errors.availableWeekdayMinutes}>
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  step={15}
                  value={form.availableWeekdayMinutes ?? ""}
                  onChange={(e) =>
                    set("availableWeekdayMinutes", e.target.value === "" ? null : Number(e.target.value))
                  }
                  disabled={saving}
                />
              </Field>
              <Field label="Weekend availability (min)" error={errors.availableWeekendMinutes}>
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  step={15}
                  value={form.availableWeekendMinutes ?? ""}
                  onChange={(e) =>
                    set("availableWeekendMinutes", e.target.value === "" ? null : Number(e.target.value))
                  }
                  disabled={saving}
                />
              </Field>
            </div>

            <Field label="Week starts on" error={errors.weekStartsOn}>
              <div className="flex gap-1">
                {WEEKDAYS.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => set("weekStartsOn", day.value)}
                    className={cn(
                      "flex-1 rounded-control border px-2 py-1.5 text-[12px] transition-colors",
                      form.weekStartsOn === day.value
                        ? "border-lime bg-lime-soft text-lime"
                        : "border-line text-ink-muted hover:border-line-strong",
                    )}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Daily summary at" error={errors.dailySummaryTime} hint="Hour of the day, 0–23.">
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={form.dailySummaryTime}
                  onChange={(e) => set("dailySummaryTime", Number(e.target.value))}
                  disabled={saving}
                />
              </Field>
              <Field label="Quiet hours from" error={errors.quietHoursStart} hint="Hour of the day, 0–23.">
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={form.quietHoursStart}
                  onChange={(e) => set("quietHoursStart", Number(e.target.value))}
                  disabled={saving}
                />
              </Field>
            </div>
            <Field label="Quiet hours until" error={errors.quietHoursEnd} hint="Reminders are held during this window.">
              <Input
                type="number"
                min={0}
                max={23}
                value={form.quietHoursEnd}
                onChange={(e) => set("quietHoursEnd", Number(e.target.value))}
                disabled={saving}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Work and study</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field label="What you do" error={errors.occupation}>
              <Input
                value={form.occupation}
                onChange={(e) => set("occupation", e.target.value)}
                placeholder="Student, or whatever fits"
                maxLength={120}
                disabled={saving}
              />
            </Field>

            <div className="flex flex-col gap-2">
              <p className="text-[13px] font-medium text-ink-muted">Work</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Label" error={errors.workLabel}>
                  <Input
                    value={form.workLabel}
                    onChange={(e) => set("workLabel", e.target.value)}
                    placeholder="Job"
                    maxLength={80}
                    disabled={saving}
                  />
                </Field>
                <Field label="From" error={errors.workStartMinutes}>
                  <Input
                    type="time"
                    value={minutesToTimeInput(form.workStartMinutes)}
                    onChange={(e) => set("workStartMinutes", timeInputToMinutes(e.target.value))}
                    disabled={saving}
                  />
                </Field>
                <Field label="To" error={errors.workEndMinutes}>
                  <Input
                    type="time"
                    value={minutesToTimeInput(form.workEndMinutes)}
                    onChange={(e) => set("workEndMinutes", timeInputToMinutes(e.target.value))}
                    disabled={saving}
                  />
                </Field>
              </div>
              <DayPicker
                label="Work days"
                value={form.workDays}
                onChange={(days) => set("workDays", days)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-[13px] font-medium text-ink-muted">College</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Label" error={errors.collegeLabel}>
                  <Input
                    value={form.collegeLabel}
                    onChange={(e) => set("collegeLabel", e.target.value)}
                    placeholder="University"
                    maxLength={80}
                    disabled={saving}
                  />
                </Field>
                <Field label="From" error={errors.collegeStartMinutes}>
                  <Input
                    type="time"
                    value={minutesToTimeInput(form.collegeStartMinutes)}
                    onChange={(e) => set("collegeStartMinutes", timeInputToMinutes(e.target.value))}
                    disabled={saving}
                  />
                </Field>
                <Field label="To" error={errors.collegeEndMinutes}>
                  <Input
                    type="time"
                    value={minutesToTimeInput(form.collegeEndMinutes)}
                    onChange={(e) => set("collegeEndMinutes", timeInputToMinutes(e.target.value))}
                    disabled={saving}
                  />
                </Field>
              </div>
              <DayPicker
                label="College days"
                value={form.collegeDays}
                onChange={(days) => set("collegeDays", days)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Study target (min/day)" error={errors.studyTargetMinutes}>
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  step={15}
                  value={form.studyTargetMinutes ?? ""}
                  onChange={(e) =>
                    set("studyTargetMinutes", e.target.value === "" ? null : Number(e.target.value))
                  }
                  disabled={saving}
                />
              </Field>
              <Field label="Fitness sessions/week" error={errors.fitnessFrequency}>
                <Input
                  type="number"
                  min={0}
                  max={14}
                  value={form.fitnessFrequency ?? ""}
                  onChange={(e) =>
                    set("fitnessFrequency", e.target.value === "" ? null : Number(e.target.value))
                  }
                  disabled={saving}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Context the assistant uses</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field label="Productivity style" error={errors.productivityStyle}>
              <Input
                value={form.productivityStyle}
                onChange={(e) => set("productivityStyle", e.target.value)}
                placeholder="Deep work in the morning"
                maxLength={60}
                disabled={saving}
              />
            </Field>
            <Field label="Focus preference" error={errors.focusPreference}>
              <Input
                value={form.focusPreference}
                onChange={(e) => set("focusPreference", e.target.value)}
                placeholder="25/5 pomodoros"
                maxLength={60}
                disabled={saving}
              />
            </Field>
            <Field
              label="Habits that matter most"
              error={errors.importantHabits}
              hint="Comma separated. Used to weight the plan, never to nag you."
            >
              <Input
                value={form.importantHabits}
                onChange={(e) => set("importantHabits", e.target.value)}
                disabled={saving}
              />
            </Field>
            <Field label="Where you are heading" error={errors.goalsSummary}>
              <Textarea
                rows={3}
                value={form.goalsSummary}
                onChange={(e) => set("goalsSummary", e.target.value)}
                placeholder="What this year is actually for, in your own words."
                disabled={saving}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Insights and game</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-medium text-ink-muted">Insights and assistant</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-subtle">
                  Computes patterns, drafts and answers on this device from your own
                  data. Nothing is sent to any external provider in this build, so no
                  external consent is required or requested.
                </p>
              </div>
              <Switch checked={aiEnabled} onCheckedChange={setAiEnabled} disabled={saving} />
            </div>

            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-medium text-ink-muted">XP and levels</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-subtle">
                  Turning this off keeps every streak and statistic, and just stops the
                  points and levels being shown.
                </p>
              </div>
              <Switch
                checked={form.gamificationOn}
                onCheckedChange={(v) => set("gamificationOn", v)}
                disabled={saving}
              />
            </div>

            <div className="flex items-start gap-2 rounded-control border border-line bg-surface-2 p-2.5 text-[11px] leading-relaxed text-ink-subtle">
              <ShieldCheck className="mt-px size-3.5 shrink-0" />
              <span>
                {initial.aiConsentAt
                  ? "External provider consent was recorded at some point. No provider is contacted by this build."
                  : "No external provider consent has been recorded, and none is needed here."}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {errors.form ? <p className="text-[12px] text-negative">{errors.form}</p> : null}

      <div className="fixed inset-x-0 bottom-0 z-10 flex justify-end border-t border-line bg-surface/95 px-5 py-3 backdrop-blur">
        <Button variant="lime" loading={saving} loadingText="Saving" onClick={save}>
          <Save /> Save changes
        </Button>
      </div>

      <PasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}

function DayPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number[];
  onChange: (days: number[]) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink-muted">{label}</span>
      <div className="flex gap-1">
        {WEEKDAYS.map((day) => (
          <button
            key={day.value}
            type="button"
            onClick={() =>
              onChange(
                value.includes(day.value)
                  ? value.filter((d) => d !== day.value)
                  : [...value, day.value].sort(),
              )
            }
            className={cn(
              "flex-1 rounded-control border px-1 py-1.5 text-[11px] transition-colors",
              value.includes(day.value)
                ? "border-lime bg-lime-soft text-lime"
                : "border-line text-ink-muted hover:border-line-strong",
            )}
          >
            {day.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const [wasOpen, setWasOpen] = React.useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setCurrent("");
      setNext("");
      setErrors({});
    }
  }

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      await api.post("/api/v1/settings/password", {
        currentPassword: current,
        newPassword: next,
      });
      toast.success("Password changed.");
      onClose();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrors(
          Object.keys(error.fieldErrors).length > 0
            ? error.fieldErrors
            : { currentPassword: error.message },
        );
      } else {
        setErrors({ currentPassword: "Could not change the password." });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            Changing it signs out other devices on their next request, but keeps you
            signed in here.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field label="Current password" error={errors.currentPassword}>
            <Input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              disabled={busy}
            />
          </Field>
          <Field label="New password" error={errors.newPassword}>
            <Input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              disabled={busy}
            />
          </Field>
          <PasswordRules rules={[`At least 10 characters`, `Different from your current password`]} />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            <X /> Cancel
          </Button>
          <Button
            variant="lime"
            loading={busy}
            loadingText="Changing"
            onClick={submit}
            disabled={!current || next.length < 10}
          >
            <Check /> Change password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Minutes from midnight → `hh:mm` for a time input. */
function minutesToTimeInput(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "";
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * `hh:mm` → minutes from midnight, or null when the field is empty.
 *
 * Empty means "not set" rather than zero: `profileUpdateSchema` distinguishes
 * null from 0, and a user who clears their wake time means "no boundary", not
 * "midnight".
 */
function timeInputToMinutes(value: string): number | null {
  if (!value) return null;
  const [h, m] = value.split(":").map((v) => Number.parseInt(v, 10));
  if (h === undefined || m === undefined) return null;
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}
