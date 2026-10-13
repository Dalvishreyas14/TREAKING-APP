import { chromium, type Page } from "playwright";
import { createRequire } from "node:module";
import type { NodeModule } from "node:module";

/**
 * End-to-end check for the two reminder-write bugs that were silent.
 *
 * Both of them failed by returning 200 and doing something other than what was
 * asked, which is exactly why unit tests alone did not catch them and why this
 * script talks to the real HTTP API and then reads the real table.
 *
 * 1. Create never wrote `targetType`. The column is nullable with no default, so
 *    a reminder linked to a task was stored with a null target type. The
 *    dispatcher reads that column for both the icon and whether the notification
 *    has a link, so the reminder arrived as an anonymous SYSTEM message with no
 *    way to reach the task - and the create response echoed the null back, so
 *    the UI dropped the link at the moment it was made.
 *
 * 2. Clearing a recurrence did not clear it. `body.recurrence ?? undefined` maps
 *    "make this a one-off" onto "change nothing", because Prisma treats a key
 *    whose value is `undefined` as absent. And the obvious repair - a bare
 *    `null` - is not writable either, since `recurrence` is a Json column where
 *    Prisma needs `DbNull` to mean SQL NULL. The failure mode this test pins is
 *    the one that survives both mistakes: writing `Prisma.JsonNull` instead,
 *    which *looks* cleared but leaves the four-byte JSON literal `null` in the
 *    column. Reading the column back through Prisma cannot tell that apart from
 *    a real NULL - both arrive as JavaScript `null` - so this asks Postgres
 *    directly.
 */

if (!process.env.DATABASE_URL) process.loadEnvFile(".env");

const require = createRequire(import.meta.url);
const serverOnlyId = require.resolve("server-only");
require.cache[serverOnlyId] = {
  id: serverOnlyId,
  filename: serverOnlyId,
  loaded: true,
  exports: {},
} as NodeModule;

const { prisma } = await import("../src/lib/db.ts");

const BASE = "http://localhost:3000";
const EMAIL = "demo@lifeos.app";
const PASSWORD = "LIFEOSdemo2026";

/*
 * The same browser resolution `check-routes.mts` uses. Playwright's own bundled
 * download is not what this machine has on disk, so the default
 * `chromium.launch()` path is a hard failure here rather than a slow one.
 */
const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe`;

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? ` -> ${detail}` : ""}`);
  if (!ok) failures++;
}

async function setInput(page: Page, selector: string, value: string) {
  await page.waitForSelector(selector, { timeout: 15_000 });
  await page.fill(selector, "");
  await page.type(selector, value, { delay: 12 });
}

async function signIn(page: Page) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await setInput(page, 'input[type="email"]', EMAIL);
  await setInput(page, 'input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !window.location.pathname.includes("sign-in"), null, {
    timeout: 20_000,
  });
}

const browser = await chromium.launch({ executablePath: CHROME });
let reminderId: string | null = null;

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page);

  // `context.request` shares the page's cookies, so these are the same
  // authenticated calls the UI makes.
  const api = context.request;

  const tasksRes = await api.get(`${BASE}/api/v1/tasks?limit=1`);
  const tasksBody = await tasksRes.json();
  const task = tasksBody?.data?.items?.[0];
  check("found a task to link the reminder to", Boolean(task?.id), JSON.stringify(tasksBody).slice(0, 120));
  if (!task?.id) throw new Error("no task available; seed the database first");

  const scheduledFor = new Date(Date.now() + 3_600_000).toISOString();

  // ---- create with a task target and a daily recurrence --------------------
  const createRes = await api.post(`${BASE}/api/v1/reminders`, {
    data: {
      title: "Check the linked thing",
      body: "Created by check-reminder-api",
      scheduledFor,
      recurrence: { freq: "DAILY", interval: 1 },
      targetType: "TASK",
      targetId: task.id,
    },
  });
  check("create returns 200", createRes.status() === 200, `status ${createRes.status()}`);
  const created = (await createRes.json())?.data;
  reminderId = created?.id ?? null;
  check("create echoes back the target type it was given", created?.targetType === "TASK", `got ${created?.targetType}`);
  check("create returns an id", Boolean(reminderId));
  if (!reminderId) throw new Error("create did not return an id");

  const afterCreate = await prisma.reminder.findUniqueOrThrow({
    where: { id: reminderId },
    select: { type: true, targetType: true, targetId: true, recurrence: true },
  });
  check("the stored row has a target type", afterCreate.targetType === "TASK", `got ${afterCreate.targetType}`);
  check("both target columns agree", afterCreate.type === afterCreate.targetType, `${afterCreate.type} vs ${afterCreate.targetType}`);
  check("the stored row kept the task id", afterCreate.targetId === task.id);
  check("the stored row has the recurrence", (afterCreate.recurrence as { freq?: string } | null)?.freq === "DAILY");

  // ---- clear the recurrence ------------------------------------------------
  const patchRes = await api.patch(`${BASE}/api/v1/reminders/${reminderId}`, {
    data: { recurrence: null },
  });
  check("patch returns 200", patchRes.status() === 200, `status ${patchRes.status()}`);
  const patched = (await patchRes.json())?.data;
  check("patch reports the recurrence as cleared", patched?.recurrence === null, `got ${JSON.stringify(patched?.recurrence)}`);

  // The assertion that matters. Prisma reads a SQL NULL and a JSON literal null
  // both as JavaScript `null`, so the ORM cannot tell us which one is in the
  // column. Ask the database.
  const [raw] = await prisma.$queryRaw<Array<{ isSqlNull: boolean; jsonType: string | null }>>`
    SELECT
      "recurrence" IS NULL AS "isSqlNull",
      jsonb_typeof("recurrence"::jsonb)::text AS "jsonType"
    FROM "Reminder"
    WHERE id = ${reminderId}
  `;
  check("the column is genuinely SQL NULL, not the JSON literal null", raw?.isSqlNull === true, `isSqlNull=${raw?.isSqlNull} jsonType=${raw?.jsonType}`);

  // ---- a patch that does not mention the recurrence must not touch it -------
  const repeat = { freq: "DAILY" as const, interval: 3 };
  await api.patch(`${BASE}/api/v1/reminders/${reminderId}`, { data: { recurrence: repeat } });
  await api.patch(`${BASE}/api/v1/reminders/${reminderId}`, { data: { title: "Renamed only" } });
  const afterRename = await prisma.reminder.findUniqueOrThrow({
    where: { id: reminderId },
    select: { recurrence: true, title: true },
  });
  check("a title edit leaves the recurrence in place", (afterRename.recurrence as { interval?: number } | null)?.interval === 3, JSON.stringify(afterRename.recurrence));
  check("a title edit is actually applied", afterRename.title === "Renamed only");

  // ---- and it can be set back ---------------------------------------------
  await api.patch(`${BASE}/api/v1/reminders/${reminderId}`, { data: { recurrence: null } });
  const [rawAgain] = await prisma.$queryRaw<Array<{ isSqlNull: boolean }>>`
    SELECT "recurrence" IS NULL AS "isSqlNull" FROM "Reminder" WHERE id = ${reminderId}
  `;
  check("clearing a re-set recurrence works too", rawAgain?.isSqlNull === true, `isSqlNull=${rawAgain?.isSqlNull}`);

  await context.close();
} catch (error) {
  failures++;
  console.log(`FAIL unexpected error: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  if (reminderId) {
    await prisma.reminder.deleteMany({ where: { id: reminderId } });
  }
  await browser.close();
  await prisma.$disconnect();
}

console.log(failures === 0 ? "\nALL CLEAN" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

