import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/with-api";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { buildReminderPatch } from "@/lib/notifications/reminder-patch";
import { describeRecurrence } from "@/lib/notifications/recurrence";
import { reminderUpdateSchema } from "@/lib/validation/schemas";

/**
 * PATCH /api/v1/reminders/:id   DELETE /api/v1/reminders/:id
 *
 * Changing the schedule clears `lastSentAt`. This is not tidiness, it is
 * correctness: `isDue` treats `lastSentAt >= scheduledFor` as "already
 * delivered", so moving a reminder to 07:00 while its old slot at 09:00 was
 * already delivered would leave a reminder that can never fire again. The stale
 * timestamp is what makes the bug invisible, so it is cleared here rather than
 * left for the next reader to notice.
 *
 * Disabling keeps the row, and so does deleting - a fired reminder is deleted
 * only when asked. `sentAt` records the last delivery and is never written by
 * hand; it belongs to the dispatcher.
 */
const params = z.object({ id: z.string().min(1) });

export const PATCH = withApi({
  method: "PATCH",
  params,
  body: reminderUpdateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params: p, body }) {
    const existing = await prisma.reminder.findFirst({
      where: { id: p.id, userId: user.id },
      select: { id: true, scheduledFor: true },
    });
    if (!existing) throw new ApiError("NOT_FOUND", "That reminder does not exist.");

    const reminder = await prisma.reminder.update({
      where: { id: p.id },
      // Built by a helper rather than written inline, because the difference
      // between "absent" and "cleared" is invisible in an object literal and
      // silently wrong when it is missed. See `notifications/reminder-patch`.
      data: buildReminderPatch(body),
      select: {
        id: true,
        title: true,
        body: true,
        targetType: true,
        targetId: true,
        scheduledFor: true,
        recurrence: true,
        enabled: true,
        sentAt: true,
        createdAt: true,
      },
    });

    return {
      ...reminder,
      scheduledFor: reminder.scheduledFor.toISOString(),
      sentAt: reminder.sentAt?.toISOString() ?? null,
      createdAt: reminder.createdAt.toISOString(),
      recurrenceLabel: describeRecurrence(reminder.recurrence),
    };
  },
});

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params: p }) {
    const deleted = await prisma.reminder.deleteMany({ where: { id: p.id, userId: user.id } });
    if (deleted.count === 0) {
      throw new ApiError("NOT_FOUND", "That reminder does not exist.");
    }
    return { deleted: deleted.count };
  },
});

