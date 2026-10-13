"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import {
  mergeSlices,
  movingAverage,
  movingAverageWindowLabel,
  trendDirection,
  weekdayRows,
  type ChartPoint,
  type DonutSlice,
} from "@/lib/analytics/charts";

/**
 * The analytics charts.
 *
 * Recharts draws SVG and measures itself against a parent, which is a problem on
 * a server-rendered page: there is no width to measure, so `ResponsiveContainer`
 * renders an empty box on the server and fills it in after hydration. Rendering
 * that empty box for real produces a chart that pops in and shifts the page under
 * the user's finger, and rendering it on the server produces a hydration
 * mismatch. So nothing is drawn until the component knows it is in a browser, and
 * a placeholder of the exact final height stands in. The layout never moves.
 *
 * Colours are passed as `var(--token)` rather than resolved hex, which is what
 * makes the charts follow the theme instead of being drawn once for light mode.
 * Recharts hands them to SVG `fill` and `stroke` attributes, and browsers resolve
 * custom properties in presentation attributes, so dark mode costs no runtime
 * work and no flash of the wrong colour.
 *
 * The charts are not the source of truth. Every one of them has a plain-language
 * caption carrying the number that matters, because a chart a user cannot read
 * exactly is worse than the sentence that would have told them.
 */

const AXIS = "var(--ink-subtle)";
const GRID = "var(--line)";
const CHART_HEIGHT = 180;

/** Longest gap between labelled x-axis ticks. Keeps 30 days from becoming 30 labels. */
const TICK_INTERVAL = 4;

/** The moving average window. Seven days, because a week is the unit people think in. */
const TREND_WINDOW = 7;

/**
 * True only after hydration.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: an effect that
 * calls `setState` on mount triggers a second render pass, and this component
 * exists specifically to keep the first one cheap. Same pattern as
 * `user-menu.tsx`, and for the same reason.
 */
function useHydrated(): boolean {
  return React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/** Captions are written in lower case and start a sentence, so only the first letter lifts. */
function sentenceCase(text: string): string {
  return text.length === 0 ? text : `${text[0]!.toUpperCase()}${text.slice(1)}`;
}

function ChartFrame({ children, height = CHART_HEIGHT }: { children: React.ReactNode; height?: number }) {
  const mounted = useHydrated();

  if (!mounted) {
    return (
      <div
        style={{ height }}
        className="animate-pulse rounded-control bg-surface-2"
        aria-hidden
      />
    );
  }

  return (
    <div style={{ height }} className="w-full">
      {children}
    </div>
  );
}

interface TooltipPayload {
  name?: string | number;
  value?: string | number;
  color?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string | number;
  unit: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-control border border-line bg-[var(--surface)] px-2.5 py-1.5 text-[12px] shadow-card">
      <p className="font-medium text-ink">{label}</p>
      {payload.map((entry) => (
        <p key={String(entry.name)} className="text-ink-muted">
          <span className="tabular-nums text-ink">{entry.value}</span> {unit}
          {entry.name && entry.name !== "value" ? ` ${String(entry.name).toLowerCase()}` : ""}
        </p>
      ))}
    </div>
  );
}

/**
 * One daily series: the raw values as an area, and a trailing average over them.
 *
 * Both are drawn because they answer different questions and the gap between them
 * is the interesting part. The area is what actually happened on each day; the
 * line is where the habit is heading. A rising line over flat bars is someone
 * working at the same level on a better average, and a flat line over spiky bars
 * is a person whose routine is fine on the days they do it and absent on the days
 * they don't — two different problems with the same headline number.
 */
