import { chromium, type Page } from "playwright";

const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe`;

/**
 * Every page in the `(app)` group, so the responsive audit covers the whole app
 * rather than whatever happened to be passed on the command line. This is a
 * default, not a restriction: named routes still work, and are audited at every
 * width like the rest.
 */
const ALL_ROUTES = [
  "/dashboard",
  "/planner",
  "/tasks",
  "/focus",
  "/habits",
  "/wellbeing",
  "/journal",
  "/fitness",
  "/study",
  "/knowledge",
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

const routes = process.argv.slice(2);
const targets = routes.length > 0 ? routes : ALL_ROUTES;

/**
 * The three widths that matter, and why each one is here rather than a round
 * number:
 *
 *  375 is the narrowest phone still in real use (an iPhone SE / mini class). A
 *  layout that survives 375 survives every larger phone, and it is the only width
 *  where the bottom nav exists and the sidebar does not.
 *
 *  768 is the awkward one. It is the iPad portrait width and the breakpoint
 *  where a sidebar-based layout usually starts failing - the sidebar is either
 *  eating half the content column or has to be hidden, and the app switches at
 *  `lg` (1024) rather than `md`, so 768 is deliberately *still* on the mobile
 *  layout. That is a decision worth re-checking on every run rather than
 *  assuming.
 *
 *  1440 is the design width, so anything broken here is broken everywhere.
 */
const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

/**
 * Slack for the overflow comparison, in CSS pixels.
 *
 * Not zero. A 375px viewport in a browser that reserves space for a scrollbar
 * reports an `innerWidth` a pixel or two under the nominal size, and sub-pixel
 * layout on fractional DPRs produces the same. Rounding that to a hard zero
 * would make this check fail on its own rounding and train us to ignore it.
 */
const OVERFLOW_SLACK = 2;

const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const errors: string[] = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`[console] ${m.text().slice(0, 220)}`);
});
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message.slice(0, 220)}`));
page.on("response", async (r) => {
  if (!r.url().includes("/api/auth/callback/credentials")) return;
  if (r.status() === 200) return;
  console.log(`  sign-in rejected: ${r.status()} ${(await r.text().catch(() => "")).slice(0, 200)}`);
});

// `fill()` sets the DOM value directly, which does not update React state for a
// controlled input in this React version, so the form signed in with empty
// credentials. Typing real keys works but drops characters often enough to make
// the check flaky. Assigning through React's own value setter and then firing a
// bubbling `input` event is what React listens for, so it is both exact and
// deterministic.
async function setInput(page: Page, selector: string, value: string) {
  await page.evaluate(
    ([sel, val]) => {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      if (!el) throw new Error(`no input matched ${sel}`);
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    [selector, value] as const,
  );
}

/**
 * Signs in and refuses to report success unless the app really did it.
 *
 * The trap this exists to survive: submitting before React hydrates runs the
 * browser's *native* form submission instead of the app's handler, which
 * navigates and leaves you looking at a page that never authenticated. That is
 * only detectable by confirming the credentials endpoint was actually called,
 * so success is defined as "we are off /sign-in AND the endpoint was hit".
 */
async function signIn(page: Page) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    let calledEndpoint = false;
    const mark = (r: { url(): string }) => {
      if (r.url().includes("/api/auth/callback/credentials")) calledEndpoint = true;
    };
    page.on("request", mark);

    await page.goto("http://localhost:3000/sign-in", { waitUntil: "networkidle" });
    // Give hydration a chance to attach the submit handler before clicking.
    await page.waitForTimeout(500);
    await setInput(page, 'input[type="email"]', "demo@lifeos.app");
    await setInput(page, 'input[type="password"]', "LIFEOSdemo2026");
    await page.click('button[type="submit"]');

    // `signIn(..., { redirect: false })` then `router.push` is a client-side
    // navigation, so no load event fires and `page.waitForURL` never settles.
    await page
      .waitForFunction(() => !window.location.pathname.includes("sign-in"), null, {
        timeout: 20_000,
      })
      .catch(() => {});

    page.off("request", mark);

    const url = new URL(page.url());
    if (url.searchParams.has("email") || url.searchParams.has("password")) {
      throw new Error(
        `sign-in fell back to a native GET, leaking credentials into ${url.pathname}${url.search}`,
      );
    }
    if (calledEndpoint && !url.pathname.includes("sign-in")) return;
    console.log(`  sign-in attempt ${attempt} did not take; retrying`);
  }
  throw new Error("could not sign in after 4 attempts");
}

