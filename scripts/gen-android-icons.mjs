import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

/**
 * Generates Android launcher icons for the Capacitor shell from the web app's
 * logo mark. Produces, for every density bucket:
 *   - ic_launcher.png        (legacy square, dark canvas behind the mark)
 *   - ic_launcher_round.png  (legacy round)
 *   - ic_launcher_foreground.png (adaptive foreground, transparent, safe-zoned)
 *
 * Run from the repo root: node scripts/gen-android-icons.mjs
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "public", "logo-mark.png");
const RES = path.join(root, "mobile", "android", "app", "src", "main", "res");

const BG = { r: 10, g: 11, b: 15, alpha: 1 }; // #0a0b0f, the app's dark canvas
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const LEGACY_DP = 48;
const FOREGROUND_DP = 108;
const LOGO_RATIO_LEGACY = 0.72;
const LOGO_RATIO_FG = 0.58;

async function mark(size) {
  return sharp(SRC)
    .resize(size, size, { fit: "contain", background: TRANSPARENT })
    .png()
    .toBuffer();
}

for (const [density, scale] of Object.entries(densities)) {
  const dir = path.join(RES, `mipmap-${density}`);
  const legacy = Math.round(LEGACY_DP * scale);
  const fg = Math.round(FOREGROUND_DP * scale);

  const squareMark = await mark(Math.round(legacy * LOGO_RATIO_LEGACY));
  await sharp({ create: { width: legacy, height: legacy, channels: 4, background: BG } })
    .composite([{ input: squareMark, gravity: "center" }])
    .png()
    .toFile(path.join(dir, "ic_launcher.png"));

  const roundMark = await mark(Math.round(legacy * LOGO_RATIO_LEGACY));
  const circle = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${legacy}" height="${legacy}">` +
      `<circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}" fill="#0a0b0f"/></svg>`,
  );
  await sharp(circle)
    .composite([{ input: roundMark, gravity: "center" }])
    .png()
    .toFile(path.join(dir, "ic_launcher_round.png"));

  const fgMark = await mark(Math.round(fg * LOGO_RATIO_FG));
  await sharp({ create: { width: fg, height: fg, channels: 4, background: TRANSPARENT } })
    .composite([{ input: fgMark, gravity: "center" }])
    .png()
    .toFile(path.join(dir, "ic_launcher_foreground.png"));
}

console.log(`Android icons generated into ${RES}`);
