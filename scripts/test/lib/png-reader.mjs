/**
 * Decode a PNG screenshot to raw RGBA so individual pixels can be read.
 *
 * `sharp` is already in the tree (Next.js pulls it in for image
 * optimisation), so this adds no dependency. It is used only to get at
 * the bytes - no resizing, no colour management, `ensureAlpha` so the
 * stride is always 4 whatever the encoder chose.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

export async function decodePng(buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  return {
    width,
    height,
    /** [r,g,b,a] at (x,y), or null when out of frame. */
    at(x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height) return null;
      const i = (y * width + x) * channels;
      return [data[i], data[i + 1], data[i + 2], channels > 3 ? data[i + 3] : 255];
    },
  };
}
