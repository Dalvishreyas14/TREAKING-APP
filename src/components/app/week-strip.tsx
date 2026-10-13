import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricDisclosure } from "@/components/feedback/empty-state";
import { cn } from "@/lib/utils";
import {
  formatDayMonth,
  formatIndianLong,
  formatWeekdayShort,
} from "@/lib/format/date";

/**
 * The week strip.
 *
 * Seven days, Sunday first, each showing how much of the day was actually
 * completed. The point is not decoration: a single "Habits today 75%" number
 * cannot tell you whether today is a good day or the fourth bad one in a row,
 * and that difference is the entire reason to open a tracker. Seven cells is
 * enough to see a trend and few enough to read without a chart.
 *
 * Deliberately **not** interactive. Making these cells look tappable while they
 * do nothing is the same dishonest affordance as the quick-capture placeholder
 * that used to sit in the shell: it promises a date you can inspect and then
 * ignores you. When the dashboard can filter by day, this becomes a control;
 * until then it is a readout.
 *
 * The component renders the days it is given, in the order given, and does not
 * recompute the week itself. It is the server that decides the window, because
 * the server also decided which days it queried — a second `indianWeek()` call
 * here previously re-anchored on the first day of the data and shifted the
 * whole strip by up to six days.
 *
 * Day boundaries are UTC midnights, matching how every `@db.Date` column in the
 * schema is written and queried. Formatting is Indian, but the *grouping* has to
 * agree with the seed and the API or a cell can be labelled 27 while showing
 * the 26th's logs. `src/lib/date.ts` explains why that distinction matters.
 */

export interface WeekDay {
  /** UTC midnight, as stored. */
  date: Date;
  /** 0-100, or null when the day has no habits to complete. */
  completion: number | null;
  done: number;
  total: number;
  /** True only for today. */
  isToday: boolean;
  /** True for days after today, which are dimmed and show no score. */
  isFuture: boolean;
}

export function WeekStrip({ days }: { days: WeekDay[] }) {
  const first = days[0];
  const last = days[days.length - 1];

  return (
    <Card>
      <CardHeader className="space-y-0 pb-3">
        <CardTitle className="text-[13px]">This week</CardTitle>
        <p className="text-[12px] text-ink-subtle">
          {first && last
            ? `${formatDayMonth(first.date)} – ${formatDayMonth(last.date)}`
            : ""}
        </p>
      </CardHeader>
      <CardContent className="px-3 sm:px-5">
        <ol className="grid grid-cols-7 gap-1 sm:gap-2">
          {days.map((day) => {
            const { date, completion, isToday, isFuture, done, total } = day;

            return (
              <li key={date.toISOString()}>
                <div
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-control border px-0.5 py-2.5",
                    isToday ? "border-lime bg-lime/8" : "border-line bg-surface",
                    isFuture && "opacity-45",
                  )}
                >
                  <span className="text-[10px] font-medium tracking-wide text-ink-subtle uppercase">
                    {formatWeekdayShort(date)}
                  </span>

                  <span
                    className={cn(
                      "text-[10px] font-semibold tracking-tight whitespace-nowrap tabular-nums sm:text-[12px]",
                      isToday ? "text-ink" : "text-ink-muted",
                    )}
                  >
                    {formatDayMonth(date)}
                  </span>

                  {/*
                    The fill is the data. A ring alone would be decoration; a
                    bar whose height tracks completion is a number you can read
                    at a glance, and it degrades to an empty track on a day with
                    no habits rather than implying a zero score.
                  */}
                  <div
                    className="h-8 w-full overflow-hidden rounded-full bg-surface-2"
                    role="img"
                    aria-label={
                      isFuture
                        ? `${formatIndianLong(date)}, still to come`
                        : completion === null
                          ? `${formatIndianLong(date)}, no habits tracked`
                          : `${formatIndianLong(date)}: ${done} of ${total} habits done, ${completion}%`
                    }
                  >
                    <div
                      className={cn(
                        "h-full w-full rounded-full transition-[height]",
                        isToday ? "bg-lime" : "bg-iris/70",
                      )}
                      style={{ height: `${completion ?? 0}%` }}
                    />
                  </div>

                  <span className="text-[10px] text-ink-subtle tabular-nums">
                    {isFuture ? "—" : completion === null ? "–" : `${completion}%`}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>

        <MetricDisclosure variant="insight" />
      </CardContent>
    </Card>
  );
}
