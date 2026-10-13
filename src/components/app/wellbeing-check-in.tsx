"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save } from "lucide-react";

import { MetricDisclosure } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, ApiClientError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

/**
 * The daily wellbeing check-in.
 *
 * Four 1-5 scales and an optional note, all on one screen, because the whole
 * design fails if logging takes more than thirty seconds — a check-in you do not
 * finish is the same as no check-in at all.
 *
 * Stress is stored as a plain 1-5 where 5 is "most stressed", and the chart
 * inverts it on display so that "up" always reads as "better". Mixing that
 * convention silently is the fastest way to make a wellbeing chart lie.
 */

export interface WellbeingEntry {
  date: string;
  mood: number;
  energy: number;
  stress: number;
  sleepQuality: number;
  sleepHours: number | null;
  note: string | null;
}

const SCALES = [
  { key: "mood", label: "Mood", low: "Rough", high: "Great" },
  { key: "energy", label: "Energy", low: "Empty", high: "Charged" },
  { key: "stress", label: "Stress", low: "Calm", high: "Stretched" },
  { key: "sleepQuality", label: "Sleep", low: "Broken", high: "Restful" },
] as const;

type ScaleKey = (typeof SCALES)[number]["key"];

type Draft = Record<ScaleKey, number> & { sleepHoursH: string; sleepHoursM: string; note: string };

const DEFAULTS: Draft = {
  mood: 3,
  energy: 3,
  stress: 3,
  sleepQuality: 3,
  sleepHoursH: "",
  sleepHoursM: "",
  note: "",
};

/** Dropdown choices for "Hours slept". Empty string means "not set". */
const SLEEP_HOURS_OPTIONS = ["", ...Array.from({ length: 25 }, (_, i) => String(i))];
const SLEEP_MINUTES_OPTIONS = ["", ...Array.from({ length: 12 }, (_, i) => String(i * 5))];

/** `7.5` → `{ sleepHoursH: "7", sleepHoursM: "30" }`, so a saved entry reopens in the same words it was written. */
function splitSleepHours(value: number | null): { sleepHoursH: string; sleepHoursM: string } {
  if (value == null || !Number.isFinite(value)) return { sleepHoursH: "", sleepHoursM: "" };
  // Rounded to the nearest 5 minutes so the value always lands on an option the
  // minutes dropdown actually offers — otherwise the select would render blank.
  const total = Math.min(Math.max(Math.round((value * 60) / 5) * 5, 0), 24 * 60);
  return { sleepHoursH: String(Math.floor(total / 60)), sleepHoursM: String(total % 60) };
}

/** The two dropdowns back to one decimal hour value, or `null` when neither has been set. */
function joinSleepHours(h: string, m: string): number | null {
  if (h === "" && m === "") return null;
  return Math.min(24, Number(h || 0) + Number(m || 0) / 60);
}

