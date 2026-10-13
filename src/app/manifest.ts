import type { MetadataRoute } from "next";

/**
 * The web app manifest, served at `/manifest.webmanifest`.
 *
 * Next.js links this automatically from the `<link rel="manifest">` tag, so
 * there is nothing to add to the metadata export. `display: "standalone"` is
 * what makes an installed LIFEOS open without the browser chrome, on both
 * Android (Chrome/Edge install) and iOS ("Add to Home Screen").
 *
 * `background_color` and `theme_color` mirror the dark theme the app defaults
 * to, so the launch screen and status bar match the first paint instead of
 * flashing white.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LIFEOS — Run Your Life With Intelligence",
    short_name: "LIFEOS",
    description:
      "One intelligent workspace for your goals, habits, tasks, fitness, study, routines and personal growth.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0b0f",
    theme_color: "#0a0b0f",
    categories: ["productivity", "lifestyle", "health"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
