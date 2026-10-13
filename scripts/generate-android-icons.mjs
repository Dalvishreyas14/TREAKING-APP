import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/**
 * Generates Android launcher icons for the Capacitor app from the shared
 * brand mark (public/logo-mark.png). Produces, for every density bucket:
 *
 *   ic_launcher.png            legacy square icon (dark tile + logo)
 *   ic_launcher_round.png      legacy circular icon
 *   ic_launcher_foreground.png adaptive-icon foreground (transparent, safe-zoned)
 *
 * The adaptive background stays the `ic_launcher_background` color resource
 * (#0a0b0f), so only the foreground is emitted for API 26+ devices.
 */

const root = process.cwd();
const srcPath = path.join(root, "public", "logo-mark.png");
const resDir = path.join(root, "mobile", "android", "app", "src", "main", "res");

const BG = "#0a0b0f";
const LEGACY = 48;
const ADAPTIVE = 108;
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

function circleSvg(size) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );
}

async function logo(size) {
  return sharp(srcPath)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

for (const [name, scale] of Object.entries(DENSITIES)) {
  const dir = path.join(resDir, `mipmap-${name}`);
  await mkdir(dir, { recursive: true });

  const legacy = Math.round(LEGACY * scale);
  const square = await sharp({
    create: { width: legacy, height: legacy, channels: 4, background: BG },
  })
    .composite([{ input: await logo(Math.round(legacy * 0.62)), gravity: "center" }])
    .png()
    .toBuffer();

  await sharp(square).png().toFile(path.join(dir, "ic_launcher.png"));
  await sharp(square)
    .composite([{ input: circleSvg(legacy), blend: "dest-in" }])
    .png()
    .toFile(path.join(dir, "ic_launcher_round.png"));

  const adaptive = Math.round(ADAPTIVE * scale);
  await sharp({
    create: {
      width: adaptive,
      height: adaptive,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: await logo(Math.round(adaptive * 0.6)), gravity: "center" }])
    .png()
    .toFile(path.join(dir, "ic_launcher_foreground.png"));

  console.log(`mipmap-${name}: legacy ${legacy}px, adaptive ${adaptive}px`);
}

console.log("Android launcher icons generated.");
