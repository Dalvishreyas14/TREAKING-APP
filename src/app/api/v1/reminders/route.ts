import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { buildReminderCreate } from "@/lib/notifications/reminder-patch";
import { describeRecurrence } from "@/lib/notifications/recurrence";
import { reminderCreateSchema } from "@/lib/validation/schemas";

/**
 * GET /api/v1/reminders
 *
 * Returns upcoming and already-fired reminders in one list, split by `enabled`
 * rather than sorted into buckets the client has to re-derive. A reminder that
 * has fired keeps its row and shows as done, because "I did get that reminder,
 * it just went off while I was away" is a question this list has to be able to
 * answer.
 *
 * Deliberately does *not* dispatch. This is the place a user goes to manage
 * what will happen, and creating a notification as a side effect of looking at
 * the schedule would be its own small bug.
 */
export const GET = withApi({
  method: "GET",
  query: z.object({
    includePast: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  }),
  async handler({ user, query }) {
    const reminders = await prisma.reminder.findMany({
      where: {
        userId: user.id,
        ...(query.includePast ? {} : { enabled: true }),
      },
      orderBy: { scheduledFor: "asc" },
      select: {
        id: true,
        title: true,
        body: true,
        type: true,
        targetType: true,
        targetId: true,
        scheduledFor: true,
        recurrence: true,
        enabled: true,
        sentAt: true,
        lastSentAt: true,
        createdAt: true,
      },
    });

    return {
      items: reminders.map((r) => ({
        ...r,
        scheduledFor: r.scheduledFor.toISOString(),
        sentAt: r.sentAt?.toISOString() ?? null,
        lastSentAt: r.lastSentAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        recurrenceLabel: describeRecurrence(r.recurrence),
      })),
    };
  },
});

/**
 * POST /api/v1/reminders
 *
 * A reminder can point at a task, habit or goal, and that link is what lets the
 * notification be clicked through to the thing it is about. So the target is
 * checked for existence here rather than trusted: a reminder pointing at a
 * deleted task is a notification that leads to a 404, and a `targetId` is
 * exactly the kind of value a client will send that the database cannot check
 * for it, because it is a bare string and not a foreign key.
 */
export const POST = withApi({
  method: "POST",
  body: reminderCreateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, body }) {
    if (body.targetId) await assertTargetExists(user.id, body.targetType, body.targetId);

    const reminder = await prisma.reminder.create({
      data: {
        // Built by a helper shared with the PATCH path, so the two cannot drift.
        // See `notifications/reminder-patch` for what each field is doing here.
        ...buildReminderCreate(body),
        userId: user.id,
        // The client's clock, not the server's. A reminder set for 07:00 in
        // Chennai is 07:00 in Chennai, and the browser is the only thing that
        // knows what time the user meant.
        scheduledFor: body.scheduledFor,
      },
      select: {
        id: true,
        title: true,
        body: true,
        targetType: true,
        targetId: true,
        scheduledFor: true,
        recurrence: true,
        enabled: true,
        createdAt: true,
      },
    });

    return {
      ...reminder,
      scheduledFor: reminder.scheduledFor.toISOString(),
      createdAt: reminder.createdAt.toISOString(),
      recurrenceLabel: describeRecurrence(reminder.recurrence),
    };
  },
});

async function assertTargetExists(
  userId: string,
  targetType: string,
  targetId: string,
): Promise<void> {
  const exists = await (async () => {
    switch (targetType) {
      case "TASK":
        return (await prisma.task.count({ where: { id: targetId, userId } })) > 0;
      case "HABIT":
        return (await prisma.habit.count({ where: { id: targetId, userId } })) > 0;
      case "GOAL":
        return (await prisma.goal.count({ where: { id: targetId, userId } })) > 0;
      // REVIEW and CUSTOM have no table to check, and REVIEW is not yet
      // navigable in the app, so a bad id there is harmless.
      default:
        return true;
    }
  })();

  if (!exists) {
    throw new ApiError("NOT_FOUND", "That reminder target no longer exists.");
  }
}