/** `7.5` → `7h 30m` — decimal hours read as numbers, not as time. */
function formatSleepHours(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const total = Math.round(Math.min(Math.max(value * 60, 0), 24 * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0 && m === 0) return "0m";
  if (m === 0) return `${h}h`;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function WellbeingCheckIn({
  todayEntry,
  history,
}: {
  todayEntry: WellbeingEntry | null;
  history: WellbeingEntry[];
}) {
  const router = useRouter();
  const [draft, setDraft] = React.useState<Draft>(() =>
    todayEntry
      ? {
          mood: todayEntry.mood,
          energy: todayEntry.energy,
          stress: todayEntry.stress,
          sleepQuality: todayEntry.sleepQuality,
          ...splitSleepHours(todayEntry.sleepHours),
          note: todayEntry.note ?? "",
        }
      : DEFAULTS,
  );
  const [pending, setPending] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    try {
      await api.post("/api/v1/wellbeing", {
        date: new Date().toISOString(),
        mood: draft.mood,
        energy: draft.energy,
        stress: draft.stress,
        sleepQuality: draft.sleepQuality,
        sleepHours: joinSleepHours(draft.sleepHoursH, draft.sleepHoursM),
        note: draft.note.trim() || null,
      });
      toast.success(todayEntry ? "Today's check-in updated." : "Logged. Thank you.");
      router.refresh();
    } catch (error) {
      setErrors(
        error instanceof ApiClientError
          ? { ...error.fieldErrors, form: error.message }
          : { form: "Could not save that check-in." },
      );
    } finally {
      setPending(false);
    }
  }

  const sleptValues = history
    .map((e) => e.sleepHours)
    .filter((v): v is number => v != null);
  const averageSleep =
    sleptValues.length === 0
      ? null
      : sleptValues.reduce((a, b) => a + b, 0) / sleptValues.length;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
      <Card>
        <CardHeader className="space-y-0 pb-3">
          <CardTitle className="text-[13px]">
            {todayEntry ? "Update today" : "How are you today?"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="flex flex-col gap-5" noValidate>
            {SCALES.map((scale) => (
              <div key={scale.key} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] font-medium text-ink-muted">
                    {scale.label}
                  </span>
                  <span className="text-[12px] text-ink-subtle">
                    {draft[scale.key]}/5
                  </span>
                </div>
                <div
                  role="radiogroup"
                  aria-label={scale.label}
                  className="flex gap-1.5"
                >
                  {[1, 2, 3, 4, 5].map((value) => {
                    const selected = draft[scale.key] === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={`${scale.label} ${value} of 5`}
                        onClick={() => set(scale.key, value)}
                        className={cn(
                          "h-9 flex-1 rounded-control border text-[13px] font-medium transition-colors",
                          selected
                            ? "border-lime bg-lime text-ink-inverse"
                            : "border-line text-ink-muted hover:bg-surface-2",
                        )}
                      >
                        {value}
                      </button>
                    );
                  })}
                </div>
                <div className="flex justify-between text-[11px] text-ink-subtle">
                  <span>{scale.low}</span>
                  <span>{scale.high}</span>
                </div>
              </div>
            ))}

            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-muted">
                Hours slept
              </span>
              <div className="flex items-center gap-1.5">
                <select
                  aria-label="Hours slept, hours"
                  value={draft.sleepHoursH}
                  onChange={(e) => set("sleepHoursH", e.target.value)}
                  className="h-9 w-[4.5rem] rounded-control border border-line bg-canvas px-2 text-[13px] outline-none focus:border-lime"
                >
                  {SLEEP_HOURS_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value === "" ? "—" : value}
                    </option>
                  ))}
                </select>
                <span className="text-[12px] text-ink-subtle">h</span>
                <select
                  aria-label="Hours slept, minutes"
                  value={draft.sleepHoursM}
                  onChange={(e) => set("sleepHoursM", e.target.value)}
                  className="h-9 w-[4.5rem] rounded-control border border-line bg-canvas px-2 text-[13px] outline-none focus:border-lime"
                >
                  {SLEEP_MINUTES_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value === "" ? "—" : value}
                    </option>
                  ))}
                </select>
                <span className="text-[12px] text-ink-subtle">m</span>
              </div>
              {errors.sleepHours ? (
                <p className="text-[12px] text-negative">{errors.sleepHours}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="wellbeing-note"
                className="text-[13px] font-medium text-ink-muted"
              >
                Anything worth noting
              </label>
              <textarea
                id="wellbeing-note"
                rows={3}
                value={draft.note}
                onChange={(e) => set("note", e.target.value)}
                placeholder="Slept badly, long day, felt good about the call."
                className="resize-y rounded-control border border-line bg-canvas px-3 py-2.5 text-[13px] leading-relaxed outline-none focus:border-lime"
              />
            </div>

            {errors.form ? (
              <p
                role="alert"
                className="rounded-control border border-negative/30 bg-negative/8 px-3 py-2.5 text-[13px] text-negative"
              >
                {errors.form}
              </p>
            ) : null}

            <Button type="submit" variant="lime" loading={pending} className="w-full">
              <Save aria-hidden />
              {todayEntry ? "Update check-in" : "Log today"}
            </Button>

            <MetricDisclosure variant="wellbeing" />
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-0 pb-3">
          <CardTitle className="text-[13px]">Last {history.length} days</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-ink-subtle">
              Nothing logged yet. One entry a day is enough to start seeing
              something.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <Trend title="Mood and energy" series={[
                { label: "Mood", color: "var(--color-lime)", values: history.map((e) => e.mood) },
                { label: "Energy", color: "var(--color-iris)", values: history.map((e) => e.energy) },
              ]} />
              <Trend
                title="Stress (inverted, so up is better)"
                series={[
                  {
                    label: "Calm",
                    color: "var(--color-aqua)",
                    // 6 - stress so a low-stress day plots high, matching the
                    // "up is better" reading of every other row on this screen.
                    values: history.map((e) => 6 - e.stress),
                  },
                ]}
              />
              <div className="grid grid-cols-2 gap-3 border-t border-line pt-3 text-center">
                <Average
                  label="Average mood"
                  value={average(history.map((e) => e.mood))}
                />
                <Average
                  label="Average sleep"
                  value={formatSleepHours(averageSleep)}
                />
              </div>
              <MetricDisclosure variant="insight" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function average(values: number[]): string {
  if (values.length === 0) return "—";
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return mean % 1 === 0 ? String(mean) : mean.toFixed(1);
}

/**
 * A minimal inline line chart.
 *
 * Hand-drawn rather than pulled from a charting library: this is four polylines
 * with no axes to configure, no tooltips to wire and no zoom. A dependency that
 * renders 40kb of JavaScript to draw a 2px `polyline` would be a poor trade.
 * Values are 1-5, so the y-scale is fixed and the "empty" baseline is honest.
 */
function Trend({
  title,
  series,
}: {
  title: string;
  series: { label: string; color: string; values: number[] }[];
}) {
  const width = 100;
  const height = 28;
  // 1-5 mapped onto the full height, so a flat 3/5 sits mid-chart.
  const y = (v: number) => height - ((v - 1) / 4) * height;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-[12px] font-medium text-ink-muted">{title}</p>
        <div className="flex gap-2.5">
          {series.map((s) => (
            <span
              key={s.label}
              className="flex items-center gap-1 text-[11px] text-ink-subtle"
            >
              <span
                aria-hidden
                className="size-1.5 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="mt-2 h-16 w-full"
        role="img"
        aria-label={title}
      >
        {[1, 3, 5].map((tick) => (
          <line
            key={tick}
            x1={0}
            x2={width}
            y1={y(tick)}
            y2={y(tick)}
            className="stroke-line"
            strokeWidth={0.3}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {series.map((s) => {
          if (s.values.length < 2) return null;
          const step = width / (s.values.length - 1);
          const points = s.values
            .map((v, i) => `${(i * step).toFixed(2)},${y(v).toFixed(2)}`)
            .join(" ");
          return (
            <polyline
              key={s.label}
              points={points}
              fill="none"
              stroke={s.color}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
    </div>
  );
}

function Average({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-ink-subtle">{label}</p>
      <p className="mt-0.5 text-[15px] font-semibold">{value}</p>
    </div>
  );
}
