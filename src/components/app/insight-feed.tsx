"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BarChart3,
  Check,
  ChevronDown,
  Lightbulb,
  Sparkles,
  TrendingUp,
} from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/primitives";
import { ActionApplied, ActionPreview } from "@/components/app/action-preview";
import { api, ApiClientError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

/**
 * The insights feed.
 *
 * Three things this screen will not do, and each one is a decision:
 *
 * **An insight never writes on its own.** Where a finding implies a change, the
 * card offers a typed preview first — every field that would move, with its
 * current value and its next one — and the change happens only if the user taps
 * through that preview. An insight that silently restructured someone's week on
 * the strength of a correlation is a much worse product than one that shows the
 * reasoning and asks. Findings with no change behind them say so, and offer no
 * button at all, because a confirm dialog with an empty diff is a lie.
 *
 * **It shows the working.** `evidence` is expanded on demand, not hidden. The
 * claim "your focus is best between 9 and 11" is only as good as the eight
 * sessions behind it, and hiding them makes the difference between a calculation
 * and an assertion impossible to see.
 *
 * **Dismissing is remembered, not deleted.** The status survives the next
 * generate run on the server, so advice that was rejected stays rejected instead
 * of reappearing every morning.
 */

export interface InsightCard {
  id: string;
  kind: "CORRELATION" | "PATTERN" | "PREDICTION" | "RECOMMENDATION" | "OBSERVATION";
  status: "NEW" | "SEEN" | "APPLIED" | "DISMISSED";
  title: string;
  body: string;
  confidence: number;
  sampleSize: number;
  evidence: Record<string, unknown> | null;
  actionKind: string | null;
  createdAt: string;
  actedAt: string | null;
  expiresAt: string | null;
  habit: { id: string; name: string; color: string } | null;
}

const KIND_META: Record<
  InsightCard["kind"],
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    variant: "neutral" | "lime" | "iris" | "amber" | "aqua" | "coral" | "limeSolid";
  }
> = {
  CORRELATION: { label: "Correlation", icon: BarChart3, variant: "iris" },
  PATTERN: { label: "Pattern", icon: TrendingUp, variant: "aqua" },
  PREDICTION: { label: "Forecast", icon: Sparkles, variant: "amber" },
  RECOMMENDATION: { label: "Suggestion", icon: Lightbulb, variant: "lime" },
  OBSERVATION: { label: "Observation", icon: BarChart3, variant: "neutral" },
};

/**
 * Evidence values are rendered as key/value pairs rather than raw JSON.
 *
 * A raw object dump is technically the working and practically useless: `r` and
 * `n` are only meaningful next to their labels. Keys are humanised, and values
 * are formatted by type — a correlation coefficient to two decimals, a percentage
 * already carrying its unit.
 */
function formatEvidenceValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(2);
  }
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function humaniseKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

