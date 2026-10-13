import { mkdir } from "node:fs/promises";

import sharp from "sharp";

/**
 * Generates the PWA icon set from the single brand asset, `public/logo-mark.png`
 * (512x512). Run with `npm run icons:pwa` after the logo changes.
 *
 * Two families come out of this:
 *
 * - "any" icons are the mark untouched at 192 and 512, used on Android home
 *   screens and in the install prompt.
 * - "maskable" icons pad the mark inside the safe zone (the mark occupies a
 *   fraction of the tile, centred) on the dark canvas colour, so Android can
 *   crop it to a circle, squircle or rounded square without clipping the symbol.
 *
 * `apple-touch-icon.png` is 180x180, the size iOS uses with no further masking.
 */

const SRC = "public/logo-mark.png";
const OUT = "public/icons";

// The dark `--canvas` token, so a maskable tile matches the app background.
const CANVAS = { r: 10, g: 11, b: 15, alpha: 1 };

async function resized(size, dest) {
  await sharp(SRC).resize(size, size, { fit: "cover" }).png().toFile(dest);
}

async function maskable(size) {
  // Keep the mark inside the ~80% safe-zone circle with room to spare.
  const inner = Math.round(size * 0.66);
  const mark = await sharp(SRC).resize(inner, inner, { fit: "cover" }).png().toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: CANVAS },
  })
    .composite([{ input: mark, gravity: "centre" }])
    .png()
    .toFile(`${OUT}/maskable-${size}.png`);
}

await mkdir(OUT, { recursive: true });

await resized(192, `${OUT}/icon-192.png`);
await resized(512, `${OUT}/icon-512.png`);
await maskable(192);
await maskable(512);
await resized(180, "public/apple-touch-icon.png");

console.log("PWA icons written to", OUT, "and public/apple-touch-icon.png");
