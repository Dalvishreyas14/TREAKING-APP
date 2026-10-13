import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The proxy's two route lists must agree.
 *
 * `PROTECTED` decides whether a request needs a session, and `config.matcher`
 * decides which requests reach that code at all. A prefix present in the first
 * and missing from the second is not a build error and not a test failure
 * anywhere else — the page simply stops redirecting unauthenticated browsers, and
 * nothing looks wrong. It is also not a security boundary, because every handler
 * re-checks the session, so it is exactly the class of bug that survives review.
 *
 * The file is parsed as text rather than imported. `src/proxy.ts` constructs
 * NextAuth at module scope, and importing it under Vitest pulls in `next-auth`'s
 * environment shim, which resolves `next/server` through a path Node does not
 * accept. The values under test are two literal arrays, and reading them as
 * literals is also the only way to assert the property that matters: that the
 * file Next.js actually reads is internally consistent.
 */

const source = readFileSync(join(process.cwd(), "src", "proxy.ts"), "utf8");

/** The string literals in a `const NAME = [...]` block. */
function listFrom(name: string): string[] {
  const declaration = new RegExp(
    `(?:export\\s+)?const\\s+${name}\\s*(?::[^=]+)?=\\s*\\[([\\s\\S]*?)\\]`,
  ).exec(source);
  expect(declaration, `expected a literal array named ${name} in src/proxy.ts`).not.toBeNull();
  return [...(declaration![1]!.matchAll(/"([^"]+)"/g))].map((m) => m[1]!);
}

/** The string literals in a `matcher: [...]` property, wherever it is declared. */
function matcherFrom(): string[] {
  const property = /matcher\s*:\s*\[([\s\S]*?)\]/.exec(source);
  expect(property, "expected a literal `matcher` array in src/proxy.ts").not.toBeNull();
  return [...(property![1]!.matchAll(/"([^"]+)"/g))].map((m) => m[1]!);
}

const PROTECTED = listFrom("PROTECTED");
const AUTH_PAGES = listFrom("AUTH_PAGES");
const MATCHER = matcherFrom();

/** Next.js matcher entry for a route path. */
function matcherFor(path: string): string {
  return AUTH_PAGES.includes(path) ? path : `${path}/:path*`;
}

/** Every page route under `src/app`, as its public path. */
function pageRoutes(dir = join(process.cwd(), "src", "app"), prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || entry === "api") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Route groups are organisational only and do not appear in the URL.
      const isGroup = entry.startsWith("(") && entry.endsWith(")");
      out.push(...pageRoutes(full, isGroup ? prefix : `${prefix}/${entry}`));
    } else if (/^page\.tsx$/.test(entry)) {
      out.push(prefix || "/");
    }
  }
  return out;
}

describe("proxy matcher", () => {
  it("matches every protected prefix and auth page", () => {
    for (const path of [...PROTECTED, ...AUTH_PAGES]) {
      expect(MATCHER).toContain(matcherFor(path));
    }
  });

  it("has no matcher entry for a route neither list mentions", () => {
    const known = new Set([...PROTECTED, ...AUTH_PAGES].map(matcherFor));
    // An entry with no list counterpart is dead config: the request reaches the
    // proxy, and the proxy has no opinion about it.
    expect(MATCHER.filter((m) => !known.has(m))).toEqual([]);
  });

  it("protects every page behind the app layout", () => {
    // Every page under `(app)` needs a session. A page that exists with no
    // matcher entry is reachable by an anonymous browser, which looks like it
    // works right up until the server component's own `requireUser` throws.
    const appGroup = join(process.cwd(), "src", "app", "(app)");
    for (const path of pageRoutes(appGroup)) {
      expect(MATCHER).toContain(`${path}/:path*`);
    }
  });

  it("does not protect the public routes", () => {
    // `/` and the auth pages are the ones a signed-out visitor is meant to reach.
    for (const path of ["/", "/sign-in", "/sign-up", "/forgot-password"]) {
      expect(MATCHER).not.toContain(`${path}/:path*`);
    }
  });
});
