import { NotificationsScreen } from "@/components/app/notifications-screen";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { dispatchDueReminders } from "@/lib/notifications/dispatch";
import { describeRecurrence } from "@/lib/notifications/recurrence";

export const dynamic = "force-dynamic";

/**
 * Reminders and notifications.
 *
 * These are one screen because they are the same idea seen from two ends: a
 * reminder is something you asked to be told later, and a notification is the
 * telling. Splitting them across two nav items would make the user decide which
 * one to open before knowing whether anything is waiting.
 *
 * Due reminders are dispatched here, on the page that exists to show them. That
 * is the delivery mechanism, not an optimisation - see `notifications/dispatch`
 * for why there is no worker. It is done on the server before the read so the
 * page and the list cannot disagree about what has already arrived.
 */
export default async function NotificationsPage() {
  const user = await requireUser();
  const now = new Date();

  await dispatchDueReminders(user.id, now);

  const [notifications, unreadCount, reminders, tasks] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
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
    prisma.reminder.findMany({
      where: { userId: user.id, enabled: true },
      orderBy: { scheduledFor: "asc" },
      take: 50,
      select: {
        id: true,
        title: true,
        body: true,
        targetType: true,
        scheduledFor: true,
        recurrence: true,
      },
    }),
    prisma.task.findMany({
      /*
       * Only tasks due today and still open. A reminder needs a target to point
       * at, and the whole point of reminding yourself about a task is while it is
       * still something you could do today - offering a list of next month's
       * backlog would make the picker useless.
       *
       * `dueAt` is an instant, so "today" is an explicit local range rather than
       * a date equality, which would silently exclude the afternoon.
       */
      where: {
        userId: user.id,
        status: { in: ["TODO", "IN_PROGRESS"] },
        dueAt: {
          gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
          lt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
        },
      },
      orderBy: { dueAt: "asc" },
      take: 20,
      select: { id: true, title: true },
    }),
  ]);

  return (
    <NotificationsScreen
      notifications={notifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        actionUrl: n.actionUrl,
        read: n.readAt !== null,
        createdAt: n.createdAt.toISOString(),
      }))}
      unreadCount={unreadCount}
      reminders={reminders.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        // The column is nullable on the row but the create path always writes
        // it, so the null case is legacy data rather than a real state.
        targetType: r.targetType ?? "CUSTOM",
        scheduledFor: r.scheduledFor.toISOString(),
        recurrenceLabel: describeRecurrence(r.recurrence),
      }))}
      tasks={tasks.map((t) => ({ id: t.id, title: t.title }))}
      /*
       * Icons cross as names, not components. A lucide icon is a function with
       * methods attached, and React refuses to serialise that from a server
       * component to a client one - the page renders, then every icon on it
       * silently fails to arrive. The client owns the name-to-component map.
       */
      figures={[
        { label: "Waiting", value: unreadCount, icon: "unread" },
        { label: "Reminders set", value: reminders.length, icon: "reminders" },
      ]}
    />
  );
}
