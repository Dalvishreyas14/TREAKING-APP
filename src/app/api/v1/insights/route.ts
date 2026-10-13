import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { prisma } from "@/lib/db";

/**
 * GET /api/v1/insights?status&kind
 *
 * Insights are read-and-react. There is no POST here: an `Insight` is something
 * the system derived from the user's own data, and an endpoint that let a client
 * write one would let anything on the internet tell this user what their life
 * looks like. Reacting to one lives at `/insights/:id`.
 *
 * Dismissal is a status, not a delete. Keeping the row is what stops the same
 * observation being re-derived and re-nagged on every recompute, and it leaves
 * the evidence trail the insight was based on.
 */

const listQuery = z.object({
  status: z.enum(["NEW", "SEEN", "APPLIED", "DISMISSED", "ALL"]).default("NEW"),
  kind: z
    .enum(["CORRELATION", "PATTERN", "PREDICTION", "RECOMMENDATION", "OBSERVATION"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = withApi({
  method: "GET",
  query: listQuery,
  async handler({ user, query }) {
    const where = {
      userId: user.id,
      ...(query.status === "ALL" ? {} : { status: query.status }),
      ...(query.kind ? { kind: query.kind } : {}),
      // An insight past its validity window is stale, not actionable. Hidden
      // rather than deleted so the history stays coherent.
      ...(query.status === "NEW"
        ? { OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }] }
        : {}),
    };

    const [items, counts] = await Promise.all([
      prisma.insight.findMany({
        where,
        orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
        take: query.limit,
      }),
      prisma.insight.groupBy({
        by: ["status"],
        where: { userId: user.id },
        _count: { _all: true },
      }),
    ]);

    return {
      items,
      counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
    };
  },
});
