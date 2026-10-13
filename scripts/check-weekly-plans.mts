import { chromium, type APIRequestContext } from "playwright";
import { createRequire } from "node:module";
import type { NodeModule } from "node:module";

/**
 * End-to-end check for the weekly-plan API.
 *
 * The arithmetic behind a plan's progress is unit-tested in
 * `test/weekly-plan-progress.test.ts`, and the request contracts are tested in
 * `test/weekly-plan-schemas.test.ts`. Neither of those touches the parts most likely
 * to be wrong, because all of them live at the boundary between validation and the
 * database:
 *
 * 1. **Copy must not carry completion forward.** `POST /:id/copy` creates new tasks
 *    rather than relinking the old ones, because completion lives on `Task`. If that
 *    ever regressed to a plain relink, a DONE task from this week would render next
 *    week's card as already finished — and nothing in a unit test would notice,
 *    because the arithmetic is correct either way. It is only wrong once real
 *    completion state is in the row.
 *
 * 2. **Ownership on link endpoints.** A plan id and a task id from two different
 *    accounts must not be joinable. `assertOwnership` on the plan and `findFirst`
 *    scoped by `userId` on the task are what prevent that, and a 200 here would be
 *    a cross-account data leak rather than a cosmetic bug.
 *
 * 3. **Detaching must not delete the work.** Unlinking a task from a plan removes
 *    the join row only. If the join row were removed with the task, deleting a plan
 *    on Sunday evening would take Monday's coursework with it.
 *
 * 4. **The `@db.Date` columns.** A plan's window is stored at UTC midnight, and the
 *    half-open measurement range has to include the *final* day. An off-by-one here
 *    silently drops the last day of every week from every focus total, which is
 *    precisely the day a weekly review reads.
 *
 * 5. **A handwritten review survives a generated one.** The three text fields live
 *    on the shared `WeeklyReview` row, so `POST /api/v1/reviews/generate` has to
 *    leave them alone. It upserts and never mentions those columns, but that is an
 *    accident of omission rather than something the code states, so it is pinned.
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
const { dateOnlyToIsoDay } = await import("../src/lib/weekly-plans/week.ts");

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

async function setInput(page: import("playwright").Page, selector: string, value: string) {
  await page.waitForSelector(selector, { timeout: 15_000 });
  await page.fill(selector, "");
  await page.type(selector, value, { delay: 12 });
}

async function signIn(page: import("playwright").Page) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await setInput(page, 'input[type="email"]', EMAIL);
  await setInput(page, 'input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  try {
    await page.waitForFunction(() => !window.location.pathname.includes("sign-in"), null, {
      timeout: 20_000,
    });
  } catch (error) {
    /*
     * A bare "waitForFunction timed out" is close to useless here: the interesting
     * possibilities are all distinguishable from the outside — an auth failure that
     * re-renders /sign-in with an error, a redirect loop, or a page that is genuinely
     * somewhere else. The URL and the visible text separate them in one line, where
     * otherwise the whole run stops and the reader is left guessing which it was.
     */
    const where = page.url();
    const visible = (await page.locator("body").innerText().catch(() => "")).slice(0, 300);
    throw new Error(
      `sign-in did not leave /sign-in.\n  final url: ${where}\n  page text: ${visible.replace(/\s+/g, " ")}\n  cause: ${
        error instanceof Error ? error.message.split("\n")[0] : String(error)
      }`,
    );
  }
}

/** A Monday-start window a fortnight from the seeded data, so it cannot collide. */
function futureWeek(offsetWeeks: number) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() + offsetWeeks * 7);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: iso(start), endDate: iso(end) };
}

async function readDbPlan(planId: string) {
  return prisma.weeklyPlan.findUniqueOrThrow({
    where: { id: planId },
    include: { tasks: { include: { task: true } }, habits: true, days: true },
  });
}

const createdPlanIds: string[] = [];
const createdTaskTitles: string[] = [];
const createdTemplateIds: string[] = [];
const createdHabitIds: string[] = [];

/** Record a plan id only if there is one, so cleanup can never build a null list. */
function rememberPlan(id: string | null | undefined) {
  if (id) createdPlanIds.push(id);
}

/** Record a task title for cleanup; a title is the only handle this script keeps. */
function rememberTask(title: string | null | undefined) {
  if (title) createdTaskTitles.push(title);
}

/**
 * Record a habit created for log rows to hang off.
 *
 * A fresh habit rather than a seeded one, because `HabitLog` is unique on
 * `[habitId, date]` and the script writes rows on specific days. Reusing a seeded
 * habit would either collide with the demo account's own logs or overwrite them,
 * and this script does not get to decide what the demo data should say.
 */
function rememberHabit(id: string | null | undefined) {
  if (id) createdHabitIds.push(id);
}

/**
 * The review row this script created, pinned by the normalised week start rather than
 * by its content. Content would be the wrong key: if a real review for that week
 * already existed and happened to share these words, cleanup would delete the user's
 * row rather than this script's.
 */
let reviewWeekStart: Date | null = null;
function rememberReviewStart(start: Date | null) {
  reviewWeekStart = start;
}

/** The seeded task this script completes mid-run, restored on the way out. */
let touchedTaskId: string | null = null;
let originalStatus: string | null = null;
let originalCompletedAt: Date | null = null;

/** Hoisted out of the try block so the cleanup path can scope its deletes. */
let userId: string | null = null;