/**
 * Reports what is sticking out past the right edge of the viewport, if anything.
 *
 * The naive version of this check is `scrollWidth > clientWidth`, which is right
 * about being broken and useless about *where*. A horizontal scrollbar on a phone
 * is one of the most common responsive bugs and also one of the hardest to spot
 * by eye, so this names the offending elements and how far past the edge they
 * reach, which is the difference between a report and a shrug.
 *
 * Elements inside a horizontally scrollable ancestor are not reported. A table or
 * a chip row inside `overflow-x: auto` is *supposed* to be wider than the
 * screen - that container is the feature. What matters is whether the *page*
 * scrolls sideways, which is what `pageOverflows` separately answers.
 *
 * The reporting is capped because one badly sized element in a grid can be
 * matched by a hundred of its siblings, and a hundred identical lines buries the
 * one line that identifies the bug.
 *
 * The body is a **string expression**, not a function, and that is load-bearing
 * for two reasons. Playwright serialises a function callback and runs it in the
 * page, but this file is run through tsx, whose esbuild transform rewrites named
 * function expressions to register them with a `__name` helper; that helper does
 * not exist in the browser, so a real callback containing a named inner function
 * throws `__name is not defined`. And when a *string* is passed, Playwright
 * evaluates it as an expression rather than parsing it as a function body, so it
 * has to already be a self-invoking expression. Hence the IIFE below, and hence
 * `OVERFLOW_SLACK` being interpolated rather than passed as an argument - a string
 * callback cannot take one. The cost is losing the type-checking of a real
 * callback, which `OverflowReport` and `NavigationReport` replace.
 */
interface OverflowReport {
  viewport: number;
  pageScrollWidth: number;
  pageOverflows: boolean;
  offenders: { selector: string; overflowBy: number }[];
}

interface NavigationReport {
  sidebar: boolean;
  bottomBar: boolean;
}

const OVERFLOW_PROBE = `(() => {
  const slack = ${OVERFLOW_SLACK};
  const viewport = document.documentElement.clientWidth;
  const offenders = [];
  const seen = new Set();

  const describe = (el) => {
    const id = el.id ? "#" + el.id : "";
    const cls = typeof el.className === "string" && el.className
      ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".")
      : "";
    return el.tagName.toLowerCase() + id + cls;
  };

  // An element inside a scroller is allowed to be wider than the screen; the
  // scroller is what makes it reachable.
  const inScroller = (el) => {
    let node = el.parentElement;
    while (node) {
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden") return true;
      node = node.parentElement;
    }
    return false;
  };

  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    // A transformed fixed element moves without changing layout, so its rect
    // would report space it does not use.
    if (style.position === "fixed" && style.transform !== "none") continue;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const overflowBy = rect.right - (viewport + slack);
    if (overflowBy <= 0) continue;
    if (inScroller(el)) continue;

    const label = describe(el);
    if (seen.has(label)) continue;
    seen.add(label);
    offenders.push({ selector: label, overflowBy: Math.round(overflowBy) });
    if (offenders.length >= 4) break;
  }

  const doc = document.documentElement;
  return {
    viewport,
    pageScrollWidth: doc.scrollWidth,
    // The authoritative answer: does the *page* scroll sideways? An element
    // poking out inside a clipped container does not make the document wider.
    pageOverflows: doc.scrollWidth > doc.clientWidth + slack,
    offenders,
  };
})()`;

/** A string expression for the same reasons as `OVERFLOW_PROBE` above. */
const NAV_PROBE = `(() => {
  const visible = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return el.getBoundingClientRect().width > 0;
  };
  return { sidebar: visible("aside"), bottomBar: visible("nav.fixed") };
})()`;

async function findOverflow(page: Page): Promise<OverflowReport> {
  return (await page.evaluate(OVERFLOW_PROBE)) as OverflowReport;
}

/** The fixed navigation each width is supposed to have, and not the other one. */
async function checkNavigation(page: Page): Promise<NavigationReport> {
  return (await page.evaluate(NAV_PROBE)) as NavigationReport;
}

await signIn(page);

