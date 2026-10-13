import { createSerwistRoute } from "@serwist/turbopack";

/**
 * Serves the compiled service worker at `/serwist/sw.js`.
 *
 * This is a build-time route: Serwist bundles `src/app/sw.ts` with esbuild,
 * injects the precache manifest and returns the finished worker. The service
 * worker is deliberately served from `/serwist/` rather than the site root so
 * its scope and its cache are obvious in DevTools.
 *
 * `revision` versions the offline page. It changes on every build so an updated
 * `/~offline` replaces the old copy instead of being served from the precache.
 */
const revision = crypto.randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    swSrc: "src/app/sw.ts",
    additionalPrecacheEntries: [{ url: "/~offline", revision }],
    useNativeEsbuild: true,
  });
