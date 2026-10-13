/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

/**
 * The LIFEOS service worker.
 *
 * It is compiled to `public/sw.js` at build time by the route in
 * `src/app/serwist/[path]/route.ts`. `__SW_MANIFEST` is the precache list the
 * build injects in place of the `self.__SW_MANIFEST` reference below.
 *
 * `defaultCache` handles the app shell: hashed Next.js chunks and static assets
 * are cache-first, navigations are network-first with a cache fallback, so an
 * installed app opens instantly and still opens when the network is gone. Real
 * data needs a connection, so document requests that miss the cache fall back
 * to `/~offline` rather than the browser's own error page.
 */

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
