// Generates the icon set the PWA + iOS / Android app shells need, plus the
// header tile used in the website. Reads the high-res pillar mark from
// public/advottic-mark.png and emits everything on a forest-green
// background so the icon reads identically in every context (iOS doesn't
// support transparent home-screen icons; Android masks the safe area;
// the dark header benefits from a tile rather than a bleeding pillar).
//
// Outputs:
//   public/advottic-tile.png      512x512 — branded tile with rounded corners
//                                  (used in the website header).
//   public/icon-192.png           192x192 — PWA standard icon, green BG.
//   public/icon-512.png           512x512 — PWA standard icon, green BG.
//   public/icon-maskable-512.png  512x512 — Android maskable, green BG.
//   public/apple-icon.png         180x180 — iOS Apple-touch-icon, green BG.
//   app/icon.png                  64x64   — Browser tab favicon, green BG.
//   app/apple-icon.png            180x180 — Same image for the iOS browser
//                                  add-to-home flow.
//
// Run with: node scripts/make-pwa-icons.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'advottic-mark.png');
const PUB = path.join(ROOT, 'public');
const APP = path.join(ROOT, 'app');

// Forest gradient backdrop as inline SVG, rasterized at the size we want.
function backdrop(size, opts = {}) {
  const radius = opts.radius ?? 0;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#1a3d31"/>
        <stop offset="50%" stop-color="#0f2d24"/>
        <stop offset="100%" stop-color="#0a1f19"/>
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="url(#bg)"/>
  </svg>`);
}

async function brandedTile({ size, innerScale = 0.62, radius = 0 }) {
  const innerSize = Math.round(size * innerScale);
  const innerBuf = await sharp(SRC)
    .resize(innerSize, innerSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  return sharp(backdrop(size, { radius }))
    .composite([{ input: innerBuf, gravity: 'center' }])
    .png()
    .toBuffer();
}

async function main() {
  console.log('reading', SRC);

  // Header tile: rounded corners so it reads as a polished icon.
  const tile = await brandedTile({ size: 512, innerScale: 0.62, radius: 88 });
  await sharp(tile).toFile(path.join(PUB, 'advottic-tile.png'));
  console.log('wrote public/advottic-tile.png');

  // Standard square 192 / 512 (no rounded corners - PWA / OS rounds them).
  await sharp(await brandedTile({ size: 192, innerScale: 0.62, radius: 0 }))
    .toFile(path.join(PUB, 'icon-192.png'));
  console.log('wrote public/icon-192.png');

  await sharp(await brandedTile({ size: 512, innerScale: 0.62, radius: 0 }))
    .toFile(path.join(PUB, 'icon-512.png'));
  console.log('wrote public/icon-512.png');

  // Maskable: smaller artwork (75% of standard) so Android's safe-area
  // circle never crops into the pillar.
  await sharp(await brandedTile({ size: 512, innerScale: 0.50, radius: 0 }))
    .toFile(path.join(PUB, 'icon-maskable-512.png'));
  console.log('wrote public/icon-maskable-512.png');

  // iOS apple-touch-icon (180) - rounded corners are added by iOS.
  await sharp(await brandedTile({ size: 180, innerScale: 0.62, radius: 0 }))
    .toFile(path.join(PUB, 'apple-icon.png'));
  console.log('wrote public/apple-icon.png');

  // Next.js auto-discovered favicon files in app/.
  await sharp(await brandedTile({ size: 64, innerScale: 0.7, radius: 12 }))
    .toFile(path.join(APP, 'icon.png'));
  console.log('wrote app/icon.png');

  await sharp(await brandedTile({ size: 180, innerScale: 0.62, radius: 0 }))
    .toFile(path.join(APP, 'apple-icon.png'));
  console.log('wrote app/apple-icon.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
