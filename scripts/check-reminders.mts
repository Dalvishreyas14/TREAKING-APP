/**
 * Integration check of the reminder delivery engine, against the real database.
 *
 * The unit tests in `test/notifications-recurrence.test.ts` cover `isDue` and
 * `advance` as pure functions, and they cover them well. What they cannot cover
 * is whether the wiring around them holds:
 *
 *  - a reminder row that is genuinely overdue is picked up at all
 *  - dispatching twice does not deliver twice (the whole design rests on this)
 *  - a one-shot reminder is consumed and a repeating one is moved forward
 *  - a repeating reminder keeps its own time of day rather than the dispatch time
 *
 * Those are all only observable against real rows, so this creates a throwaway
 * user, exercises the engine, and deletes everything it made.
 *
 * It deliberately does not go through HTTP. Authentication here means email
 * verification and a session cookie, and the HTTP surface is already covered by
 * `check-routes.mts` against the demo account. What is left to prove is the
 * engine, and Prisma is the honest tool for that.
 */

import { createRequire } from "node:module";
import type { NodeModule } from "node:module";

/*
 * Next.js loads .env for us; a bare node process does not.
 */
if (!process.env.DATABASE_URL) process.loadEnvFile(".env");

/*
 * The real `src/lib/notifications/dispatch.ts` and the real Prisma client, rather
 * than copies of both.
 *
 * That is worth the two tricks below, because a script that reimplements the
 * function under test proves only that the reimplementation is consistent with
 * itself - if `dispatch.ts` were changed and the copy left alone, this would still
 * pass. Two things stand in the way of importing the real modules:
 *
 *  1. `src/lib/db` imports `server-only`, which throws under plain Node because it
 *     resolves the `react-server` export condition that only Next.js provides.
 *     Seeding `require.cache` with an empty module for it satisfies the import
 *     without weakening anything in the real build, where the marker is still
 *     there to reject client bundling. This is the same stub `vitest.config.mts`
 *     installs, for exactly the same reason.
 *  2. `src/lib/env` is guarded the same way and validates the whole environment,
 *     so `.env` must be loaded before it is imported - hence the dynamic imports
 *     below rather than hoisted static ones.
 */
const require = createRequire(import.meta.url);
const serverOnlyId = require.resolve("server-only");
require.cache[serverOnlyId] = {
  id: serverOnlyId,
  filename: serverOnlyId,
  loaded: true,
  exports: {},
} as NodeModule;

const { prisma } = await import("../src/lib/db.ts");
const { dispatchDueReminders } = await import("../src/lib/notifications/dispatch.ts");

