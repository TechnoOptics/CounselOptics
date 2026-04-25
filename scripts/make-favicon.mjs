// One-shot favicon generator. Reads the App Icon brand asset, removes the
// near-white background by alpha-thresholding, trims to the artwork, pads
// to a square canvas, and emits Next.js' magic favicon files.
//
// Run with: node scripts/make-favicon.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Source: pillar mark, RGB with white background.
const SRC = String.raw`C:\Users\abelm\OneDrive - technooptics.org\Companies\Advottic\Brand Assets\Logos\Word Logo\Logo Only\Logo Only.png`;

// Pixels with R, G, B all >= this threshold are treated as background and
// turned transparent. Tweak if the artwork has near-white highlights.
const WHITE_THRESHOLD = 245;

async function main() {
  const meta = await sharp(SRC).metadata();
  console.log(`source: ${meta.width}x${meta.height} ${meta.channels}-channel`);

  // Step 1: load as raw RGBA so we can mask out the white BG.
  const { data, info } = await sharp(SRC)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const px = info.width * info.height;
  let stripped = 0;
  for (let i = 0; i < px; i++) {
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    if (r >= WHITE_THRESHOLD && g >= WHITE_THRESHOLD && b >= WHITE_THRESHOLD) {
      data[o + 3] = 0; // alpha
      stripped++;
    }
  }
  console.log(`stripped ${stripped}/${px} pixels (${((stripped / px) * 100).toFixed(1)}%)`);

  // Step 2: trim transparent borders + pad to square so the icon centers in
  // every favicon size.
  const trimmed = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .trim({ threshold: 1 }) // any non-zero alpha is content
    .png()
    .toBuffer();

  const trimmedMeta = await sharp(trimmed).metadata();
  const side = Math.max(trimmedMeta.width, trimmedMeta.height);
  // Pad with ~6% breathing room around the artwork
  const canvasSide = Math.round(side * 1.12);
  const square = await sharp({
    create: {
      width: canvasSide,
      height: canvasSide,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: trimmed, gravity: 'center' }])
    .png()
    .toBuffer();

  // Step 3: emit the Next.js magic icon files. App Router automatically
  // hooks these up to the document head.
  const APP = path.join(ROOT, 'app');

  // Browser tab favicon
  await sharp(square).resize(64, 64).png().toFile(path.join(APP, 'icon.png'));
  console.log('wrote app/icon.png (64x64)');

  // Apple touch icon
  await sharp(square)
    .resize(180, 180)
    .png()
    .toFile(path.join(APP, 'apple-icon.png'));
  console.log('wrote app/apple-icon.png (180x180)');

  // Public-folder copy for any non-Next consumers (e.g. emails)
  const PUB = path.join(ROOT, 'public');
  await sharp(square).resize(512, 512).png().toFile(path.join(PUB, 'advottic-mark.png'));
  console.log('wrote public/advottic-mark.png (512x512)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
