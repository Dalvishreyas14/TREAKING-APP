import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { prisma } from "@/lib/db";
import { dispatchDueReminders } from "@/lib/notifications/dispatch";
import { LIMITS } from "@/lib/rate-limit";
import { notificationReadSchema } from "@/lib/validation/schemas";

/**
 * GET /api/v1/notifications
 *
 * Dispatches anything due before reading, which is the whole delivery mechanism
 * (see `notifications/dispatch`). The count of what it just delivered is
 * returned alongside the list so the header can show "3 new" without a second
 * round trip, and so a client that polls cannot tell whether the unread badge
 * moved because the user read something or because a reminder fired.
 */
export const GET = withApi({
  method: "GET",
  query: z.object({
    unreadOnly: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  }),
  async handler({ user, query }) {
    const dispatched = await dispatchDueReminders(user.id);

    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: {
          userId: user.id,
          ...(query.unreadOnly ? { readAt: null } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          actionUrl: true,
          readAt: true,
          createdAt: true,
        },
      }),
      prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);

    return {
      dispatched,
      unreadCount,
      items: items.map((n) => ({
        ...n,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  },
});

/**
 * PATCH /api/v1/notifications
 *
 * Marking read and marking unread are the same endpoint on purpose: the bell
 * badge is a two-way thing, and "mark as unread" being a separate route is how
 * it usually goes missing. `readAt: null` is how unread is represented, so the
 * two directions are one `updateMany` with a different value.
 */
export const PATCH = withApi({
  method: "PATCH",
  body: notificationReadSchema,
  rateLimit: LIMITS.write,
  async handler({ user, body }) {
    // `readAt: null` *is* unread, so both directions are one update with a
    // different value rather than a delete.
    const readAt = body.read ? new Date() : null;

    const result = await prisma.notification.updateMany({
      where: {
        // The userId here is the security control, not a filter: it is what
        // stops one account marking another's notifications read by id.
        userId: user.id,
        ...(body.all ? {} : { id: { in: body.ids ?? [] } }),
      },
      data: { readAt },
    });

    return {
      updated: result.count,
      unreadCount: await prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    };
  },
});