let failures = 0;
for (const route of targets) {
  errors.length = 0;
  const res = await page.goto(`http://localhost:3000${route}`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  const status = res?.status() ?? 0;
  const bad = errors.filter((e) => !e.includes("favicon"));
  if (status !== 200 || bad.length > 0) failures += 1;
  console.log(`${status === 200 && bad.length === 0 ? "OK  " : "FAIL"} ${route} ${status} errors=${bad.length}`);
  for (const e of bad.slice(0, 4)) console.log("      " + e);

  const text = await page.evaluate(() => document.body.innerText);
  const marks: Record<string, string[]> = {
    "/dashboard": ["Goal progress", "Projects", "Fitness", "Study", "What moves together"],
  };
  for (const [needle, want] of Object.entries(marks)) {
    if (needle !== route) continue;
    for (const w of want) {
      console.log(`      ${text.includes(w) ? "found" : "MISSING"}: "${w}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// Responsive audit
// ---------------------------------------------------------------------------

/*
 * Every route is re-visited at 375, 768 and 1440. The loop is route-outer and
 * viewport-inner on purpose: changing the viewport is cheap and re-navigating is
 * expensive, so this pays for the navigation once per route and re-measures it
 * three times. It also groups the report by page, which is how the failures read.
 */
console.log("\n--- responsive ---");

for (const route of targets) {
  const problems: string[] = [];

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    errors.length = 0;

    const res = await page.goto(`http://localhost:3000${route}`, {
      waitUntil: "networkidle",
      timeout: 60_000,
    });
    const status = res?.status() ?? 0;
    // Charts and grids settle after first paint; measuring mid-transition is how
    // you get a false "fits" on a layout that has not finished laying out yet.
    await page.waitForTimeout(300);

    const overflow = await findOverflow(page);
    const bad = errors.filter((e) => !e.includes("favicon"));

    if (status !== 200) problems.push(`${viewport.name}: status ${status}`);
    if (overflow.pageOverflows) {
      problems.push(
        `${viewport.name}: page scrolls sideways (${overflow.pageScrollWidth} > ${overflow.viewport})`,
      );
    }
    /*
     * Offenders are reported whether or not the page itself scrolls, because the
     * two are different questions and the interesting one is usually the element
     * rather than the symptom. An element past the edge that the page does *not*
     * scroll for is still worth knowing about - it is usually a card clipped out
     * of sight rather than one the user can reach.
     */
    if (overflow.offenders.length > 0) {
      problems.push(
        `${viewport.name}: past the edge - ${overflow.offenders
          .map((o) => `${o.selector} +${o.overflowBy}px`)
          .join(", ")}`,
      );
    }
    if (bad.length > 0) {
      problems.push(`${viewport.name}: ${bad.length} console error(s): ${bad[0]}`);
    }

    const nav = await checkNavigation(page, viewport.width);
    /*
     * The layout is `lg:` (1024), not `md:` (768), so tablet is deliberately
     * still on the mobile navigation. This asserts the intent rather than
     * assuming it: if someone moves the sidebar to `md:`, 768 stops being able
     * to show both a 248px sidebar and a usable content column, and this is the
     * check that says so.
     */
    const wantsSidebar = viewport.width >= 1024;
    if (nav.sidebar !== wantsSidebar) {
      problems.push(
        `${viewport.name}: sidebar ${nav.sidebar ? "shown" : "hidden"}, expected ${wantsSidebar ? "shown" : "hidden"}`,
      );
    }
    if (nav.bottomBar === wantsSidebar) {
      problems.push(
        `${viewport.name}: bottom nav ${nav.bottomBar ? "shown" : "hidden"}, expected ${wantsSidebar ? "hidden" : "shown"}`,
      );
    }
  }

  if (problems.length > 0) {
    failures += 1;
    console.log(`FAIL ${route}`);
    for (const p of problems) console.log(`      ${p}`);
  } else {
    console.log(`OK   ${route} (${VIEWPORTS.map((v) => v.name).join(", ")})`);
  }
}

// Leave the context on the design width for the deep-link phase below.
await page.setViewportSize({ width: 1440, height: 900 });

/**
 * Follows a hierarchy cross-link and insists it lands on the named card.
 *
 * A status code of 200 proves the destination page exists, not that the link
 * works. The failure this catches is the common one: the link renders, the page
 * loads, and the user is left looking at an undifferentiated board wondering
 * which of the thirty cards they were meant to be reading. So the contract is
 * that the target exists *and* is marked as the target.
 */
async function checkDeepLink(
  page: Page,
  from: string,
  linkPattern: string,
  idPrefix: string,
): Promise<string | null> {
  const base = "http://localhost:3000";
  await page.goto(`${base}${from}`, { waitUntil: "networkidle", timeout: 60_000 });

  const href = await page.evaluate((pattern) => {
    const re = new RegExp(pattern);
    for (const a of document.querySelectorAll("a")) {
      const h = a.getAttribute("href") ?? "";
      if (re.test(h)) return h;
    }
    return null;
  }, linkPattern);

  if (!href) return `${from} rendered no cross-link matching ${linkPattern}`;

  await page.goto(`${base}${href}`, { waitUntil: "networkidle", timeout: 60_000 });
  // The scroll-into-view and ring are applied after hydration.
  await page.waitForTimeout(750);

  const id = new URL(href, base).searchParams.values().next().value ?? "";
  const cardId = `${idPrefix}-${id}`;
  const problem = await page.evaluate((cardId) => {
    const el = document.getElementById(cardId);
    if (!el) return `no card #${cardId} on the destination page`;
    if (!el.className.includes("ring-lime")) {
      return `#${cardId} exists but is not marked as the link target`;
    }
    return null;
  }, cardId);

  if (problem) return `${from} -> ${href}: ${problem}`;
  console.log(`OK   ${from} -> ${href}: landed on marked #${cardId}`);
  return null;
}

const deepLinks: [string, string, string][] = [
  // A project names the goal it serves.
  ["/projects", "^/goals\\?goal=[^&]+$", "goal"],
  // A goal names the projects delivering it.
  ["/goals", "^/projects\\?project=[^&]+$", "project"],
];

for (const [from, pattern, prefix] of deepLinks) {
  const problem = await checkDeepLink(page, from, pattern, prefix);
  if (problem) {
    failures += 1;
    console.log(`FAIL ${problem}`);
  }
}

console.log(failures === 0 ? "ALL CLEAN" : `${failures} route(s) with problems`);
await browser.close();