export function InsightFeed({ insights: initialInsights }: { insights: InsightCard[] }) {
  const router = useRouter();
  const [insights, setInsights] = React.useState(initialInsights);
  const [generating, setGenerating] = React.useState(false);
  const [showDismissed, setShowDismissed] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const [syncedFrom, setSyncedFrom] = React.useState(initialInsights);
  if (syncedFrom !== initialInsights) {
    setSyncedFrom(initialInsights);
    setInsights(initialInsights);
  }

  const visible = showDismissed
    ? insights
    : insights.filter((i) => i.status !== "DISMISSED");
  const dismissedCount = insights.filter((i) => i.status === "DISMISSED").length;

  async function generate() {
    setGenerating(true);
    try {
      const result = await api.post<{ created: number; updated: number; reason: string | null }>(
        "/api/v1/insights/generate",
      );
      if (result.reason === "NOT_ENOUGH_DATA") {
        toast.info("Not enough logged activity yet. Keep going and try again.");
      } else if (result.created + result.updated === 0) {
        toast.info("Nothing new to say from the data so far.");
      } else {
        toast.success(
          `${result.created} new, ${result.updated} refreshed.`,
        );
      }
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not run the analysis.",
      );
    } finally {
      setGenerating(false);
    }
  }

  async function setStatus(id: string, status: InsightCard["status"]) {
    setBusyId(id);
    try {
      await api.patch(`/api/v1/insights/${id}`, { status });
      setInsights((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not update that insight.",
      );
      // Re-sync from the server rather than guessing: the status is a record of
      // what the user actually did, and a failed write means it did not happen.
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="lime" size="sm" onClick={generate} loading={generating} loadingText="Analysing">
          <Sparkles /> Analyse my data
        </Button>

        {dismissedCount > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => setShowDismissed((v) => !v)}>
            {showDismissed ? "Hide" : "Show"} {dismissedCount} dismissed
          </Button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Sparkles}
              title={insights.length === 0 ? "No insights yet" : "Nothing left to show"}
              description={
                insights.length === 0
                  ? "Run the analysis and it will look for patterns in your habits, focus and wellbeing. It only reads your own data, and every claim comes with the numbers behind it."
                  : "Every insight here has been dismissed. Show dismissed to see them again."
              }
              action={
                insights.length === 0
                  ? { label: "Analyse my data", onClick: () => void generate() }
                  : { label: "Show dismissed", onClick: () => setShowDismissed(true) }
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((insight) => {
            const meta = KIND_META[insight.kind] ?? KIND_META.OBSERVATION;
            const Icon = meta.icon;
            const open = expanded === insight.id;
            const evidence = insight.evidence ?? {};
            const hasEvidence = Object.keys(evidence).length > 0;

            return (
              <Card key={insight.id} tone={insight.status === "NEW" ? "default" : "sunken"}>
                <CardContent className="flex flex-col gap-3 p-4">
                  <div className="flex items-start gap-3">
                    <span
                      className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-control border border-line bg-surface-2 text-ink-muted"
                      aria-hidden
                    >
                      <Icon className="size-4" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={meta.variant} size="sm">
                          {meta.label}
                        </Badge>
                        {insight.status === "NEW" ? (
                          <Badge variant="limeSolid" size="sm">
                            New
                          </Badge>
                        ) : null}
                        {insight.habit ? (
                          <span className="text-[11px] text-ink-subtle">
                            {insight.habit.name}
                          </span>
                        ) : null}
                      </div>

                      <p className="mt-1.5 text-sm font-semibold tracking-[-0.01em] text-ink">
                        {insight.title}
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                        {insight.body}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pl-11">
                    <div className="flex min-w-32 flex-1 items-center gap-2">
                      <span className="shrink-0 text-[11px] text-ink-subtle">Confidence</span>
                      <Progress
                        value={Math.round(insight.confidence * 100)}
                        className="max-w-24"
                      />
                      <span className="shrink-0 text-[11px] tabular-nums text-ink-subtle">
                        {Math.round(insight.confidence * 100)}%
                      </span>
                    </div>
                    <span className="text-[11px] text-ink-subtle">
                      {insight.sampleSize} data points
                    </span>

                    {hasEvidence ? (
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : insight.id)}
                        className="flex items-center gap-1 text-[11px] text-lime transition-opacity hover:opacity-80"
                      >
                        How this was worked out
                        <ChevronDown
                          className={cn("size-3 transition-transform", open && "rotate-180")}
                        />
                      </button>
                    ) : null}
                  </div>

                  {open && hasEvidence ? (
                    <dl className="grid gap-x-4 gap-y-1.5 rounded-control border border-line bg-surface-2 p-3 text-xs sm:grid-cols-2">
                      {Object.entries(evidence).map(([key, value]) => (
                        <div key={key} className="flex items-baseline justify-between gap-2">
                          <dt className="text-ink-subtle">{humaniseKey(key)}</dt>
                          <dd className="truncate font-medium tabular-nums text-ink">
                            {formatEvidenceValue(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}

                  {insight.status !== "DISMISSED" ? (
                    <div className="flex flex-wrap items-center gap-2 pl-11">
                      {insight.status === "APPLIED" ? (
                        <ActionApplied actedAt={insight.actedAt} />
                      ) : insight.actionKind ? (
                        <ActionPreview insightId={insight.id} />
                      ) : (
                        // No action behind this one: whatever it suggests, the
                        // user does it themselves, so "I did this" is the honest
                        // record and there is nothing to preview.
                        <Button
                          size="xs"
                          variant="secondary"
                          disabled={busyId === insight.id}
                          onClick={() => setStatus(insight.id, "APPLIED")}
                        >
                          <Check /> I did this
                        </Button>
                      )}
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={busyId === insight.id}
                        onClick={() =>
                          setStatus(insight.id, insight.status === "APPLIED" ? "SEEN" : "DISMISSED")
                        }
                      >
                        {insight.status === "APPLIED" ? "Undo" : "Dismiss"}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 pl-11">
                      <span className="text-[11px] text-ink-subtle">Dismissed</span>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={busyId === insight.id}
                        onClick={() => setStatus(insight.id, "NEW")}
                      >
                        Bring back
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-ink-subtle">
        Correlation is not evidence of causation. An insight describes what your
        logged data shows, not a medical or psychological conclusion, and it never
        changes anything on its own.
      </p>
    </div>
  );
}
