import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { InsightFeed, type InsightCard } from "@/components/app/insight-feed";

export const dynamic = "force-dynamic";

/**
 * Insights.
 *
 * The screen reads stored insights and never computes them on the fly. That
 * separation is the point: generating is an explicit action the user takes (see
 * `POST /api/v1/insights/generate`), it is rate-limited, it writes rows, and it
 * takes a snapshot of the data as it was when it ran. Rendering on every page
 * view would make the numbers change under the user as they read, and would
 * recompute correlations nobody asked for.
 *
 * `evidence` is returned and displayed. An insight that says "you focus better
 * after exercise" and shows the eleven sessions behind it is checkable; one that
 * shows only the claim is a horoscope. The sample size and the computed figure
 * are both surfaced for the same reason.
 *
 * Dismissed insights are loaded but filtered in the client rather than excluded
 * by the query, so the "show dismissed" toggle works without a round trip.
 */

const CARD_LIMIT = 60;

export default async function InsightsPage() {
  const user = await requireUser();

  const rows = await prisma.insight.findMany({
    where: { userId: user.id },
    orderBy: [{ status: "asc" }, { confidence: "desc" }, { createdAt: "desc" }],
    take: CARD_LIMIT,
    select: {
      id: true,
      kind: true,
      status: true,
      title: true,
      body: true,
      confidence: true,
      sampleSize: true,
      evidence: true,
      actionKind: true,
      validUntil: true,
      createdAt: true,
      actedAt: true,
      relatedHabitId: true,
    },
  });

  // `Insight.relatedHabitId` is a bare id with no Prisma relation behind it, so
  // the display name has to come from a second query. Only the ids actually
  // referenced are looked up — no habit list, no per-row query.
  const habitIds = [...new Set(rows.map((r) => r.relatedHabitId).filter((v): v is string => !!v))];
  const habits = habitIds.length
    ? await prisma.habit.findMany({
        where: { userId: user.id, id: { in: habitIds } },
        select: { id: true, name: true, color: true },
      })
    : [];
  const habitById = new Map(habits.map((h) => [h.id, h]));

  const cards: InsightCard[] = rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    body: row.body,
    confidence: row.confidence,
    sampleSize: row.sampleSize,
    evidence: (row.evidence ?? null) as Record<string, unknown> | null,
    actionKind: row.actionKind,
    createdAt: row.createdAt.toISOString(),
    actedAt: row.actedAt?.toISOString() ?? null,
    expiresAt: row.validUntil?.toISOString() ?? null,
    habit: row.relatedHabitId ? (habitById.get(row.relatedHabitId) ?? null) : null,
  }));

  const newCount = cards.filter((c) => c.status === "NEW").length;
  const dismissedCount = cards.filter((c) => c.status === "DISMISSED").length;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Insights</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          {cards.length === 0
            ? "Patterns from your own logged data."
            : newCount > 0
              ? `${newCount} new${dismissedCount > 0 ? ` · ${dismissedCount} dismissed` : ""}`
              : "Nothing new since the last run."}
        </p>
      </header>

      <InsightFeed insights={cards} />
    </div>
  );
}
