"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, RefreshCw } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/primitives";
import { api, ApiClientError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

/**
 * Reviews and reports.
 *
 * These are read-only renderings of rows written by
 * `POST /api/v1/reviews/generate`. The screen's job is to be clear about that:
 *
 * **Nothing is generated on view.** Opening Analytics does not spend a rate-limit
 * token or rewrite a review. Generation is a button, because a report that
 * silently rewrote itself under the reader would make "what did I write last
 * week" unanswerable.
 *
 * **Regenerating updates in place.** The API upserts on `(userId, weekStart)`, so
 * the button is labelled "Regenerate" and the report keeps its identity — a
 * second copy of the same week would be a bug, not a history.
 *
 * **Every figure traces to the metrics table.** The number in a highlight is
 * rendered from `metrics`, so if the narrative and the arithmetic ever disagree
 * the arithmetic is visible on the same screen.
 */

export interface ReportSectionRow {
  kind: "PATTERN" | "CORRELATION" | "OBSERVATION" | "RECOMMENDATION";
  title: string;
  body: string;
  confidence: number;
  sampleSize: number;
}

export interface WeeklyReviewRow {
  id: string;
  periodLabel: string;
  range: string;
  summary: string;
  metrics: Record<string, number>;
  highlights: ReportSectionRow[];
  misses: ReportSectionRow[];
  patterns: ReportSectionRow[];
  recommendations: ReportSectionRow[];
  provider: string | null;
  generatedAt: string;
}

export interface MonthlyReportRow {
  id: string;
  monthLabel: string;
  range: string;
  summary: string;
  metrics: Record<string, number>;
  achievements: ReportSectionRow[];
  habitStats: { name: string; ratePercent: number; completed: number; expected: number }[];
  goalStats: { title: string; progressPercent: number; status: string; milestones: string }[];
  focusStats: { day: string; minutes: number; sessions: number }[];
  timeStats: {
    totalMinutes: number;
    byCategory: { name: string; minutes: number; sharePercent: number }[];
  } | null;
  lifeBalance: { score?: number; byCategory?: { name: string; share: number }[] } | null;
  missed: ReportSectionRow[];
  recommendations: ReportSectionRow[];
  provider: string | null;
  generatedAt: string;
}

const KIND_VARIANT: Record<ReportSectionRow["kind"], "lime" | "iris" | "aqua" | "amber"> = {
  PATTERN: "aqua",
  CORRELATION: "iris",
  OBSERVATION: "lime",
  RECOMMENDATION: "amber",
};

export function ReportPanel({
  weekly,
  monthly,
  aiEnabled,
}: {
  weekly: WeeklyReviewRow[];
  monthly: MonthlyReportRow[];
  aiEnabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<"WEEK" | "MONTH" | "BOTH" | null>(null);
  const [tab, setTab] = React.useState<"WEEK" | "MONTH">(
    weekly.length > 0 || monthly.length === 0 ? "WEEK" : "MONTH",
  );
  const [selectedWeek, setSelectedWeek] = React.useState<string | null>(weekly[0]?.id ?? null);
  const [selectedMonth, setSelectedMonth] = React.useState<string | null>(monthly[0]?.id ?? null);

  async function generate(period: "WEEK" | "MONTH" | "BOTH") {
    setBusy(period);
    try {
      const result = await api.post<{
        period: string;
        sparse: boolean;
        weekly: { id: string } | null;
        monthly: { id: string } | null;
      }>("/api/v1/reviews/generate", { period });

      if (result.sparse) {
        toast.info("Not much logged in the last 45 days, so this will be thin.");
      } else {
        toast.success(
          period === "BOTH" ? "Weekly review and monthly report rebuilt." : "Rebuilt.",
        );
      }
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not build the report.",
      );
    } finally {
      setBusy(null);
    }
  }

  const week = weekly.find((w) => w.id === selectedWeek) ?? weekly[0] ?? null;
  const month = monthly.find((m) => m.id === selectedMonth) ?? monthly[0] ?? null;
  const nothing = weekly.length === 0 && monthly.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-[-0.01em]">Reviews and reports</h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            Built from your own data by a deterministic local pass, on this device.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!aiEnabled || busy !== null}
            onClick={() => void generate("WEEK")}
            loading={busy === "WEEK"}
            loadingText="Building"
          >
            <FileText /> {week ? "Rebuild week" : "Build week"}
          </Button>
          <Button
            size="sm"
            variant="lime"
            disabled={!aiEnabled || busy !== null}
            onClick={() => void generate("BOTH")}
            loading={busy === "BOTH"}
            loadingText="Building"
          >
            <RefreshCw /> Build both
          </Button>
        </div>
      </header>

      {!aiEnabled ? (
        <p className="rounded-control border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink-muted">
          Insights are switched off in settings, so review generation is unavailable.
          The stored reports below are still shown.
        </p>
      ) : null}

      {nothing ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={FileText}
              title="No review yet"
              description="A review covers the current week and a report covers the month so far, both summarised from tasks, habits, focus and goals. Nothing is written until you ask for it."
              action={aiEnabled ? { label: "Build both", onClick: () => void generate("BOTH") } : undefined}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-1.5">
            <Tab active={tab === "WEEK"} onClick={() => setTab("WEEK")} count={weekly.length}>
              Weekly
            </Tab>
            <Tab active={tab === "MONTH"} onClick={() => setTab("MONTH")} count={monthly.length}>
              Monthly
            </Tab>
          </div>

          {tab === "WEEK" ? (
            week ? (
              <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
                <ReportPicker
                  items={weekly.map((w) => ({
                    id: w.id,
                    label: w.periodLabel,
                    sub: w.range,
                  }))}
                  selected={week.id}
                  onSelect={setSelectedWeek}
                />
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle>{week.periodLabel}</CardTitle>
                      <Badge variant="outline" size="sm">
                        {week.provider === "local" ? "local · deterministic" : (week.provider ?? "local")}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <p className="text-sm leading-relaxed text-ink">{week.summary}</p>
                    <MetricGrid metrics={week.metrics} />
                    <Sections title="Highlights" sections={week.highlights} tone="lime" />
                    <Sections title="Patterns" sections={week.patterns} />
                    <Sections title="Missed" sections={week.misses} />
                    <Sections title="What to try" sections={week.recommendations} />
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Card>
                <CardContent>
                  <EmptyState
                    size="sm"
                    icon={FileText}
                    title="No weekly review"
                    description="Build one to summarise the current week."
                    action={aiEnabled ? { label: "Build week", onClick: () => void generate("WEEK") } : undefined}
                  />
                </CardContent>
              </Card>
            )
          ) : month ? (
            <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
              <ReportPicker
                items={monthly.map((m) => ({
                  id: m.id,
                  label: m.monthLabel,
                  sub: m.range,
                }))}
                selected={month.id}
                onSelect={setSelectedMonth}
              />
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle>{month.monthLabel}</CardTitle>
                    <Badge variant="outline" size="sm">
                      {month.provider === "local" ? "local · deterministic" : (month.provider ?? "local")}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <p className="text-sm leading-relaxed text-ink">{month.summary}</p>
                  <MetricGrid metrics={month.metrics} />

                  {month.lifeBalance?.score != null ? (
                    <div className="flex flex-col gap-2 rounded-control border border-line bg-surface-2 p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[13px] font-medium text-ink-muted">
                          Life Balance
                        </span>
                        <span className="text-sm font-semibold tabular-nums text-ink">
                          {Math.round(month.lifeBalance.score)}
                        </span>
                      </div>
                      <Progress value={Math.round(month.lifeBalance.score)} />
                      {month.lifeBalance.byCategory?.length ? (
                        <ul className="mt-1 flex flex-col gap-1">
                          {month.lifeBalance.byCategory.map((c) => (
                            <li
                              key={c.name}
                              className="flex items-center justify-between text-[11px] text-ink-subtle"
                            >
                              <span>{c.name}</span>
                              <span className="tabular-nums">
                                {Math.round(c.share * 100)}%
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}

                  {month.habitStats.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <p className="text-[13px] font-medium text-ink-muted">Habits</p>
                      {month.habitStats.map((h) => (
                        <div key={h.name} className="flex items-center gap-3">
                          <span className="w-40 shrink-0 truncate text-[12px] text-ink">
                            {h.name}
                          </span>
                          <Progress value={h.ratePercent} className="flex-1" />
                          <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-ink-subtle">
                            {Math.round(h.ratePercent)}% · {h.completed}/{h.expected}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {month.goalStats.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <p className="text-[13px] font-medium text-ink-muted">Goals</p>
                      {month.goalStats.map((g) => (
                        <div key={g.title} className="flex items-center gap-3">
                          <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                            {g.title}
                          </span>
                          <span className="shrink-0 text-[11px] text-ink-subtle">
                            {g.milestones}
                          </span>
                          <span className="w-10 shrink-0 text-right text-[12px] tabular-nums text-ink">
                            {Math.round(g.progressPercent)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {month.timeStats && month.timeStats.totalMinutes > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      <p className="text-[13px] font-medium text-ink-muted">
                        Time by category ({month.timeStats.totalMinutes} min)
                      </p>
                      {month.timeStats.byCategory.map((c) => (
                        <div key={c.name} className="flex items-center gap-3">
                          <span className="w-40 shrink-0 truncate text-[12px] text-ink-muted">
                            {c.name}
                          </span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                            <div
                              style={{ width: `${Math.max(2, c.sharePercent)}%` }}
                              className="h-full rounded-full bg-lime"
                            />
                          </div>
                          <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-ink-subtle">
                            {c.minutes} min · {Math.round(c.sharePercent)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <Sections title="Achievements" sections={month.achievements} tone="lime" />
                  <Sections title="Missed" sections={month.missed} />
                  <Sections title="What to try" sections={month.recommendations} />
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent>
                <EmptyState
                  size="sm"
                  icon={FileText}
                  title="No monthly report"
                  description="Build one to summarise the month so far."
                  action={aiEnabled ? { label: "Build both", onClick: () => void generate("BOTH") } : undefined}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Tab({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-control px-3 py-1.5 text-[12px] font-medium transition-colors",
        active ? "bg-ink text-ink-inverse" : "text-ink-muted hover:bg-surface-2",
      )}
    >
      {children}
      <span className={cn("ml-1.5 tabular-nums", active ? "opacity-70" : "text-ink-subtle")}>
        {count}
      </span>
    </button>
  );
}

function ReportPicker({
  items,
  selected,
  onSelect,
}: {
  items: { id: string; label: string; sub: string }[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-row gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.id)}
          className={cn(
            "min-w-40 shrink-0 rounded-control border px-3 py-2 text-left transition-colors lg:w-full lg:shrink",
            item.id === selected
              ? "border-lime bg-lime-soft"
              : "border-line hover:border-line-strong",
          )}
        >
          <span className="block truncate text-[13px] font-medium text-ink">{item.label}</span>
          <span className="block text-[11px] text-ink-subtle">{item.sub}</span>
        </button>
      ))}
    </div>
  );
}

const METRIC_LABELS: Record<string, string> = {
  tasksCompleted: "Tasks done",
  tasksCreated: "Tasks created",
  tasksStillOpen: "Still open",
  tasksOverdue: "Overdue",
  habitLogs: "Habit ticks",
  habitExpected: "Habits expected",
  habitRatePercent: "Habit rate",
  focusSessions: "Focus sessions",
  focusMinutes: "Focus minutes",
  focusMinutesPerDay: "Focus min/day",
  daysElapsed: "Days elapsed",
  goalsTouched: "Goals touched",
  journalEntries: "Journal entries",
  wellbeingCheckIns: "Wellbeing check-ins",
  previous: "Previous",
  changePercent: "Change",
  changeAbsolute: "Change",
  changeDirection: "Direction",
  direction: "Direction",
};

function MetricGrid({ metrics }: { metrics: Record<string, number> }) {
  const entries = Object.entries(metrics).filter(([, v]) => typeof v === "number");
  if (entries.length === 0) return null;

  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="rounded-control border border-line bg-surface-2 px-2.5 py-2"
        >
          <dt className="text-[11px] text-ink-subtle">
            {METRIC_LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2")}
          </dt>
          <dd className="text-[15px] font-semibold tabular-nums text-ink">
            {typeof value === "number" ? Math.round(value * 10) / 10 : value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Sections({
  title,
  sections,
  tone,
}: {
  title: string;
  sections: ReportSectionRow[];
  tone?: "lime";
}) {
  if (!sections || sections.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] font-medium text-ink-muted">{title}</p>
      <ul className="flex flex-col gap-2">
        {sections.map((section, index) => (
          <li
            key={`${section.title}-${index}`}
            className="rounded-control border border-line bg-surface-2 p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={KIND_VARIANT[section.kind] ?? "neutral"} size="sm">
                {section.kind.toLowerCase()}
              </Badge>
              <span className="text-[13px] font-medium text-ink">{section.title}</span>
              {tone ? null : (
                <span className="ml-auto text-[11px] tabular-nums text-ink-subtle">
                  {Math.round(section.confidence * 100)}% · n={section.sampleSize}
                </span>
              )}
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{section.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
