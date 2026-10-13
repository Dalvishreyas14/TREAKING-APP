import sharp from "sharp";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regenerates every Android splash drawable in place: the app's dark canvas
 * with the LIFEOS logo mark centred. Reads each existing file's dimensions so
 * the density buckets keep their native sizes.
 *
 * Run from the repo root: node scripts/gen-android-splash.mjs
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RES = path.join(root, "mobile", "android", "app", "src", "main", "res");
const MARK = path.join(root, "public", "logo-mark.png");
const BG = { r: 10, g: 11, b: 15, alpha: 1 }; // #0a0b0f
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
const LOGO_RATIO = 0.34;

async function findSplashes(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await findSplashes(full)));
    } else if (entry.name === "splash.png") {
      out.push(full);
    }
  }
  return out;
}

for (const file of await findSplashes(RES)) {
  const rel = path.relative(RES, file);
  const { width, height } = await sharp(file).metadata();
  if (!width || !height || width < 2 || height < 2) {
    console.log(`skip ${rel} (${width}x${height})`);
    continue;
  }

  const logoSize = Math.round(Math.min(width, height) * LOGO_RATIO);
  const logo = await sharp(MARK)
    .resize(logoSize, logoSize, { fit: "contain", background: TRANSPARENT })
    .png()
    .toBuffer();

  await sharp({ create: { width, height, channels: 4, background: BG } })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toFile(file);

  console.log(`splash ${rel} ${width}x${height} logo=${logoSize}`);
}
