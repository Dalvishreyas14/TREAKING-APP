import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { applyAction, previewAction } from "@/lib/ai/action-context";
import { LIMITS } from "@/lib/rate-limit";

/**
 * GET  /api/v1/insights/:id/action  — the typed preview
 * POST /api/v1/insights/:id/action  — the confirm
 *
 * Two verbs on one resource, because the difference between "show me what this
 * would do" and "do it" is exactly the difference between a read and a write, and
 * collapsing them into a single POST is how products end up with a button that
 * changes your data before you have read what it changes.
 *
 * The confirm takes no parameters describing *what* to change — its body is empty
 * on purpose, because a client that could name the writes could also lie about
 * them. The change comes from the insight's own stored payload, re-planned
 * against live state inside the transaction, and the response is the diff that
 * actually ran. If the data it names has already been dealt with by hand, the
 * apply answers 409 with the reason rather than 200, because a success the user
 * did not cause is a lie about their own data.
 */

const params = z.object({ id: z.string().min(1) });

export const GET = withApi({
  method: "GET",
  params,
  // Reads are rate limited too: each call is several database queries, and a
  // client bug that polls this in a loop should hit a bucket, not the database.
  rateLimit: { limit: 120, windowMs: 60_000 },
  async handler({ user, params }) {
    // Scoped in the WHERE clause for the same reason every other route does it:
    // another account's id must match nothing rather than be read and rejected.
    const insight = await prisma.insight.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true, actionKind: true, actionPayload: true, status: true },
    });

    if (!insight) throw ApiError.notFound("Insight not found");

    const { plan } = await previewAction(user.id, insight.actionKind, insight.actionPayload);
    return { insightId: insight.id, status: insight.status, plan };
  },
});

export const POST = withApi({
  method: "POST",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const insight = await prisma.insight.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true, actionKind: true, actionPayload: true },
    });

    if (!insight) throw ApiError.notFound("Insight not found");

    if (insight.actionKind === null) {
      throw ApiError.conflict(
        "This is an observation, not a suggestion with a change behind it.",
      );
    }

    const result = await applyAction(user.id, insight.actionKind, insight.actionPayload);

    // Marking APPLIED here rather than from the client so that "I applied this"
    // and "this was applied" cannot disagree, and so `actedAt` is stamped next to
    // the writes that justified it rather than whenever the response renders.
    await prisma.insight.updateMany({
      where: { id: insight.id, userId: user.id },
      data: { status: "APPLIED", actedAt: new Date() },
    });

    return { insightId: insight.id, plan: result.plan, applied: result.applied };
  },
});
