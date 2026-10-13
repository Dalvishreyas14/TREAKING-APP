import { prisma } from "@/lib/db";
import { advance, isDue } from "@/lib/notifications/recurrence";
import type { NotificationType, ReminderTargetType } from "@/generated/prisma/enums";

/**
 * Turning due reminders into notifications.
 *
 * There is no worker and no cron in this app, so nothing polls the `Reminder`
 * table on a schedule. Instead every read of the notification list calls
 * `dispatchDueReminders` first. That is a deliberate trade: a reminder fires the
 * next time the user looks, rather than at the exact minute they set, and in
 * exchange there is no process to keep running, no double-send window at deploy
 * time, and reminders that cannot fire while the app is closed - which for an
 * app whose notifications are read in-app is not a loss at all.
 *
 * The two rules that make this safe to call on every read are both in
 * `notifications/recurrence` and both are tested there: `isDue` is the only
 * definition of "due", and `advance` is the only definition of "what happens
 * after". Nothing else in this file decides either.
 */

/** A reminder's target decides both the icon and where its notification leads. */
const TYPE_FOR_TARGET: Record<ReminderTargetType, NotificationType> = {
  TASK: "TASK",
  HABIT: "HABIT",
  GOAL: "GOAL",
  // A review has no notification kind of its own, and inventing one would only
  // add a branch to every consumer of the enum for no reader's benefit.
  REVIEW: "SYSTEM",
  CUSTOM: "SYSTEM",
};

const URL_FOR_TARGET: Record<ReminderTargetType, string> = {
  TASK: "/tasks",
  HABIT: "/habits",
  GOAL: "/goals",
  REVIEW: "/insights",
  // A custom reminder is the user's own words, so there is nothing to link to.
  // Sending someone to an arbitrary page because they wrote a reminder would be
  // worse than sending them nowhere.
  CUSTOM: "",
};

/**
 * The page a notification's action link should lead to, or null when it should
 * not have one. A reminder with a target goes to that target's screen; a custom
 * one has no destination.
 */
export function actionUrlFor(targetType: ReminderTargetType | null): string | null {
  if (!targetType) return null;
  const url = URL_FOR_TARGET[targetType];
  return url === "" ? null : url;
}

export function notificationTypeFor(targetType: ReminderTargetType | null): NotificationType {
  return targetType ? TYPE_FOR_TARGET[targetType] : "SYSTEM";
}

/**
 * Delivers every reminder that is due for this user and returns how many were
 * delivered.
 *
 * The candidate query is deliberately broad - "enabled, scheduled at or before
 * now" - and the precise `isDue` rule is applied in JS afterwards. Expressing
 * `lastSentAt < scheduledFor` as a Prisma `where` would need a field-to-field
 * comparison, and duplicating the rule across the two places is exactly the kind
 * of drift that produces duplicate notifications in production. The candidate set
 * is one user's already-due reminders, so the extra rows filtered out in memory
 * are a handful.
 */
export async function dispatchDueReminders(userId: string, now: Date = new Date()): Promise<number> {
  const candidates = await prisma.reminder.findMany({
    // `channel: "IN_APP"` because this is the in-app dispatcher. The schema
    // allows EMAIL and PUSH as well, and no sender is wired for either, so an
    // email reminder read here would not be emailed - it would surface as an
    // in-app notification that the user never asked to receive in the first
    // place. Skipping it keeps "what gets delivered" honest about what this
    // process can actually deliver.
    where: { userId, channel: "IN_APP", enabled: true, scheduledFor: { lte: now } },
    select: {
      id: true,
      title: true,
      body: true,
      type: true,
      targetType: true,
      targetId: true,
      scheduledFor: true,
      lastSentAt: true,
      enabled: true,
      recurrence: true,
    },
  });

  const due = candidates.filter((reminder) => isDue(reminder, now));
  if (due.length === 0) return 0;

  /*
   * The notifications are created in their own transaction, and advancing them
   * is a second one below. They are not atomic together, and the reason is worth
   * stating plainly because the alternative is worse: if the two were one
   * transaction, a concurrent dispatch would have to be blocked or would have to
   * abort the winner's work. Split, a racing dispatch that creates a duplicate is
   * visible and harmless - one extra row the user can dismiss - whereas merging
   * them would let a reminder be advanced by one dispatcher while the other
   * reschedules it from stale state, which is how a reminder ends up skipping a
   * real occurrence entirely.
   */
  await prisma.$transaction(
    due.map((reminder) =>
      prisma.notification.create({
        data: {
          userId,
          type: notificationTypeFor(reminder.targetType),
          title: reminder.title,
          body: reminder.body,
          actionUrl: actionUrlFor(reminder.targetType),
          metadata: reminder.targetId
            ? { reminderId: reminder.id, targetType: reminder.type, targetId: reminder.targetId }
            : { reminderId: reminder.id, targetType: reminder.type },
        },
      }),
    ),
  );

  /*
   * Advancing is a second transaction on purpose. The `isDue` guard is checked
   * against state read before either write, so a concurrent dispatch could pass
   * the same check twice. The update is therefore conditional on the row still
   * looking unsent, so the loser of that race updates zero rows and its
   * duplicate notification is the visible cost of a narrow race - which beats the
   * alternative, a reminder that is advanced by one dispatcher while the other
   * believes it fired and reschedules it again from the same stale date.
   */
  const advanced = await Promise.all(
    due.map((reminder) => {
      const next = advance(reminder.scheduledFor, reminder.recurrence, now);
      return prisma.reminder.updateMany({
        where: {
          id: reminder.id,
          userId,
          OR: [{ lastSentAt: null }, { lastSentAt: { lt: reminder.scheduledFor } }],
        },
        data: {
          scheduledFor: next.scheduledFor,
          lastSentAt: next.lastSentAt,
          sentAt: next.sentAt,
          enabled: next.enabled,
        },
      });
    }),
  );

  return advanced.reduce((n, result) => n + result.count, 0);
}