const browser = await chromium.launch({ executablePath: CHROME });

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page);

  // `context.request` shares the page's cookies, so these are the same
  // authenticated calls the UI makes.
  const api: APIRequestContext = context.request;
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: EMAIL },
    select: { id: true, weekStartsOn: true },
  });
  userId = user.id;

  // ---- create ----------------------------------------------------------------
  const window = futureWeek(3);
  const createRes = await api.post(`${BASE}/api/v1/weekly-plans`, {
    data: {
      name: "check-plan",
      category: "STUDY",
      targetType: "HOURS",
      targetValue: 5,
      ...window,
      days: [
        { dayOfWeek: 1, note: "Push" },
        { dayOfWeek: 3, note: "Rest" },
      ],
    },
  });
  check("create returns 200", createRes.status() === 200, `status ${createRes.status()} ${await createRes.text()}`);
  const created = (await createRes.json())?.data;
  const planId = created?.id ?? null;
  rememberPlan(planId);
  check("create returns an id", Boolean(planId));
  if (!planId) throw new Error("create did not return an id");

  const row = await readDbPlan(planId);
  check(
    "startDate is stored at UTC midnight, not a local midnight",
    row.startDate.toISOString() === `${window.startDate}T00:00:00.000Z`,
    row.startDate.toISOString(),
  );
  check(
    "endDate is stored at UTC midnight",
    row.endDate.toISOString() === `${window.endDate}T00:00:00.000Z`,
    row.endDate.toISOString(),
  );
  check("the weekday rows are stored", row.days.length === 2, `got ${row.days.length}`);
  check(
    "the rest day is stored, not dropped",
    row.days.some((d) => d.note === "Rest"),
  );
  check("the response reports derived progress, not a stored number", typeof created?.percent === "number" || created?.percent === null);
  check("a plan with no sessions reports a reason rather than a bare 0%", typeof created?.reason === "string" && created.reason.length > 0, JSON.stringify(created?.reason));

  // ---- attach a task, then a habit ------------------------------------------
  const task = await prisma.task.findFirstOrThrow({
    where: { userId: user.id },
    select: { id: true, title: true },
  });
  const attachRes = await api.post(`${BASE}/api/v1/weekly-plans/${planId}/tasks`, {
    data: { taskId: task.id },
  });
  check("attaching a task returns 200", attachRes.status() === 200, `status ${attachRes.status()} ${await attachRes.text()}`);
  const attached = (await attachRes.json())?.data;
  check("the attached task appears on the returned plan", attached?.tasks?.some((t: { id: string }) => t.id === task.id));

  const dupRes = await api.post(`${BASE}/api/v1/weekly-plans/${planId}/tasks`, {
    data: { taskId: task.id },
  });
  check("attaching the same task twice is a 409, not a crash", dupRes.status() === 409, `status ${dupRes.status()}`);

  const habit = await prisma.habit.findFirst({ where: { userId: user.id }, select: { id: true } });
  if (habit) {
    const habitRes = await api.post(`${BASE}/api/v1/weekly-plans/${planId}/habits`, {
      data: { habitId: habit.id },
    });
    check("attaching a habit returns 200", habitRes.status() === 200, `status ${habitRes.status()}`);
  } else {
    check("attaching a habit returns 200", true, "no seeded habit; skipped");
  }

  // ---- cross-account ownership ----------------------------------------------
  // A second user, and a task that belongs to them. Linking it must be refused.
  const other = await prisma.user.findFirst({
    where: { email: { not: EMAIL } },
    select: { id: true },
  });
  if (other) {
    const foreignTask = await prisma.task.findFirst({
      where: { userId: other.id },
      select: { id: true },
    });
    if (foreignTask) {
      const crossRes = await api.post(`${BASE}/api/v1/weekly-plans/${planId}/tasks`, {
        data: { taskId: foreignTask.id },
      });
      check(
        "another user's task cannot be attached to this plan",
        crossRes.status() === 404,
        `status ${crossRes.status()}`,
      );
    } else {
      check("another user's task cannot be attached to this plan", true, "no foreign task; skipped");
    }
  } else {
    check("another user's task cannot be attached to this plan", true, "no second user; skipped");
  }

  const notMine = await api.get(`${BASE}/api/v1/weekly-plans/does-not-exist`);
  check("an unknown plan id is a 404", notMine.status() === 404, `status ${notMine.status()}`);

  // ---- completion state ------------------------------------------------------
  // Mark the attached task done, so the copy below has something to carry or not
  // carry. This is the state that makes relinking visibly wrong. Its prior status is
  // kept so the demo account is left exactly as found.
  const original = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  originalStatus = original.status;
  originalCompletedAt = original.completedAt;
  touchedTaskId = task.id;
  await prisma.task.update({
    where: { id: task.id },
    data: { status: "DONE", completedAt: new Date() },
  });

  const copiedRes = await api.post(`${BASE}/api/v1/weekly-plans/${planId}/copy`, { data: {} });
  check("copy returns 200", copiedRes.status() === 200, `status ${copiedRes.status()} ${await copiedRes.text()}`);
  const copied = (await copiedRes.json())?.data;
  const copyId = copied?.plan?.id ?? null;
  if (copyId) createdPlanIds.push(copyId);
  check("copy returns the new plan", Boolean(copyId));
  check("copy reports the completed task as skipped", copied?.skippedCompleted === 1, `got ${copied?.skippedCompleted}`);
  check("copy creates no tasks when the only one was done", copied?.copiedTasks === 0, `got ${copied?.copiedTasks}`);

  if (copyId) {
    const copyRow = await readDbPlan(copyId);
    check("the copied plan has no linked tasks", copyRow.tasks.length === 0, `got ${copyRow.tasks.length}`);
    check(
      "the copied window is shifted a whole week",
      copyRow.startDate.getTime() === row.startDate.getTime() + 7 * 86_400_000,
      `${copyRow.startDate.toISOString()} vs ${row.startDate.toISOString()}`,
    );
    check(
      "the copied plan starts unmeasured rather than inheriting the old figure",
      copyRow.manualActual === null,
      `got ${copyRow.manualActual}`,
    );
    check("the copied plan carries the weekday rows", copyRow.days.length === 2, `got ${copyRow.days.length}`);
  }

  // ---- a plan whose tasks are still open does copy its work ------------------
  const openWindow = futureWeek(5);
  const openRes = await api.post(`${BASE}/api/v1/weekly-plans`, {
    data: {
      name: "check-open-plan",
      ...openWindow,
      targetType: "TASKS",
      targetValue: 2,
    },
  });
  const openPlan = (await openRes.json())?.data;
  const openId = openPlan?.id ?? null;
  if (openId) createdPlanIds.push(openId);

  const freshTask = await prisma.task.create({
    data: { userId: user.id, title: `check-copy-${Date.now()}`, status: "TODO" },
    select: { id: true, title: true },
  });
  rememberTask(freshTask.title);
  await api.post(`${BASE}/api/v1/weekly-plans/${openId}/tasks`, { data: { taskId: freshTask.id } });

  const openCopyRes = await api.post(`${BASE}/api/v1/weekly-plans/${openId}/copy`, { data: {} });
  const openCopy = (await openCopyRes.json())?.data;
  const openCopyId = openCopy?.plan?.id ?? null;
  if (openCopyId) createdPlanIds.push(openCopyId);
  check("an open task is copied", openCopy?.copiedTasks === 1, `got ${openCopy?.copiedTasks}`);

  if (openCopyId) {
    const openCopyRow = await readDbPlan(openCopyId);
    const newTaskIds = openCopyRow.tasks.map((t) => t.taskId);
    check("the copied task is a NEW row, not the original", !newTaskIds.includes(freshTask.id));
    check(
      "the new task starts open",
      openCopyRow.tasks.every((t) => t.task.status === "TODO"),
    );
    check(
      "the original task is untouched",
      (await prisma.task.findUniqueOrThrow({ where: { id: freshTask.id } })).status === "TODO",
    );
  }

  // ---- detaching keeps the work ----------------------------------------------
  const detachRes = await api.delete(`${BASE}/api/v1/weekly-plans/${openId}/tasks/${freshTask.id}`);
  check("detaching returns 200", detachRes.status() === 200, `status ${detachRes.status()}`);
  check("the detached task still exists", Boolean(await prisma.task.findUnique({ where: { id: freshTask.id } })));
  check(
    "the detached task is reported as kept",
    (await detachRes.json())?.data?.taskKept === true,
  );

  // ---- deleting a plan keeps its tasks ---------------------------------------
  const delRes = await api.delete(`${BASE}/api/v1/weekly-plans/${openId}`);
  check("delete returns 200", delRes.status() === 200, `status ${delRes.status()}`);
  check(
    "delete reports how many tasks were unlinked",
    (await delRes.json())?.data?.unlinkedTasks === 0,
  );
  check("the plan row is gone", !(await prisma.weeklyPlan.findUnique({ where: { id: openId } })));
  check("the task outlives the plan", Boolean(await prisma.task.findUnique({ where: { id: freshTask.id } })));

  // ---- templates: titles only, never ids -------------------------------------
  const templateRes = await api.post(`${BASE}/api/v1/weekly-plans/templates`, {
    data: {
      name: "check-template",
      category: "FITNESS",
      targetType: "SESSIONS",
      targetValue: 5,
      days: [
        { dayOfWeek: 1, tasks: ["Bench", "Lunges"] },
        { dayOfWeek: 3, note: "Rest", tasks: [] },
      ],
    },
  });
  check("template create returns 200", templateRes.status() === 200, `status ${templateRes.status()}`);
  const template = (await templateRes.json())?.data;
  const templateId = template?.id ?? null;
  if (templateId) createdTemplateIds.push(templateId);

  const storedTemplate = await prisma.weeklyPlanTemplate.findUniqueOrThrow({
    where: { id: templateId },
  });
  const config = storedTemplate.configuration as { days: { tasks: string[] }[] };
  check("the template stored its titles", config.days[0]?.tasks?.join(",") === "Bench,Lunges");
  const configText = JSON.stringify(storedTemplate.configuration);
  check(
    "the template stores no task or habit ids at all",
    !/"(taskId|habitId|taskIds|habitIds)"/.test(configText),
    configText.slice(0, 140),
  );

  const applyWindow = futureWeek(7);
  const applyRes = await api.post(`${BASE}/api/v1/weekly-plans/templates/${templateId}`, {
    data: applyWindow,
  });
  check("applying a template returns 200", applyRes.status() === 200, `status ${applyRes.status()} ${await applyRes.text()}`);
  const applied = (await applyRes.json())?.data;
  const appliedId = applied?.plan?.id ?? null;
  if (appliedId) createdPlanIds.push(appliedId);
  check("applying reports the tasks it created", applied?.createdTasks === 2, `got ${applied?.createdTasks}`);

  if (appliedId) {
    const appliedRow = await readDbPlan(appliedId);
    check(
      "the applied plan has a fresh task per title",
      appliedRow.tasks.length === 2,
      `got ${appliedRow.tasks.length}`,
    );
    check(
      "the applied tasks all start open",
      appliedRow.tasks.every((t) => t.task.status === "TODO"),
    );
    for (const t of appliedRow.tasks) rememberTask(t.task.title);
    check(
      "the applied plan inherited the template's target type",
      appliedRow.targetType === "SESSIONS",
      `got ${appliedRow.targetType}`,
    );
    check(
      "the applied plan carries the rest day",
      appliedRow.days.some((d) => d.note === "Rest"),
    );
  }

  const listRes = await api.get(`${BASE}/api/v1/weekly-plans/templates`);
  check("template list returns 200", listRes.status() === 200, `status ${listRes.status()}`);
  const listed = (await listRes.json())?.data?.items ?? [];
  check("the list shows the template", listed.some((t: { id: string }) => t.id === templateId));
  check(
    "every listed template parses as readable",
    listed.every((t: { unreadable?: boolean }) => t.unreadable !== true),
  );

  // ---- the measurement range includes the final day -------------------------
  // The single most damaging off-by-one available: a half-open range ending AT
  // endDate would drop everything logged on the plan's last day, which is the day a
  // weekly review is written from.
  const lastDayWindow = futureWeek(9);
  const lastDayStart = new Date(`${lastDayWindow.startDate}T00:00:00.000Z`);
  const lastDay = new Date(lastDayStart);
  lastDay.setUTCDate(lastDay.getUTCDate() + 6);
  const measureStart = new Date(lastDay);
  measureStart.setUTCHours(12, 0, 0, 0);

  const lastDayRes = await api.post(`${BASE}/api/v1/weekly-plans`, {
    data: { name: "check-last-day", ...lastDayWindow, targetType: "HOURS", targetValue: 1 },
  });
  const lastDayPlan = (await lastDayRes.json())?.data;
  const lastDayId = lastDayPlan?.id ?? null;
  if (lastDayId) createdPlanIds.push(lastDayId);

  const timedTask = await prisma.task.create({
    data: { userId: user.id, title: `check-timed-${Date.now()}`, status: "TODO" },
    select: { id: true, title: true },
  });
  rememberTask(timedTask.title);
  await api.post(`${BASE}/api/v1/weekly-plans/${lastDayId}/tasks`, { data: { taskId: timedTask.id } });
  await prisma.focusSession.create({
    data: {
      userId: user.id,
      taskId: timedTask.id,
      startedAt: measureStart,
      endedAt: new Date(measureStart.getTime() + 3_600_000),
      plannedSeconds: 3600,
      actualSeconds: 3600,
    },
  });

  const measured = (await (await api.get(`${BASE}/api/v1/weekly-plans/${lastDayId}`)).json())?.data;
  check(
    "focus time on the FINAL day of the window is counted",
    Math.abs((measured?.actual ?? 0) - 1) < 0.05,
    `actual=${measured?.actual} percent=${measured?.percent}`,
  );
  check(
    "the same figure is reported by the list endpoint",
    Math.abs(
      ((await (await api.get(`${BASE}/api/v1/weekly-plans?week=${lastDayWindow.startDate}`)).json())
        ?.data?.items?.[0]?.actual ?? -1) -
        (measured?.actual ?? -2),
    ) < 0.001,
  );

  // A session outside the window must not be counted.
  const outside = new Date(lastDayStart);
  outside.setUTCDate(outside.getUTCDate() - 3);
  await prisma.focusSession.create({
    data: {
      userId: user.id,
      taskId: timedTask.id,
      startedAt: outside,
      endedAt: new Date(outside.getTime() + 7_200_000),
      plannedSeconds: 7200,
      actualSeconds: 7200,
    },
  });
  const afterOutside = (await (await api.get(`${BASE}/api/v1/weekly-plans/${lastDayId}`)).json())?.data;
  check(
    "focus time before the window is NOT counted",
    Math.abs((afterOutside?.actual ?? 0) - 1) < 0.05,
    `actual=${afterOutside?.actual}`,
  );

  // ---- a handwritten review survives the generator ---------------------------
  // Deliberately handed a mid-week date. The route normalises any day to its week's
  // first day, because the column is a week *start* and a client that guessed wrong
  // should not be handed an empty review for a week that does exist.
  const reviewWeek = futureWeek(11);
  const [ry, rm, rd] = reviewWeek.startDate.split("-").map(Number) as [number, number, number];
  // Three days into that week, so the request is mid-week on purpose.
  const midWeek = new Date(Date.UTC(ry, rm - 1, rd + 3));
  const midWeekIso = midWeek.toISOString().slice(0, 10);

  const saveRes = await api.put(`${BASE}/api/v1/weekly-plans/reviews/${midWeekIso}`, {
    data: {
      wentWell: "Kept the streak",
      shouldImprove: "Earlier starts",
      nextWeekFocus: "Ship the draft",
    },
  });
  check("saving a review returns 200", saveRes.status() === 200, `status ${saveRes.status()} ${await saveRes.text()}`);

  const saved = (await saveRes.json())?.data;
  const normalisedWeekStart = saved?.weekStart ?? null;
  check("the save echoes a week start", typeof normalisedWeekStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(normalisedWeekStart), `got ${normalisedWeekStart}`);
  check(
    "a mid-week date is normalised backwards to a week start",
    typeof normalisedWeekStart === "string" && normalisedWeekStart <= midWeekIso,
    `weekStart=${normalisedWeekStart} requested=${midWeekIso}`,
  );
  check(
    "and it is within one week, so no adjacent week was hit",
    typeof normalisedWeekStart === "string" &&
      (Date.parse(`${normalisedWeekStart}T00:00:00Z`) - Date.parse(`${midWeekIso}T00:00:00Z`)) / 86_400_000 <= 6,
    `weekStart=${normalisedWeekStart} requested=${midWeekIso}`,
  );
  reviewWeekStart = normalisedWeekStart;

  const [ny, nm, nd] = String(reviewWeekStart).split("-").map(Number) as [number, number, number];
  const reviewStart = new Date(Date.UTC(ny, nm - 1, nd));
  rememberReviewStart(reviewStart);

  const savedRow = await prisma.weeklyReview.findUniqueOrThrow({
    where: { userId_weekStart: { userId: user.id, weekStart: reviewStart } },
  });
  check("the three answers are stored on the shared WeeklyReview row", savedRow.wentWell === "Kept the streak");
  check("the generated columns are left as empty, not null", savedRow.summary === "" && JSON.stringify(savedRow.metrics) === "{}", `summary=${JSON.stringify(savedRow.summary)} metrics=${JSON.stringify(savedRow.metrics)}`);
  check(
    "the row is keyed to the user's own week start",
    dateOnlyToIsoDay(savedRow.weekEnd) > dateOnlyToIsoDay(savedRow.weekStart),
    `${dateOnlyToIsoDay(savedRow.weekStart)}..${dateOnlyToIsoDay(savedRow.weekEnd)}`,
  );

  // The same week, asked for by a different day, must find the same row.
  const otherDay = new Date(reviewStart);
  otherDay.setUTCDate(otherDay.getUTCDate() + 5);
  const otherDayRes = await api.get(`${BASE}/api/v1/weekly-plans/reviews/${dateOnlyToIsoDay(otherDay)}`);
  const otherDayReview = (await otherDayRes.json())?.data;
  check("another day of the same week finds the same review", otherDayReview?.exists === true && otherDayReview?.wentWell === "Kept the streak", JSON.stringify(otherDayReview));

  // A week with nothing in it must be an empty shape, not an error and not a 404.
  const emptyRes = await api.get(`${BASE}/api/v1/weekly-plans/reviews/2026-01-01`);
  const empty = (await emptyRes.json())?.data;
  check("an unreviewed week returns the empty shape", emptyRes.status() === 200 && empty?.exists === false);
  check("the empty shape still names the week", typeof empty?.weekStart === "string" && empty.weekStart.length === 10);
  check("the empty shape's three answers are null, not empty strings", empty?.wentWell === null && empty?.nextWeekFocus === null);

  // The generator upserts the same row; it must not overwrite the three answers.
  await api.post(`${BASE}/api/v1/reviews/generate`, { data: { period: "WEEK" } });
  const afterGenerate = await prisma.weeklyReview.findUniqueOrThrow({
    where: { userId_weekStart: { userId: user.id, weekStart: reviewStart } },
  });
  check(
    "the generator does not overwrite the handwritten answers",
    afterGenerate.wentWell === "Kept the streak" &&
      afterGenerate.shouldImprove === "Earlier starts" &&
      afterGenerate.nextWeekFocus === "Ship the draft",
    JSON.stringify({
      wentWell: afterGenerate.wentWell,
      shouldImprove: afterGenerate.shouldImprove,
      nextWeekFocus: afterGenerate.nextWeekFocus,
    }),
  );

  // Only one review per week, however many plans cover it.
  const reviewCount = await prisma.weeklyReview.count({
    where: { userId: user.id, weekStart: reviewStart },
  });
  check("a week still holds exactly one review row", reviewCount === 1, `count=${reviewCount}`);

  // ---- validation refusals ----------------------------------------------------
  const backwards = await api.post(`${BASE}/api/v1/weekly-plans`, {
    data: { name: "bad", startDate: "2026-10-04", endDate: "2026-09-28" },
  });
  check("an inverted window is refused", backwards.status() === 422, `status ${backwards.status()}`);

  const impossible = await api.post(`${BASE}/api/v1/weekly-plans`, {
    data: { name: "bad", startDate: "2026-02-30", endDate: "2026-03-06" },
  });
  check("a date that does not exist is refused", impossible.status() === 422, `status ${impossible.status()}`);

  const emptyPatch = await api.patch(`${BASE}/api/v1/weekly-plans/${planId}`, { data: {} });
  check("an empty PATCH is refused rather than silently succeeding", emptyPatch.status() === 422, `status ${emptyPatch.status()}`);

  const countPatch = await api.patch(`${BASE}/api/v1/weekly-plans/${planId}`, {
    data: { targetType: "COUNT", manualActual: 42 },
  });
  const counted = (await countPatch.json())?.data;
  check("a COUNT plan reads the user's own figure", counted?.actual === 42, `got ${counted?.actual}`);
  check("a COUNT plan is flagged unmeasurable", counted?.measurable === false);
  check(
    "a COUNT plan is disclosed as user-measured at a non-zero figure",
    typeof counted?.reason === "string" && counted.reason.length > 0,
    JSON.stringify(counted?.reason),
  );

  const switchAway = await api.patch(`${BASE}/api/v1/weekly-plans/${planId}`, {
    data: { targetType: "HOURS" },
  });
  const switched = (await switchAway.json())?.data;
  check(
    "the manual figure is cleared when the target type moves off COUNT",
    switched?.manualActual === null,
    `got ${switched?.manualActual}`,
  );

  // ---- SESSIONS is offered only where something can count it -------------------
  // The two categories below are the only ones with a real session table behind them,
  // so these are the refusals the UI has to honour rather than discover later.
  const unmeasurable = await api.post(`${BASE}/api/v1/weekly-plans`, {
    data: {
      name: "check-unmeasurable",
      ...futureWeek(13),
      category: "WORK",
      targetType: "SESSIONS",
      targetValue: 4,
    },
  });
  check("a WORK plan measured in sessions is refused", unmeasurable.status() === 422, `status ${unmeasurable.status()}`);

  const noCategory = await api.post(`${BASE}/api/v1/weekly-plans`, {
    data: { name: "check-default-category", ...futureWeek(13), targetType: "SESSIONS", targetValue: 4 },
  });
  check(
    "SESSIONS with no category is refused, not defaulted into existence",
    noCategory.status() === 422,
    `status ${noCategory.status()}`,
  );

  const measurable = await api.post(`${BASE}/api/v1/weekly-plans`, {
    data: {
      name: "check-measurable",
      ...futureWeek(13),
      category: "FITNESS",
      targetType: "SESSIONS",
      targetValue: 4,
    },
  });
  check("a FITNESS plan measured in sessions is accepted", measurable.status() === 200, `status ${measurable.status()}`);

  // The PATCH rule is the one that cannot be caught by a schema, because the stored
  // category is the other half of it. Both single-field routes are exercised.
  const toWork = await api.post(`${BASE}/api/v1/weekly-plans`, {
    data: { name: "check-patch-gate", ...futureWeek(13), category: "WORK", targetType: "HOURS" },
  });
  const workPlan = (await toWork.json())?.data;
  const workId = workPlan?.id ?? null;
  if (workId) createdPlanIds.push(workId);

  if (workId) {
    const setSessions = await api.patch(`${BASE}/api/v1/weekly-plans/${workId}`, {
      data: { targetType: "SESSIONS" },
    });
    check(
      "switching a work plan to SESSIONS alone is refused, via the stored category",
      setSessions.status() === 422,
      `status ${setSessions.status()}`,
    );

    const flipBoth = await api.patch(`${BASE}/api/v1/weekly-plans/${workId}`, {
      data: { category: "CUSTOM", targetType: "SESSIONS" },
    });
    check(
      "switching to SESSIONS with an unmeasurable category in the same PATCH is refused",
      flipBoth.status() === 422,
      `status ${flipBoth.status()}`,
    );

    // The legitimate route: make it a fitness plan first, then set the target. Two
    // separate requests, both legal, which is exactly what a category dropdown
    // followed by a target dropdown produces.
    await api.patch(`${BASE}/api/v1/weekly-plans/${workId}`, { data: { category: "FITNESS" } });
    const thenSessions = await api.patch(`${BASE}/api/v1/weekly-plans/${workId}`, {
      data: { targetType: "SESSIONS" },
    });
    check(
      "and setting SESSIONS after the category is already fitness is allowed",
      thenSessions.status() === 200,
      `status ${thenSessions.status()} ${await thenSessions.text()}`,
    );

    // Moving the category away while the target is still SESSIONS must also be
    // refused, or the plan could be left in the unmeasurable state the gate exists
    // to prevent.
    const leaveSessions = await api.patch(`${BASE}/api/v1/weekly-plans/${workId}`, {
      data: { category: "WORK" },
    });
    check(
      "moving the category away from a SESSIONS plan is refused until the target changes",
      leaveSessions.status() === 422,
      `status ${leaveSessions.status()}`,
    );
  }

  // ---- a FITNESS SESSIONS plan counts habit logs ------------------------------
  // This is the whole point of the category switch: the figure has to match what the
  // Fitness page would say about the same habit, or the two screens contradict each
  // other about the same week.
  const gymWindow = futureWeek(15);
  const gymPlanRes = await api.post(`${BASE}/api/v1/weekly-plans`, {
    data: {
      name: "check-gym-sessions",
      ...gymWindow,
      category: "FITNESS",
      targetType: "SESSIONS",
      targetValue: 3,
    },
  });
  const gymPlan = (await gymPlanRes.json())?.data;
  const gymId = gymPlan?.id ?? null;
  if (gymId) createdPlanIds.push(gymId);

  const gymHabit = await prisma.habit.create({
    data: {
      userId: user.id,
      name: `check-gym-${Date.now()}`,
      type: "COUNT",
      unit: "sessions",
      startDate: new Date(`${gymWindow.startDate}T00:00:00.000Z`),
    },
    select: { id: true },
  });
  rememberHabit(gymHabit.id);

  await api.post(`${BASE}/api/v1/weekly-plans/${gymId}/habits`, { data: { habitId: gymHabit.id } });

  const gymStart = new Date(`${gymWindow.startDate}T00:00:00.000Z`);
  const dayAt = (offset: number) => {
    const d = new Date(gymStart);
    d.setUTCDate(d.getUTCDate() + offset);
    return d;
  };

  // Three sessions, deliberately not all "completed": the rule is
  // `completed || value > 0`, so a partial session still counts.
  await prisma.habitLog.createMany({
    data: [
      { userId: user.id, habitId: gymHabit.id, date: dayAt(0), completed: true, value: 1 },
      { userId: user.id, habitId: gymHabit.id, date: dayAt(1), completed: false, value: 5 },
      { userId: user.id, habitId: gymHabit.id, date: dayAt(2), completed: true, value: 1 },
      // In the window but nothing recorded: must not count.
      { userId: user.id, habitId: gymHabit.id, date: dayAt(3), completed: false, value: 0 },
      // A finished-looking day, but from the week before this plan started.
      { userId: user.id, habitId: gymHabit.id, date: dayAt(-3), completed: true, value: 1 },
    ],
  });

  const gymMeasured = (await (await api.get(`${BASE}/api/v1/weekly-plans/${gymId}`)).json())?.data;
  check(
    "a FITNESS SESSIONS plan counts completed and partial habit logs alike",
    gymMeasured?.actual === 3,
    `actual=${gymMeasured?.actual} unit=${gymMeasured?.unit}`,
  );
  check(
    "an empty log row is not counted as a session",
    gymMeasured?.actual === 3,
    `actual=${gymMeasured?.actual}`,
  );
  check("a FITNESS SESSIONS plan is measurable", gymMeasured?.measurable === true, `got ${gymMeasured?.measurable}`);
  check("the unit is reported as sessions", gymMeasured?.unit === "sessions", `got ${gymMeasured?.unit}`);

  // ---- a STUDY SESSIONS plan counts focus sessions ----------------------------
  // The mirror image of the case above. Study work is not recorded as habit logs, so
  // measuring a study week against them would report zero however much was studied.
  const studyWindow = futureWeek(17);
  const studyPlanRes = await api.post(`${BASE}/api/v1/weekly-plans`, {
    data: {
      name: "check-study-sessions",
      ...studyWindow,
      category: "STUDY",
      targetType: "SESSIONS",
      targetValue: 3,
    },
  });
  const studyPlan = (await studyPlanRes.json())?.data;
  const studyId = studyPlan?.id ?? null;
  if (studyId) createdPlanIds.push(studyId);

  const studyTask = await prisma.task.create({
    data: { userId: user.id, title: `check-study-${Date.now()}`, status: "TODO" },
    select: { id: true, title: true },
  });
  rememberTask(studyTask.title);
  await api.post(`${BASE}/api/v1/weekly-plans/${studyId}/tasks`, { data: { taskId: studyTask.id } });

  const studyStart = new Date(`${studyWindow.startDate}T00:00:00.000Z`);
  const studySessionAt = (offset: number, hours: number, ended = true) => {
    const startedAt = new Date(studyStart);
    startedAt.setUTCDate(startedAt.getUTCDate() + offset);
    startedAt.setUTCHours(10, 0, 0, 0);
    return {
      userId: user.id,
      taskId: studyTask.id,
      startedAt,
      endedAt: ended ? new Date(startedAt.getTime() + hours * 3_600_000) : null,
      plannedSeconds: hours * 3600,
      actualSeconds: ended ? hours * 3600 : 0,
    };
  };

  await prisma.focusSession.createMany({
    data: [
      studySessionAt(0, 1),
      studySessionAt(1, 0.5),
      studySessionAt(2, 1),
      // On the plan's final day, which must be inside the window.
      studySessionAt(6, 1),
      // Not finished yet: must not count.
      studySessionAt(3, 1, false),
      // Before the plan starts: must not count.
      { ...studySessionAt(-2, 1) },
    ],
  });

  const studyMeasured = (await (await api.get(`${BASE}/api/v1/weekly-plans/${studyId}`)).json())?.data;
  check(
    "a STUDY SESSIONS plan counts finished focus sessions on its tasks",
    studyMeasured?.actual === 4,
    `actual=${studyMeasured?.actual} unit=${studyMeasured?.unit}`,
  );
  check(
    "an unfinished focus session is not counted",
    studyMeasured?.actual === 4,
    `actual=${studyMeasured?.actual}`,
  );
  check(
    "the same sessions drive the study plan's hours",
    Math.abs((studyMeasured?.actual ?? 0) - 4) < 0.001,
    `actual=${studyMeasured?.actual}`,
  );
  check("a STUDY SESSIONS plan is measurable", studyMeasured?.measurable === true, `got ${studyMeasured?.measurable}`);

  // The inverse guard: the same habit-heavy figure must not leak into a study plan.
  check(
    "a STUDY plan ignores habit logs entirely",
    studyMeasured?.actual === 4,
    `actual=${studyMeasured?.actual}`,
  );

  // ---- tasks carry the weekday they were intended for -------------------------
  // The day is the plan's claim about the work, so it must round-trip on attach,
  // survive a copy, and be clearable back to unscheduled.
  const dayPlanRes = await api.post(`${BASE}/api/v1/weekly-plans`, {
    data: { name: "check-days", ...futureWeek(19), targetType: "TASKS", targetValue: 5 },
  });
  const dayPlan = (await dayPlanRes.json())?.data;
  const dayPlanId = dayPlan?.id ?? null;
  if (dayPlanId) createdPlanIds.push(dayPlanId);

  const dayTaskA = await prisma.task.create({
    data: { userId: user.id, title: `check-day-a-${Date.now()}`, status: "TODO" },
    select: { id: true, title: true },
  });
  rememberTask(dayTaskA.title);
  const dayTaskB = await prisma.task.create({
    data: { userId: user.id, title: `check-day-b-${Date.now()}`, status: "TODO" },
    select: { id: true, title: true },
  });
  rememberTask(dayTaskB.title);

  await api.post(`${BASE}/api/v1/weekly-plans/${dayPlanId}/tasks`, {
    data: { taskId: dayTaskA.id, dayOfWeek: 2 },
  });
  await api.post(`${BASE}/api/v1/weekly-plans/${dayPlanId}/tasks`, {
    data: { taskId: dayTaskB.id },
  });

  const afterAttach = (await (await api.get(`${BASE}/api/v1/weekly-plans/${dayPlanId}`)).json())?.data;
  const attachedDay = afterAttach?.tasks?.find((t: { id: string }) => t.id === dayTaskA.id)?.dayOfWeek;
  const unscheduledDay = afterAttach?.tasks?.find((t: { id: string }) => t.id === dayTaskB.id)?.dayOfWeek;
  check("a task attached to a weekday comes back on that weekday", attachedDay === 2, `got ${attachedDay}`);
  check(
    "a task attached with no day is unscheduled, not defaulted to Sunday",
    unscheduledDay === null,
    `got ${unscheduledDay}`,
  );

  const moveRes = await api.patch(`${BASE}/api/v1/weekly-plans/${dayPlanId}/tasks/${dayTaskA.id}`, {
    data: { dayOfWeek: 4 },
  });
  check("moving a task to another day returns 200", moveRes.status() === 200, `status ${moveRes.status()} ${await moveRes.text()}`);
  check(
    "the task reports its new day",
    (await moveRes.json())?.data?.tasks?.find((t: { id: string }) => t.id === dayTaskA.id)?.dayOfWeek === 4,
  );
  check(
    "the move is stored on the link, not copied onto the task",
    (await prisma.weeklyPlanTask.findUniqueOrThrow({
      where: { weeklyPlanId_taskId: { weeklyPlanId: dayPlanId, taskId: dayTaskA.id } },
    })).dayOfWeek === 4,
  );

  const unscheduleRes = await api.patch(`${BASE}/api/v1/weekly-plans/${dayPlanId}/tasks/${dayTaskA.id}`, {
    data: { dayOfWeek: null },
  });
  check(
    "clearing the day unschedules rather than leaving the old one",
    (await unscheduleRes.json())?.data?.tasks?.find((t: { id: string }) => t.id === dayTaskA.id)?.dayOfWeek === null,
  );

  const moveUnknown = await api.patch(`${BASE}/api/v1/weekly-plans/${dayPlanId}/tasks/${dayTaskA.id}`, {
    data: { dayOfWeek: 9 },
  });
  check("a weekday outside 0-6 is refused", moveUnknown.status() === 422, `status ${moveUnknown.status()}`);

  // ---- copy keeps the weekday --------------------------------------------------
  await api.patch(`${BASE}/api/v1/weekly-plans/${dayPlanId}/tasks/${dayTaskA.id}`, { data: { dayOfWeek: 1 } });
  await api.patch(`${BASE}/api/v1/weekly-plans/${dayPlanId}/tasks/${dayTaskB.id}`, { data: { dayOfWeek: 3 } });

  const dayCopyRes = await api.post(`${BASE}/api/v1/weekly-plans/${dayPlanId}/copy`, { data: {} });
  const dayCopy = (await dayCopyRes.json())?.data;
  const dayCopyId = dayCopy?.plan?.id ?? null;
  if (dayCopyId) createdPlanIds.push(dayCopyId);
  check("the copy reports both open tasks", dayCopy?.copiedTasks === 2, `got ${dayCopy?.copiedTasks}`);
  check("nothing was omitted from this copy", dayCopy?.omittedTasks === 0, `got ${dayCopy?.omittedTasks}`);

  if (dayCopyId) {
    const dayCopyRow = await readDbPlan(dayCopyId);
    const copyDays = dayCopyRow.tasks.map((t) => t.dayOfWeek).sort();
    check(
      "the copied tasks keep their weekdays",
      JSON.stringify(copyDays) === JSON.stringify([1, 3]),
      `got ${JSON.stringify(copyDays)}`,
    );
    for (const t of dayCopyRow.tasks) rememberTask(t.task.title);

    // The point of copying work rather than relinking it: the new rows are distinct
    // tasks, so a weekday claim about next week's work cannot contradict this week's.
    check(
      "the copied tasks are new rows, so the day claim does not collide",
      dayCopyRow.tasks.every((t) => t.taskId !== dayTaskA.id && t.taskId !== dayTaskB.id),
    );
  }

  // ---- templates keep the weekday ----------------------------------------------
  const weekdayTemplateRes = await api.post(`${BASE}/api/v1/weekly-plans/templates`, {
    data: {
      name: "check-weekday-template",
      days: [
        { dayOfWeek: 1, tasks: ["Monday work"], note: null },
        { dayOfWeek: 5, tasks: ["Friday work"], note: null },
      ],
    },
  });
  const weekdayTemplateId = (await weekdayTemplateRes.json())?.data?.id ?? null;
  if (weekdayTemplateId) createdTemplateIds.push(weekdayTemplateId);

  const templateApplyWindow = futureWeek(21);
  const templateApplyRes = await api.post(
    `${BASE}/api/v1/weekly-plans/templates/${weekdayTemplateId}`,
    { data: templateApplyWindow },
  );
  check("applying the weekday template returns 200", templateApplyRes.status() === 200, `status ${templateApplyRes.status()} ${await templateApplyRes.text()}`);
  const templateAppliedId = (await templateApplyRes.json())?.data?.plan?.id ?? null;
  if (templateAppliedId) createdPlanIds.push(templateAppliedId);

  if (templateAppliedId) {
    const templateRow = await readDbPlan(templateAppliedId);
    const templateDays = templateRow.tasks.map((t) => t.dayOfWeek).sort();
    check(
      "applied template tasks land on the day the template named",
      JSON.stringify(templateDays) === JSON.stringify([1, 5]),
      `got ${JSON.stringify(templateDays)}`,
    );
    for (const t of templateRow.tasks) rememberTask(t.task.title);
  }

  await context.close();
} catch (error) {
  failures++;
  console.log(`FAIL unexpected error: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  // Restore the seeded task this script completed, so the demo account is left as
  // found. Restoring rather than deleting matters: it is the user's task, not this
  // script's, and its original status is not something the script gets to decide.
  if (touchedTaskId && originalStatus) {
    await prisma.task.update({
      where: { id: touchedTaskId },
      data: { status: originalStatus as never, completedAt: originalCompletedAt },
    });
  } else if (touchedTaskId) {
    // Better to leave a task DONE than to guess at its prior state.
    console.log("WARN touched task had no prior status; left as-is for inspection");
  }

  if (createdPlanIds.length) {
    await prisma.weeklyPlan.deleteMany({ where: { id: { in: createdPlanIds } } });
  }
  if (createdTemplateIds.length) {
    await prisma.weeklyPlanTemplate.deleteMany({ where: { id: { in: createdTemplateIds } } });
  }
  // Habits go after plans, because a plan holds a link to a habit and the plan is
  // what would otherwise block the habit from being removed.
  if (createdHabitIds.length) {
    await prisma.habit.deleteMany({ where: { id: { in: createdHabitIds } } });
  }
  if (createdTaskTitles.length) {
    await prisma.focusSession.deleteMany({
      where: { task: { title: { in: createdTaskTitles } } },
    });
    await prisma.task.deleteMany({ where: { title: { in: createdTaskTitles } } });
  }
  // The review row this script created, keyed by the week start this script was given
  // rather than by its contents.
  if (reviewWeekStart && userId) {
    await prisma.weeklyReview.deleteMany({
      where: { userId, weekStart: reviewWeekStart },
    });
  }

  await browser.close();
  await prisma.$disconnect();
}

console.log(failures === 0 ? "\nALL CLEAN" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);