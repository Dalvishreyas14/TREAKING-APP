import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { loadSnapshot } from "@/lib/ai/snapshot";
import { buildMonthlyReport, buildWeeklyReport } from "@/lib/ai/reports";

/**
 * POST /api/v1/reviews/generate
 *
 * Builds the weekly review and/or the monthly report from the user's data.
 *
 * Both models carry a `@@unique([userId, weekStart])` / `@@unique([userId,
 * monthStart])`, and that constraint is the feature rather than an implementation
 * detail: regenerating is an upsert, so a user who regenerates gets a corrected
 * review instead of a second copy of the same week. Two rows for one week would
 * make "how was my week" unanswerable.
 *
 * The window is derived from the requested period, not from a rolling 30 days.
 * A review of "this week" that silently covers the last 30 days is not a review.
 */

const body = z.object({
  /** "WEEK", "MONTH", or both. */
  period: z.enum(["WEEK", "MONTH", "BOTH"]).default("BOTH"),
});

export const POST = withApi({
  method: "POST",
  body,
  rateLimit: LIMITS.aiChat,
  async handler({ user, body: input }) {
    const now = new Date();

    const [user_ = null, snapshot] = await Promise.all([
      prisma.user.findUnique({
        where: { id: user.id },
        select: { aiEnabled: true },
      }),
      loadSnapshot(user.id, { days: 45 }),
    ]);

    if (!user_?.aiEnabled) {
      throw ApiError.aiUnavailable("Turn insights on in settings to build reviews.");
    }

    const wantsWeek = input.period === "WEEK" || input.period === "BOTH";
    const wantsMonth = input.period === "MONTH" || input.period === "BOTH";

    const weekly = wantsWeek
      ? await (async () => {
          const draft = buildWeeklyReport(snapshot, now);
          const record = await prisma.weeklyReview.upsert({
            where: { userId_weekStart: { userId: user.id, weekStart: draft.weekStart } },
            create: {
              userId: user.id,
              weekStart: draft.weekStart,
              weekEnd: draft.weekEnd,
              periodLabel: draft.periodLabel,
              summary: draft.summary,
              metrics: draft.metrics as object,
              highlights: draft.highlights as object,
              misses: draft.misses as object,
              patterns: draft.patterns as object,
              recommendations: draft.recommendations as object,
              provider: "local",
            },
            update: {
              weekEnd: draft.weekEnd,
              periodLabel: draft.periodLabel,
              summary: draft.summary,
              metrics: draft.metrics as object,
              highlights: draft.highlights as object,
              misses: draft.misses as object,
              patterns: draft.patterns as object,
              recommendations: draft.recommendations as object,
              provider: "local",
            },
          });
          return record;
        })()
      : null;

    const monthly = wantsMonth
      ? await (async () => {
          const draft = buildMonthlyReport(snapshot, now);
          const record = await prisma.monthlyReport.upsert({
            where: { userId_monthStart: { userId: user.id, monthStart: draft.monthStart } },
            create: {
              userId: user.id,
              monthStart: draft.monthStart,
              monthEnd: draft.monthEnd,
              monthLabel: draft.monthLabel,
              summary: draft.summary,
              metrics: draft.metrics as object,
              achievements: draft.achievements as object,
              habitStats: draft.habitStats as object,
              goalStats: draft.goalStats as object,
              focusStats: draft.focusStats as object,
              timeStats: draft.timeStats as object,
              lifeBalance: draft.lifeBalance as object,
              missed: draft.missed as object,
              recommendations: draft.recommendations as object,
              provider: "local",
            },
            update: {
              monthEnd: draft.monthEnd,
              monthLabel: draft.monthLabel,
              summary: draft.summary,
              metrics: draft.metrics as object,
              achievements: draft.achievements as object,
              habitStats: draft.habitStats as object,
              goalStats: draft.goalStats as object,
              focusStats: draft.focusStats as object,
              timeStats: draft.timeStats as object,
              lifeBalance: draft.lifeBalance as object,
              missed: draft.missed as object,
              recommendations: draft.recommendations as object,
              provider: "local",
            },
          });
          return record;
        })()
      : null;

    return {
      period: input.period,
      weekly,
      monthly,
      // Surfaced so the screen can say "not enough data yet" rather than showing
      // a review full of zeroes that reads like a bad week.
      sparse: snapshot.sparse,
    };
  },
});
