import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { weeklyReviewNotesSchema } from "@/lib/validation/schemas";
import { dateOnlyToIsoDay, weekBounds } from "@/lib/weekly-plans/week";

/**
 * GET / PUT /api/v1/weekly-plans/reviews/:weekStart
 *
 * The user's own three answers to their week — what went well, what should improve,
 * what to focus on next.
 *
 * These are stored on the **existing** `WeeklyReview` row rather than on a plan, and
 * that placement is the important decision here. A week is the unit of reflection,
 * not a plan: someone with a fitness plan and a study plan has one week that went
 * well and one week that did not, and two reviews would make "how was my week"
 * unanswerable. The `@@unique([userId, weekStart])` constraint on that table is
 * already saying this out loud.
 *
 * Because of that, a week with no generated review yet has no row to write to. GET
 * returns the empty shape rather than 404, and PUT upserts — so the user can answer
 * the questions on Sunday whether or not they have ever opened Analytics, and a
 * review generated later fills in `summary`/`metrics` around their own words instead
 * of overwriting them.
 *
 * The generated fields and the handwritten fields are never confused: this route
 * writes only the three text columns and reads/writes nothing that `buildWeeklyReport`
 * produces.
 */

const params = z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-09-28") });

/** Normalise any day in a week to that week's first day. */
function weekStartFrom(isoDay: string, weekStartsOn: number): string {
  const [y, m, d] = isoDay.split("-").map(Number) as [number, number, number];
  const anchor = new Date(Date.UTC(y, m - 1, d));
  return dateOnlyToIsoDay(weekBounds(anchor, weekStartsOn).start);
}

async function weekStartsOnFor(userId: string): Promise<number> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { weekStartsOn: true },
  });
  return row?.weekStartsOn ?? 1;
}

const EMPTY_REVIEW = {
  weekStart: "",
  weekEnd: "",
  periodLabel: "",
  summary: "",
  wentWell: null as string | null,
  shouldImprove: null as string | null,
  nextWeekFocus: null as string | null,
  exists: false,
};

export const GET = withApi({
  method: "GET",
  params,
  async handler({ user, params }) {
    const weekStartsOn = await weekStartsOnFor(user.id);
    // Normalised rather than used verbatim, so asking for "the week containing the
    // 30th" finds the review for the 28th. The column is a week *start* and a client
    // that guessed wrong would otherwise get an empty review for a week that exists.
    const weekStart = weekStartFrom(params.weekStart, weekStartsOn);
    const [y, m, d] = weekStart.split("-").map(Number) as [number, number, number];
    const start = new Date(Date.UTC(y, m - 1, d));

    const review = await prisma.weeklyReview.findUnique({
      where: { userId_weekStart: { userId: user.id, weekStart: start } },
      select: {
        weekStart: true,
        weekEnd: true,
        periodLabel: true,
        summary: true,
        wentWell: true,
        shouldImprove: true,
        nextWeekFocus: true,
        updatedAt: true,
      },
    });

    if (!review) {
      return { ...EMPTY_REVIEW, weekStart, weekEnd: dateOnlyToIsoDay(weekBounds(start, weekStartsOn).end) };
    }

    return {
      weekStart: dateOnlyToIsoDay(review.weekStart),
      weekEnd: dateOnlyToIsoDay(review.weekEnd),
      periodLabel: review.periodLabel,
      summary: review.summary,
      wentWell: review.wentWell,
      shouldImprove: review.shouldImprove,
      nextWeekFocus: review.nextWeekFocus,
      exists: true,
      updatedAt: review.updatedAt.toISOString(),
    };
  },
});

export const PUT = withApi({
  method: "PUT",
  params,
  body: weeklyReviewNotesSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const weekStartsOn = await weekStartsOnFor(user.id);
    const weekStart = weekStartFrom(params.weekStart, weekStartsOn);
    const [y, m, d] = weekStart.split("-").map(Number) as [number, number, number];
    const start = new Date(Date.UTC(y, m - 1, d));
    const end = weekBounds(start, weekStartsOn).end;

    // Upserted, and the create branch carries only the three handwritten fields.
    //
    // `buildWeeklyReport` fills in summary/metrics/highlights/misses/patterns/
    // recommendations, and those are non-null `Json` columns with no default — so a
    // review created here has to satisfy that shape or the insert fails. Empty arrays
    // and objects mean "not generated yet" rather than "generated and found nothing",
    // and `generate` will overwrite them with real content when it runs.
    //
    // `periodLabel` is set to the week itself so the row is legible in a database
    // view; `generate` replaces it with its own wording on first run.
    const review = await prisma.weeklyReview.upsert({
      where: { userId_weekStart: { userId: user.id, weekStart: start } },
      create: {
        userId: user.id,
        weekStart: start,
        weekEnd: end,
        periodLabel: `Week of ${dateOnlyToIsoDay(start)}`,
        summary: "",
        metrics: {},
        highlights: {},
        misses: {},
        patterns: {},
        recommendations: {},
        wentWell: body.wentWell ?? null,
        shouldImprove: body.shouldImprove ?? null,
        nextWeekFocus: body.nextWeekFocus ?? null,
        provider: null,
      },
      update: {
        wentWell: body.wentWell ?? null,
        shouldImprove: body.shouldImprove ?? null,
        nextWeekFocus: body.nextWeekFocus ?? null,
      },
      select: {
        weekStart: true,
        weekEnd: true,
        wentWell: true,
        shouldImprove: true,
        nextWeekFocus: true,
        updatedAt: true,
      },
    });

    if (!review) {
      throw ApiError.internal("The review could not be saved.");
    }

    return {
      weekStart: dateOnlyToIsoDay(review.weekStart),
      weekEnd: dateOnlyToIsoDay(review.weekEnd),
      wentWell: review.wentWell,
      shouldImprove: review.shouldImprove,
      nextWeekFocus: review.nextWeekFocus,
      saved: true,
    };
  },
});