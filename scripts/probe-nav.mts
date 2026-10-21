import { chromium, type Page } from "playwright";

/**
 * Can the navigation actually be reached at this viewport?
 *
 * `check-routes.mts` asserts that *something* fixed is present - a sidebar or a
 * bottom bar - which is not the same question. A sidebar can be in the DOM and
 * still be unreachable, and a hamburger can be present and open a drawer whose
 * links sit outside the visible area. This asks the question a person is asking
 * when they say the navigation cannot be reached: can I get to every section.
 */

const BASE = "http://localhost:3000";
const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe`;

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

const EXPECTED_SECTIONS = [
  "/dashboard",
  "/planner",
  "/tasks",
  "/focus",
  "/habits",
  "/wellbeing",
  "/journal",
  "/fitness",
  "/study",
  "/goals",
  "/projects",
  "/analytics",
  "/insights",
  "/ai",
  "/routines",
  "/calendar",
  "/notifications",
  "/settings",
];

async function setInput(page: Page, selector: string, value: string) {
  await page.waitForSelector(selector, { timeout: 15_000 });
  await page.fill(selector, "");
  await page.type(selector, value, { delay: 12 });
}

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` -> ${detail}` : ""}`);
  if (!ok) failures++;
}

const browser = await chromium.launch({ executablePath: CHROME });

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await setInput(page, 'input[type="email"]', "demo@lifeos.app");
  await setInput(page, 'input[type="password"]', "LIFEOSdemo2026");
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !window.location.pathname.includes("sign-in"), null, {
    timeout: 20_000,
  });

  for (const vp of VIEWPORTS) {
    console.log(`\n--- ${vp.name} ${vp.width}x${vp.height} ---`);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);

    // Which chrome is on screen right now?
    const chrome = (await page
      .locator('button[aria-label="Open menu"], button[aria-label="Close menu"]')
      .count()) as number;

    const sidebarVisible = await page.locator("aside").first().isVisible().catch(() => false);
    const bottomVisible = await page.locator('nav[aria-label="Primary"]').isVisible().catch(() => false);

    check("some navigation surface is visible", sidebarVisible || bottomVisible || chrome > 0,
      `sidebar=${sidebarVisible} bottom=${bottomVisible} hamburger=${chrome}`);

    // If there is no persistent sidebar, the drawer is the only way to the
    // sections, so it has to work.
    if (!sidebarVisible && chrome > 0) {
      await page.locator('button[aria-label="Open menu"]').first().click();
      const dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});

      const drawerOpen = await dialog.isVisible().catch(() => false);
      check("the menu opens", drawerOpen);
      if (!drawerOpen) continue;

      const found = await page
        .locator('[role="dialog"] a[href]')
        .evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return {
              href: (el as HTMLAnchorElement).getAttribute("href") ?? "",
              top: Math.round(r.top),
              left: Math.round(r.left),
              right: Math.round(r.right),
              width: Math.round(r.width),
              height: Math.round(r.height),
            };
          }),
        );
      const hrefs = new Set(found.map((f) => f.href.split("?")[0]));
      const missing = EXPECTED_SECTIONS.filter((s) => !hrefs.has(s));
      check("the drawer lists every section", missing.length === 0, `missing ${missing.join(", ")}`);

      // "Reachable" is the real question: on screen, and big enough to hit.
      const offscreen = found.filter(
        (f) => f.left < 0 || f.top < 0 || f.right > vp.width || f.height < 24,
      );
      check("every drawer link is on screen and tappable", offscreen.length === 0,
        offscreen.map((f) => `${f.href}@${f.left},${f.top} ${f.width}x${f.height}`).join("; "));

      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }

    if (sidebarVisible) {
      const hrefs = new Set(
        (await page.locator("aside a[href]").evaluateAll((els) =>
          els.map((el) => (el as HTMLAnchorElement).getAttribute("href") ?? ""),
        )).map((h) => h.split("?")[0]),
      );
      const missing = EXPECTED_SECTIONS.filter((s) => !hrefs.has(s));
      check("the sidebar lists every section", missing.length === 0, `missing ${missing.join(", ")}`);
    }

    if (bottomVisible) {
      const items = await page.locator('nav[aria-label="Primary"] a[href]').count();
      check("the bottom bar has items", items > 0, `${items} items`);
    }
  }

  await context.close();
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nALL CLEAN" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);