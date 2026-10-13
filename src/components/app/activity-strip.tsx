import { cn } from "@/lib/utils";

/**
 * A trailing daily-activity strip.
 *
 * Deliberately not a chart library. Fourteen bars of one number each is a shape
 * a dozen divs render exactly, and it keeps the bars honest: the height is the
 * value's share of `max`, drawn from the same `0`-to-`max` scale every day, so
 * two Tuesdays are visually comparable. A chart component would add a dependency
 * and a layer of styling for a shape this simple.
 *
 * `max` is passed in rather than derived from the data. Auto-scaling to the
 * busiest day is the classic way to make a flat fortnight look like a mountain
 * range — the y-axis silently rescales every time a new record lands, so the
 * series appears to change even when nothing did. The caller passes a round
 * number (a target, a round duration) and empty days read as empty.
 */

export interface ActivityPoint {
  /** `yyyy-MM-dd` in the user's local calendar. */
  date: string;
  label: string;
  value: number;
}

export function ActivityStrip({
  points,
  max,
  unit,
  className,
}: {
  points: ActivityPoint[];
  max: number;
  unit?: string;
  className?: string;
}) {
  const ceiling = max > 0 ? max : 1;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        className="flex h-20 items-end gap-1"
        role="img"
        aria-label={`Daily totals for the last ${points.length} days${
          unit ? `, in ${unit}` : ""
        }`}
      >
        {points.map((point) => {
          const ratio = Math.min(1, Math.max(0, point.value / ceiling));
          const empty = point.value <= 0;

          return (
            <div key={point.date} className="group flex flex-1 flex-col items-center gap-1.5">
              <div className="flex h-full w-full items-end">
                <div
                  style={{
                    height: `${Math.max(empty ? 0 : 6, ratio * 100)}%`,
                    ...(empty
                      ? {}
                      : point.date === today
                        ? {
                            backgroundImage:
                              "linear-gradient(to top, color-mix(in oklab, var(--lime) 60%, transparent), var(--lime))",
                            boxShadow: "0 0 16px -4px var(--lime)",
                          }
                        : {
                            backgroundImage:
                              "linear-gradient(to top, color-mix(in oklab, var(--ink) 12%, transparent), color-mix(in oklab, var(--ink) 40%, transparent))",
                          }),
                  }}
                  className={cn(
                    "w-full rounded-[3px] transition-[height] duration-300 ease-out-expo",
                    empty && "bg-surface-3",
                  )}
                />
              </div>
              <span
                className={cn(
                  "text-[10px] tabular-nums",
                  point.date === today ? "text-lime" : "text-ink-subtle",
                )}
              >
                {point.label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-[11px] text-ink-subtle">
        <span>0</span>
        <span>
          bar height is share of {ceiling % 1 === 0 ? ceiling : ceiling.toFixed(1)}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
    </div>
  );
}
