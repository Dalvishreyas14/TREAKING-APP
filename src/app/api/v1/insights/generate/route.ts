import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { addDaysUtc, dateOnly } from "@/lib/date";
import { LIMITS } from "@/lib/rate-limit";
import { loadSnapshot } from "@/lib/ai/snapshot";
import { generateInsights } from "@/lib/ai/insights";

/**
 * POST /api/v1/insights/generate
 *
 * Recomputes insights from the user's data and stores the new ones.
 *
 * Two behaviours here are the whole design:
 *
 * 1. **Dedup on content, not id.** Every run over the same data produces the same
 *    insights, so they are keyed by `(userId, kind, title)`. Re-running the
 *    generator must refresh confidence and evidence without the insights screen
 *    growing a duplicate of everything it showed yesterday. A user who taps
 *    "refresh" ten times should still see one card, with the newest numbers.
 * 2. **Dismissals survive.** An insight the user dismissed stays dismissed, so
 *    regeneration does not resurrect advice they have already rejected. That is
 *    the difference between a system that listens and one that nags.
 */

const DEDUPE_KEY = "title";

export const POST = withApi({
  method: "POST",
  rateLimit: LIMITS.aiChat,
  async handler({ user }) {
    const now = new Date();
    const snapshot = await loadSnapshot(user.id, { days: 30 });

    if (!snapshot.profile.aiEnabled) {
      throw ApiError.aiUnavailable("Turn insights on in settings to use them.");
    }

    const drafts = generateInsights(snapshot, now);

    if (drafts.length === 0) {
      return {
        created: 0,
        updated: 0,
        total: 0,
        reason: snapshot.sparse
          ? ("NOT_ENOUGH_DATA" as const)
          : ("NO_PATTERNS_FOUND" as const),
        insights: [],
      };
    }

    // An observation stops being actionable once the window it was derived from
    // has passed. Without this, "your habits slipped on Sundays" would outlive the
    // Sundays it was about.
    const validUntil = addDaysUtc(dateOnly(now), 7);

    const existing = await prisma.insight.findMany({
      where: { userId: user.id, kind: { in: [...new Set(drafts.map((d) => d.kind))] } },
      select: { id: true, kind: true, [DEDUPE_KEY]: true, status: true },
    });

    const byKey = new Map(existing.map((row) => [`${row.kind}:${row[DEDUPE_KEY]}`, row]));

    let created = 0;
    let updated = 0;
    let preserved = 0;

    for (const draft of drafts) {
      const key = `${draft.kind}:${draft.title}`;
      const match = byKey.get(key);

      if (match) {
        // A dismissed insight is left exactly as it is. Refreshing the numbers
        // on a card the user threw away only makes it easier to see again.
        if (match.status === "DISMISSED") {
          preserved += 1;
          continue;
        }

        await prisma.insight.update({
          where: { id: match.id },
          data: {
            body: draft.body,
            confidence: draft.confidence,
            sampleSize: draft.sampleSize,
            evidence: draft.evidence as object,
            actionKind: draft.actionKind,
            actionPayload: (draft.actionPayload ?? null) as object,
            relatedHabitId: draft.relatedHabitId,
            relatedCategoryId: draft.relatedCategoryId,
            validUntil,
            // APPLIED is a record of an action the user took. Regenerating must
            // not silently reset it to NEW and offer the same advice again.
            ...(match.status === "APPLIED" ? {} : { status: "SEEN", actedAt: null }),
            source: "LOCAL",
          },
        });
        updated += 1;
        continue;
      }

      await prisma.insight.create({
        data: {
          userId: user.id,
          kind: draft.kind,
          status: "NEW",
          title: draft.title,
          body: draft.body,
          confidence: draft.confidence,
          sampleSize: draft.sampleSize,
          evidence: draft.evidence as object,
          source: "LOCAL",
          actionKind: draft.actionKind,
          actionPayload: (draft.actionPayload ?? null) as object,
          relatedHabitId: draft.relatedHabitId,
          relatedCategoryId: draft.relatedCategoryId,
          validUntil,
        },
      });
      created += 1;
    }

    const insights = await prisma.insight.findMany({
      where: { userId: user.id, status: { not: "DISMISSED" } },
      orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
      take: 25,
    });

    return {
      created,
      updated,
      preserved,
      total: drafts.length,
      reason: null,
      insights,
    };
  },
});