export function TrendChart({
  points,
  unit,
  tone = "lime",
}: {
  points: ChartPoint[];
  unit: string;
  tone?: "lime" | "iris" | "aqua";
}) {
  const colour = `var(--${tone})`;

  const series = React.useMemo(
    () =>
      points.map((point, i) => ({
        date: point.label,
        value: point.value,
        average: movingAverage(
          points.map((p) => p.value),
          TREND_WINDOW,
        )[i],
      })),
    [points],
  );

  const direction = trendDirection(points.map((p) => p.value));
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;
  const directionText =
    direction === "up" ? "trending up" : direction === "down" ? "trending down" : "holding steady";
  const windowLabel = movingAverageWindowLabel(TREND_WINDOW, points.length);

  return (
    <div className="flex flex-col gap-2">
      <ChartFrame>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id={`fill-${tone}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colour} stopOpacity={0.32} />
                <stop offset="100%" stopColor={colour} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: AXIS, fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              interval={TICK_INTERVAL}
              minTickGap={8}
            />
            <YAxis
              tick={{ fill: AXIS, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={44}
              allowDecimals={false}
            />
            <Tooltip
              content={<ChartTooltip unit={unit} />}
              cursor={{ stroke: GRID, strokeWidth: 1 }}
            />
            <Area
              type="monotone"
              dataKey="value"
              name="day"
              stroke={colour}
              strokeWidth={1.5}
              fill={`url(#fill-${tone})`}
              dot={false}
              activeDot={{ r: 3, fill: colour, stroke: "var(--surface)", strokeWidth: 2 }}
            />
            <Line
              type="monotone"
              dataKey="average"
              name="average"
              stroke={colour}
              strokeWidth={2}
              strokeDasharray="4 3"
              dot={false}
              activeDot={{ r: 3, fill: colour, stroke: "var(--surface)", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartFrame>

      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-ink-subtle">
        <Icon className="size-3" />
        <span className="text-ink-muted">{sentenceCase(directionText)}</span>
        <span>
          — {windowLabel} across the last {points.length} days.
        </span>
      </p>
    </div>
  );
}

/**
 * Where the work went, as a ring.
 *
 * A donut rather than bars because the question is one of proportion — "what
 * fraction of my time is this" — and a ring is the shape the eye already reads as
 * a part-of-a-whole. The bars stay in the list below it with exact counts,
 * because a ring's precision is limited by the angle of its smallest slice and a
 * user who wants the number should not have to estimate it.
 */
export function CategoryDonut({
  entries,
}: {
  entries: { name: string; color: string; value: number }[];
}) {
  const slices = React.useMemo(
    () => mergeSlices(entries, { max: 6, minShare: 0.03 }),
    [entries],
  );
  const total = slices.reduce((n, s) => n + s.value, 0);

  if (slices.length === 0) return null;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <ChartFrame height={168}>
        <div className="h-full w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="name"
                innerRadius="58%"
                outerRadius="92%"
                paddingAngle={2}
                stroke="var(--surface)"
                strokeWidth={2}
                isAnimationActive={false}
              >
                {slices.map((slice: DonutSlice) => (
                  <Cell key={slice.name} fill={slice.color} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const slice = payload[0]!.payload as DonutSlice;
                  return (
                    <div className="rounded-control border border-line bg-[var(--surface)] px-2.5 py-1.5 text-[12px] shadow-card">
                      <p className="font-medium text-ink">{slice.name}</p>
                      <p className="text-ink-muted">
                        <span className="tabular-nums text-ink">{slice.value}</span> of{" "}
                        <span className="tabular-nums text-ink">{total}</span> tasks · {slice.percent}%
                      </p>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </ChartFrame>

      <ul className="flex w-full flex-col gap-1">
        {slices.map((slice) => (
          <li key={slice.name} className="flex items-center gap-2 text-[12px]">
            <span
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ backgroundColor: slice.color }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-ink-muted">{slice.name}</span>
            <span className="shrink-0 tabular-nums text-ink-subtle">
              {slice.value} · {slice.percent}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Completions by weekday.
 *
 * Monday-first and evenly spaced regardless of how many times each weekday fell
 * in the window, because the comparison a reader makes is "Mondays against
 * Saturdays", and that comparison is wrong if a five-Monday month is drawn five
 * times as wide as a four-Saturday one. The bar is therefore *rate per occurrence*
 * and the caption carries the occurrence counts, so a day that looks tall
 * because it happened more often is not mistaken for a day that was done more.
 */
export function WeekdayChart({ rows }: { rows: ReturnType<typeof weekdayRows> }) {
  const chartable = rows.filter((row) => row.expected > 0);
  if (chartable.length === 0) return null;

  const best = chartable.reduce((a, b) => ((b.rate ?? 0) > (a.rate ?? 0) ? b : a));
  const worst = chartable.reduce((a, b) => ((b.rate ?? 0) < (a.rate ?? 0) ? b : a));

  // Per-occurrence average across the whole window, which is the only baseline
  // comparable across weekdays with different occurrence counts.
  const overallAverage =
    chartable.reduce((n, row) => n + row.count, 0) /
    Math.max(1, chartable.reduce((n, row) => n + row.expected, 0));

  return (
    <div className="flex flex-col gap-2">
      <ChartFrame height={140}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartable} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: AXIS, fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: GRID }}
            />
            <YAxis
              tick={{ fill: AXIS, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={44}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]!.payload as (typeof chartable)[number];
                return (
                  <div className="rounded-control border border-line bg-[var(--surface)] px-2.5 py-1.5 text-[12px] shadow-card">
                    <p className="font-medium text-ink">{row.label}</p>
                    <p className="text-ink-muted">
                      <span className="tabular-nums text-ink">{row.count}</span> over{" "}
                      <span className="tabular-nums text-ink">{row.expected}</span>{" "}
                      {row.expected === 1 ? "day" : "days"}
                    </p>
                  </div>
                );
              }}
            />
            {/* A bar chart with no baseline is a row of numbers. The line is the
                per-occurrence average across every day of the window, so a bar is
                read as "above or below my usual Tuesday" rather than "big or
                small". */}
            <ReferenceLine
              y={overallAverage}
              stroke={AXIS}
              strokeDasharray="4 3"
              strokeWidth={1}
            />
            <Bar dataKey="count" fill="var(--lime)" radius={[4, 4, 0, 0]} maxBarSize={40} />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

      <p className="text-[11px] text-ink-subtle">
        {best.label} is your strongest day at{" "}
        <span className="text-ink-muted">
          {Math.round((best.rate ?? 0) * 100)}%
        </span>
        , {worst.label} the weakest at{" "}
        <span className="text-ink-muted">
          {Math.round((worst.rate ?? 0) * 100)}%
        </span>
        . Bars count completions; a day that occurred more often in the window is
        expected to be taller, which is why the tooltip gives the count it was
        measured against.
      </p>
    </div>
  );
}
