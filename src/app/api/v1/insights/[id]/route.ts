import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { insightUpdateSchema } from "@/lib/validation/schemas";

/**
 * PATCH /api/v1/insights/:id
 *
 * Ownership is enforced inside the `where` clause rather than by reading the row
 * first. A cross-account id simply matches nothing, which produces the same 404
 * as a genuinely missing id — so this route cannot be used to probe which
 * insight ids exist in someone else's account.
 *
 * `actedAt` is stamped on APPLIED and left alone otherwise, so a dismissed-then-
 * reopened insight keeps its original "when I acted on this" history.
 */

const params = z.object({ id: z.string().min(1) });

export const PATCH = withApi({
  method: "PATCH",
  params,
  body: insightUpdateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const updated = await prisma.insight.updateMany({
      where: { id: params.id, userId: user.id },
      data: {
        status: body.status,
        ...(body.status === "APPLIED" ? { actedAt: new Date() } : {}),
      },
    });

    if (updated.count === 0) {
      throw ApiError.notFound("Insight not found");
    }

    const insight = await prisma.insight.findUniqueOrThrow({
      where: { id: params.id },
    });

    return insight;
  },
});
