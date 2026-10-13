import { CheckCircle2, Lightbulb, TrendingDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { RoutineSuggestionView } from "./routine-list";

/**
 * What a routine's own history says about it.
 *
 * Kept separate from the routine list because it is a different kind of thing: the
 * list is the user's data and this is the app's reading of it, and mixing the two
 * into one card makes it hard to tell which parts to argue with.
 *
 * Every row shows its own numbers. A suggestion the user can check is worth
 * correcting; one they have to take on faith is not worth showing, and after a
 * couple of wrong ones the good ones stop being read at all. The computing is in
 * `src/lib/routines/suggestions.ts`, which returns nothing at all until a routine
 * has enough history to support a claim — so an empty panel is the normal state
 * for a new routine and says so, rather than looking broken.
 */

const TONE = {
  warn: { icon: TrendingDown, accent: "text-negative", badge: "coral" as const },
  info: { icon: Lightbulb, accent: "text-ink-muted", badge: "outline" as const },
  praise: { icon: CheckCircle2, accent: "text-lime", badge: "lime" as const },
};

/** A percentage, for the rows that lead with one. Never rendered as a bare 0.83. */
function percent(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${Math.round(value)}%`;
}

function summary(suggestion: RoutineSuggestionView): string | null {
  const e = suggestion.evidence;
  switch (suggestion.id) {
    case "completion":
      return percent(e.finishRatePercent);
    case "consistency":
      return typeof e.distinctDays === "number" ? `${e.distinctDays}/30 days` : null;
    case "timing":
      return percent(Array.isArray(e.byHour) ? (e.byHour[0] as { finishRatePercent?: number })?.finishRatePercent : null);
    case "tail-step":
      return typeof e.stoppedAtStep === "number" ? `step ${e.stoppedAtStep}/${e.steps}` : null;
    case "pace": {
      const ratio = e.ratio;
      return typeof ratio === "number" ? `${ratio.toFixed(1)}×` : null;
    }
    default:
      return null;
  }
}

export function RoutineSuggestions({
  suggestions,
  runCount,
}: {
  suggestions: RoutineSuggestionView[];
  runCount: number;
}) {
  if (suggestions.length === 0) {
    return (
      <div className="flex flex-col gap-1 border-t border-line pt-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
          Based on its history
        </p>
        <p className="text-[12px] text-ink-subtle">
          {runCount === 0
            ? "Run this a few times and this will start telling you what your history says about it."
            : `Only ${runCount} ${runCount === 1 ? "run" : "runs"} so far — not enough yet to say anything worth saying.`}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
        Based on its history
      </p>
      {suggestions.map((suggestion) => {
        const tone = TONE[suggestion.tone];
        const Icon = tone.icon;
        const figure = summary(suggestion);

        return (
          <div key={suggestion.id} className="flex gap-2.5">
            <Icon className={cn("mt-0.5 size-3.5 shrink-0", tone.accent)} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-ink">{suggestion.title}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-ink-subtle">
                {suggestion.body}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {figure ? <Badge variant={tone.badge} size="sm">{figure}</Badge> : null}
                <span className="text-[10px] text-ink-subtle">
                  {Math.round(suggestion.confidence * 100)}% confidence
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
