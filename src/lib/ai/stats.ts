/**
 * Statistics for the heuristic engine.
 *
 * Small, pure, and free of any framework. These exist because "how strong is
 * this correlation" has to be answered the same way in every insight, and
 * answering it ad hoc in each one is how a product ends up claiming a trend from
 * four data points in one card and refusing to claim the same trend in another.
 *
 * Two conventions throughout, both deliberate:
 *
 *   - `correlation` returns 0 for anything with too few *paired* observations,
 *     not a number computed from a degenerate sample. A correlation over two
 *     points is always exactly ±1 and always meaningless, so the honest answer
 *     is "there is nothing here", and the caller treats 0 as no signal.
 *   - `confidence` is a bounded, explainable function of sample size and effect
 *     size rather than a model score. A user reading an insight can be told, in
 *     words, why it is at 0.4 and asked to correct it. See `confidenceFrom`.
 */

/** Standard deviation below which two series are treated as flat. */
export const FLAT_EPSILON = 1e-9;

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

export function sum(values: number[]): number {
  return values.reduce((total, v) => total + v, 0);
}

/** Population standard deviation. 0 for an empty or single-element sample. */
export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((total, v) => total + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** Integer percentage, 0 when there is no denominator. Never NaN, never Infinity. */
export function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

/** Round to `places` decimals — for output, so a 0.30000000000000004 never renders. */
export function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Pearson's r over paired observations.
 *
 * Returns 0 for fewer than three pairs, or when either series is constant. Both
 * are cases where the formula produces a number with no meaning: r is undefined
 * for n < 3 in practice, and a zero-variance series makes the denominator zero.
 * Returning 0 keeps every caller's "is there a correlation" test a simple
 * truthiness check, and the caller can separately ask whether it had enough data.
 */
export function correlation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;

  const x = xs.slice(0, n);
  const y = ys.slice(0, n);

  const mx = mean(x);
  const my = mean(y);

  let numerator = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = (x[i] ?? 0) - mx;
    const dy = (y[i] ?? 0) - my;
    numerator += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }

  if (dx2 < FLAT_EPSILON || dy2 < FLAT_EPSILON) return 0;
  return clamp(numerator / Math.sqrt(dx2 * dy2), -1, 1);
}

/**
 * How much to believe a finding, from how much data it rests on and how big the
 * effect is.
 *
 * Two multiplicative terms, both in [0, 1]:
 *
 *   - sample: `n / (n + MIN)`, which is 0.5 at `n = MIN` and saturates slowly
 *     enough that doubling a small sample is always visible. Saturating quickly
 *     is the usual mistake — a chart that jumps to "certain" at ten points
 *     teaches people to trust all of it, including the twenty-point ones.
 *   - effect: the effect size expressed as a fraction of its plausible maximum.
 *
 * The product is the result. It is not a probability and is never presented as
 * one; the UI shows it as a strength bar and the text always states the sample
 * size next to it, which is the number that actually tells the reader whether to
 * care.
 */
export function confidenceFrom(sampleSize: number, effectSize: number, minSample = 12): number {
  if (sampleSize <= 0 || effectSize <= 0) return 0;
  const sampleTerm = sampleSize / (sampleSize + minSample);
  return round(clamp01(sampleTerm * clamp01(effectSize)), 2);
}

/**
 * Group a series by a key function, preserving insertion order within a group.
 *
 * Used constantly for "per weekday" and "per habit" bucketing, and written once
 * so the ordering behaviour is the same everywhere — a habit list that re-sorts
 * itself between two insights on the same screen reads as a bug.
 */
export function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = groups.get(k);
    if (bucket) bucket.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

/**
 * Day of week for a `@db.Date` value, 0 = Sunday.
 *
 * `getUTCDay`, not `getDay`. These values are UTC midnight by construction, and
 * using the local accessor would label Monday's logs as Sunday for anyone west of
 * Greenwich — the same class of bug the date module exists to prevent.
 */
export function utcWeekday(date: Date): number {
  return date.getUTCDay();
}

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function weekdayName(day: number): string {
  return WEEKDAY_NAMES[((day % 7) + 7) % 7] ?? "Unknown";
}

/** Minutes from midnight -> "9:05am". Used in insight copy, so it is chatty. */
export function formatMinutes(minutes: number): string {
  const normalised = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(normalised / 60);
  const m = normalised % 60;
  const suffix = h < 12 ? "am" : "pm";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")}${suffix}`;
}

/** Minutes -> "1h 30m" / "45m" / "2h". */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * A simple centred moving average, used to show trend without inventing a
 * seasonal model. Returns an array aligned to the input, with the first and last
 * `radius` entries copied from the nearest computed point so the chart never has
 * a gap at the edges.
 */
export function movingAverage(values: number[], radius = 3): number[] {
  if (values.length === 0) return [];
  if (values.length <= radius * 2 + 1) return values.map(() => mean(values));

  const out: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const from = Math.max(0, i - radius);
    const to = Math.min(values.length, i + radius + 1);
    out.push(mean(values.slice(from, to)));
  }
  return out;
}

/**
 * Least-squares slope of a series against its index, in units per step.
 *
 * Used to say "trending down" rather than "lower than last week", because the
 * difference between two points is noise at this sample size and the slope uses
 * all of them.
 */
export function slope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = mean(values);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    numerator += (i - mx) * ((values[i] ?? 0) - my);
    denominator += (i - mx) ** 2;
  }
  if (denominator < FLAT_EPSILON) return 0;
  return numerator / denominator;
}

/** Human phrase for a slope, given the unit the series is measured in. */
export function describeSlope(perStep: number, unit: string, minEffect = 0.05): string | null {
  if (Math.abs(perStep) < minEffect) return null;
  const direction = perStep > 0 ? "up" : "down";
  return `${formatDuration(Math.abs(perStep))} ${direction} per day (${unit})`;
}