let userId: string | null = null;
let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function main() {
  const user = await prisma.user.create({
    data: { email: `reminder-check-${Date.now()}@lifeos.test`, name: "Reminder Check" },
  });
  userId = user.id;
  console.log(`throwaway user ${user.id}\n`);

  const past = new Date(Date.now() - 60_000);
  const future = new Date(Date.now() + 3_600_000);

  const oneShot = await prisma.reminder.create({
    data: {
      userId,
      title: "Check the oven",
      body: "It has been on twenty minutes.",
      type: "CUSTOM",
      targetType: "CUSTOM",
      scheduledFor: past,
      enabled: true,
    },
  });
  const daily = await prisma.reminder.create({
    data: {
      userId,
      title: "Water the plants",
      type: "CUSTOM",
      targetType: "CUSTOM",
      scheduledFor: past,
      recurrence: { freq: "DAILY", interval: 1 },
      enabled: true,
    },
  });
  const notYet = await prisma.reminder.create({
    data: {
      userId,
      title: "Not due yet",
      type: "CUSTOM",
      targetType: "CUSTOM",
      scheduledFor: future,
      enabled: true,
    },
  });
  const paused = await prisma.reminder.create({
    data: {
      userId,
      title: "Paused and overdue",
      type: "CUSTOM",
      targetType: "CUSTOM",
      scheduledFor: past,
      enabled: false,
    },
  });
  /*
   * An EMAIL reminder that is due. Nothing in this app sends email, so
   * dispatching it would deliver an in-app notification the user never chose to
   * receive in-app. It is created directly against Prisma rather than through
   * the API because the API has no way to set a channel at all - which is the
   * point: if the channel filter were ever widened, the API could not produce
   * this row, and the only way to get one would be a seed or an import.
   */
  const emailChannel = await prisma.reminder.create({
    data: {
      userId,
      title: "Due but not an in-app channel",
      type: "CUSTOM",
      targetType: "CUSTOM",
      channel: "EMAIL",
      scheduledFor: past,
      enabled: true,
    },
  });

  // ---- first dispatch ------------------------------------------------------
  const now = new Date();
  const first = await dispatchDueReminders(userId, now);
  check("first dispatch delivers both due reminders", first === 2, `got ${first}`);

  const afterFirst = await prisma.notification.count({ where: { userId } });
  check("two notifications were written", afterFirst === 2, `got ${afterFirst}`);

  // ---- idempotency: the property everything else depends on ----------------
  const second = await dispatchDueReminders(userId, new Date());
  check("second dispatch delivers nothing", second === 0, `got ${second}`);

  const third = await dispatchDueReminders(userId, new Date());
  const afterRepeat = await prisma.notification.count({ where: { userId } });
  check("still two notifications after a third dispatch", afterRepeat === 2, `got ${afterRepeat}`);
  check("third dispatch also delivered nothing", third === 0, `got ${third}`);

  // ---- the one-shot was consumed ------------------------------------------
  const oneShotRow = await prisma.reminder.findUniqueOrThrow({ where: { id: oneShot.id } });
  check("a one-shot reminder is disabled after firing", oneShotRow.enabled === false);
  check("its sentAt is stamped", oneShotRow.sentAt !== null);
  check("its lastSentAt is stamped", oneShotRow.lastSentAt !== null);

  // ---- the repeat moved forward, not stopped -------------------------------
  const dailyRow = await prisma.reminder.findUniqueOrThrow({ where: { id: daily.id } });
  check("a daily reminder stays enabled", dailyRow.enabled === true);
  check("a daily reminder is rescheduled into the future", dailyRow.scheduledFor > new Date());
  check("a daily reminder has no final sentAt", dailyRow.sentAt === null);
  check(
    "a daily reminder keeps its own time of day, not the dispatch time",
    dailyRow.scheduledFor.getHours() === daily.scheduledFor.getHours(),
    `${daily.scheduledFor.getHours()}:xx -> ${dailyRow.scheduledFor.getHours()}:xx`,
  );

  // ---- untouched rows ------------------------------------------------------
  const notYetRow = await prisma.reminder.findUniqueOrThrow({ where: { id: notYet.id } });
  check("a future reminder is left alone", notYetRow.scheduledFor.getTime() === future.getTime());
  check("a future reminder has no lastSentAt", notYetRow.lastSentAt === null);

  const pausedRow = await prisma.reminder.findUniqueOrThrow({ where: { id: paused.id } });
  check("a paused reminder is left alone", pausedRow.lastSentAt === null);

  // A due reminder on a channel this process cannot deliver must be skipped
  // entirely, and skipped without being advanced - if it were advanced, the
  // occurrence would be consumed silently and never delivered by anything.
  const emailRow = await prisma.reminder.findUniqueOrThrow({ where: { id: emailChannel.id } });
  check("a non-in-app reminder is not advanced", emailRow.lastSentAt === null);
  check("a non-in-app reminder keeps its schedule", emailRow.scheduledFor.getTime() === past.getTime());

  const titles = await prisma.notification.findMany({ where: { userId }, select: { title: true } });
  check(
    "only the two due in-app reminders were delivered",
    titles.map((t) => t.title).sort().join(",") === "Check the oven,Water the plants",
    titles.map((t) => t.title).join(","),
  );
}

main()
  .catch((error) => {
    console.error(error);
    failures += 1;
  })
  .finally(async () => {
    if (userId) {
      // Both tables cascade from User, but being explicit means a partial run
      // cannot leave a row behind to confuse the next one.
      await prisma.notification.deleteMany({ where: { userId } });
      await prisma.reminder.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
    console.log(failures === 0 ? "\nALL CLEAN" : `\n${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  });
