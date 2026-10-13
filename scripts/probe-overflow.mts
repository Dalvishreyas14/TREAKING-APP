/**
 * One-off diagnostic: find what makes a card wider than the viewport.
 *
 * Given a route, walks every element whose right edge passes the viewport at
 * 375px and reports the deepest ones plus the CSS that explains the width -
 * `white-space: nowrap` and a missing `min-width: 0` on a flex child are the two
 * causes that account for nearly all of this in practice, because a flex or grid
 * item defaults to `min-width: auto` and so refuses to shrink below its
 * content's intrinsic width.
 *
 * Run: npx tsx scripts/probe-overflow.mts /goals
 */

import { chromium, type Page } from "playwright";

const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe`;

const route = process.argv[2] ?? "/goals";
const width = Number(process.argv[3] ?? 375);

const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext({ viewport: { width, height: 900 } });
const page = await context.newPage();

async function setInput(p: Page, selector: string, value: string) {
  await p.evaluate(
    ([sel, val]) => {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      if (!el) throw new Error(`no input matched ${sel}`);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    [selector, value] as const,
  );
}

await page.goto("http://localhost:3000/sign-in", { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await setInput(page, 'input[type="email"]', "demo@lifeos.app");
await setInput(page, 'input[type="password"]', "LIFEOSdemo2026");
await page.click('button[type="submit"]');
await page
  .waitForFunction(() => !window.location.pathname.includes("sign-in"), null, { timeout: 20_000 })
  .catch(() => {});

await page.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// Reports the widest elements *inside* the first card, which is what actually
// sets the card's min-content width - the width of a grid/flex `auto` track is
// bounded below by its items' intrinsic minimum, and that is the number to find.
const report = (await page.evaluate(
  `(() => {
  const card = document.querySelector('[id^="goal-"], [id^="project-"]');
  if (!card) return { error: "no card found", rows: [] };
  const describe = (el) => {
    const cls = typeof el.className === "string" && el.className
      ? "." + el.className.trim().split(/\\s+/).slice(0, 3).join(".")
      : "";
    return el.tagName.toLowerCase() + cls;
  };
  const rows = [];
  const walk = (el, depth) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    rows.push({
      el: describe(el),
      depth,
      width: Math.round(r.width),
      scrollWidth: el.scrollWidth,
      minWidth: s.minWidth,
      whiteSpace: s.whiteSpace,
      display: s.display,
      text: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 34),
    });
    for (const c of Array.from(el.children)) walk(c, depth + 1);
  };
  walk(card, 0);
  return { cardWidth: Math.round(card.getBoundingClientRect().width), rows };
})()`,
)) as {
  cardWidth?: number;
  error?: string;
  rows: {
    el: string;
    depth: number;
    width: number;
    scrollWidth: number;
    minWidth: string;
    whiteSpace: string;
    display: string;
    text: string;
  }[];
};

if (report.error) {
  console.log(report.error);
} else {
  console.log(`route ${route} @ ${width}px — card border-box width ${report.cardWidth}\n`);
  // Deepest first: every stretched ancestor reports the same width, so the
  // element that actually forces the min-content is the leaf whose text cannot
  // wrap any further.
  const deepest = [...report.rows].sort((a, b) => b.depth - a.depth || b.width - a.width);
  for (const r of deepest.slice(0, 16)) {
    console.log(
      `d${String(r.depth).padStart(2)} w=${String(r.width).padStart(4)} sw=${String(r.scrollWidth).padStart(4)} min-w=${r.minWidth} ws=${r.whiteSpace} ${r.el}`,
    );
    console.log(`     ${JSON.stringify(r.text)}`);
  }
}

await browser.close();
