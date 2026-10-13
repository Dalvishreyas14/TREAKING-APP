import { round } from "@/lib/ai/stats";

/**
 * The arithmetic behind the analytics charts.
 *
 * Kept apart from the Recharts components for the same reason the rest of this app
 * keeps planning apart from rendering: a chart is a view of a number, and the
 * number has to be defensible before it is worth drawing. Recharts needs a browser
 * and a DOM; none of this does, so all of it is testable exactly.
 */

export interface ChartPoint {
  /** `YYYY-MM-DD`, the day this point describes. */
  date: string;
  label: string;
  value: number;
}

/**
 * Trailing moving average, aligned so `out[i]` describes `in[i]`.
 *
 * Aligned rather than shifted forward because a trend line that is drawn a few
 * points ahead of the data it averages looks like the data is rising before it
 * did, which is the exact illusion a moving average is supposed to remove.
 *
 * The first `window - 1` entries average whatever exists so far rather than being
 * null. A line that starts a week into the chart is a line whose left-hand third
 * cannot be read against the raw bars beside it; the partial-window values are
 * under-smoothed and the chart says so in its caption.
 */
export function movingAverage(values: number[], window: number): number[] {
  if (window <= 1) return [...values];
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i] ?? 0;
    if (i >= window) sum -= values[i - window] ?? 0;
    out.push(round(sum / Math.min(i + 1, window), 2));
  }
  return out;
}

/** Days in a trailing window that actually contain data, for a caption. */
export function movingAverageWindowLabel(window: number, length: number): string {
  const partial = Math.max(0, window - 1);
  if (partial === 0 || length <= partial) return "average";
  return `${window}-day average`;
}

export interface WeekdayRow {
  /** 0 = Sunday, matching `Date.getDay()`. */
  index: number;
  label: string;
  count: number;
  /** How many times this weekday fell inside the window — the denominator. */
  expected: number;
  /** 0..1, or null when the weekday did not occur in the window. */
  rate: number | null;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Completions by weekday of week.
 *
 * The denominator is how many times the weekday *occurred* in the window, not the
 * number of days in the window. Over thirty days a Monday happens four or five
 * times, so dividing Monday's count by seven would report it as 70% of a Tuesday
 * that happened five times — and the whole point of this chart is that the
 * differences between weekdays are small enough to be exactly this wrong.
 *
 * A weekday that did not occur returns `rate: null` rather than 0, because "no
 * Mondays in the window" is not a rate of zero.
 */
export function weekdayRows(
  dates: Date[],
  countsByDate: Map<string, number>,
): WeekdayRow[] {
  const totals = new Array<number>(7).fill(0);
  const counts = new Array<number>(7).fill(0);

  for (const day of dates) {
    const index = day.getDay();
    totals[index] = (totals[index] ?? 0) + 1;
    const key = day.toISOString().slice(0, 10);
    counts[index] = (counts[index] ?? 0) + (countsByDate.get(key) ?? 0);
  }

  // Monday first: a week reads left to right starting where it starts.
  return [1, 2, 3, 4, 5, 6, 0].map((index) => ({
    index,
    label: WEEKDAY_LABELS[index]!,
    count: counts[index] ?? 0,
    expected: totals[index] ?? 0,
    rate: (totals[index] ?? 0) > 0 ? round((counts[index] ?? 0) / (totals[index] ?? 1), 4) : null,
  }));
}

export interface DonutSlice {
  name: string;
  color: string;
  value: number;
  /** Share of the total, 0..1, as a rounded percentage for display. */
  percent: number;
}

export interface MergeOptions {
  /** How many slices to keep. Everything past this folds into "Other". */
  max: number;
  /**
   * Fractions below this fold into "Other" even if there is room for them.
   *
   * A donut with twelve segments is not a chart, it is a ring of hairlines where
   * the two segments that matter are indistinguishable from the ten that do not.
   * Three percent is roughly the point where a slice stops being readable as an
   * area at all.
   */
  minShare: number;
}

/** Grey for the folded remainder, so "Other" never reads as a real category. */
const OTHER_COLOR = "rgb(138 146 159)";

/**
 * Reduce a category breakdown to something a donut can actually show.
 *
 * Folding by share before folding by count matters: a category with a large total
 * but many small rows would otherwise be dropped wholesale in favour of a
 * single mid-sized one.
 */
export function mergeSlices(
  entries: { name: string; color: string; value: number }[],
  { max, minShare }: MergeOptions,
): DonutSlice[] {
  const positive = entries.filter((e) => e.value > 0);
  const total = positive.reduce((n, e) => n + e.value, 0);
  if (total <= 0) return [];

  const ranked = [...positive].sort((a, b) => b.value - a.value);
  const kept = ranked.filter((e) => e.value / total >= minShare).slice(0, max);
  const folded = ranked.filter((e) => !kept.includes(e));

  const slices: DonutSlice[] = kept.map((e) => ({
    name: e.name,
    color: e.color,
    value: e.value,
    percent: Math.round((e.value / total) * 100),
  }));

  if (folded.length > 0) {
    const value = folded.reduce((n, e) => n + e.value, 0);
    const names = folded.map((e) => e.name);
    slices.push({
      name: names.length === 1 ? `Other: ${names[0]}` : `Other (${names.length})`,
      color: OTHER_COLOR,
      value,
      percent: Math.round((value / total) * 100),
    });
  }

  return slices;
}

/**
 * A single headline number per trend, for the chart's own caption.
 *
 * "is this going up" is the only question a trend chart really answers, and it is
 * the question a caption should answer, using the halves of the window rather than
 * a fitted line — because with thirty noisy daily points a regression line will
 * confidently report a trend that is not there.
 */
export function trendDirection(values: number[], window = 7): "up" | "down" | "flat" {
  if (values.length < window * 2) return "flat";
  const head = values.slice(0, window);
  const tail = values.slice(-window);
  const mean = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / xs.length;
  const from = mean(head);
  const to = mean(tail);

  // A 10% band, because a difference smaller than that is inside the run-to-run
  // noise of any habit worth charting.
  if (from === 0 && to === 0) return "flat";
  const change = from === 0 ? 1 : (to - from) / from;
  if (change > 0.1) return "up";
  if (change < -0.1) return "down";
  return "flat";
}
