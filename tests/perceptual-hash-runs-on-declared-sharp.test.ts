import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

/**
 * Near-duplicate detection runs on a sharp the app actually declares.
 *
 * lib/perceptual-hash.ts imports sharp to compute a dHash for every image a
 * firm uploads, so a re-saved or screenshotted copy of the same photo is
 * caught. Until 2026-09-05 sharp was not in package.json at all: it was in
 * node_modules only because @capacitor/assets, a dev-only icon generator,
 * happened to pin sharp 0.32.6. Removing that package would have removed
 * the app's own image library, and the module would have failed to load,
 * which is what two test files did the day sharp's binary went missing.
 *
 * Two things are held here. sharp is a declared runtime dependency, and the
 * hash still behaves like a perceptual hash on the version installed: the
 * same picture at another size hashes the same, a different picture does
 * not, and a buffer that is not an image yields null rather than a throw.
 */

const { perceptualHash } = await import('../lib/perceptual-hash');

async function png(width: number, height: number, draw: 'gradient' | 'stripes'): Promise<Buffer> {
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = draw === 'gradient'
        ? Math.round((x / (width - 1)) * 255)
        : (Math.floor((x / width) * 4) % 2 === 0 ? 30 : 220);
      const i = (y * width + x) * channels;
      raw[i] = v; raw[i + 1] = v; raw[i + 2] = v;
    }
  }
  return sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
}

describe('sharp as a dependency', () => {
  it('is declared under dependencies, not inherited from a dev tool', () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.sharp).toBeTruthy();
    expect(pkg.devDependencies?.['@capacitor/assets']).toBeUndefined();
  });
});

describe('perceptualHash on the installed sharp', () => {
  it('returns sixteen hex characters for an image', async () => {
    const hash = await perceptualHash(await png(64, 48, 'gradient'));
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('gives the same picture the same hash at a different size', async () => {
    const small = await perceptualHash(await png(64, 48, 'gradient'));
    const large = await perceptualHash(await png(320, 240, 'gradient'));
    expect(small).toBe(large);
  });

  it('gives a different picture a different hash', async () => {
    const gradient = await perceptualHash(await png(64, 48, 'gradient'));
    const stripes = await perceptualHash(await png(64, 48, 'stripes'));
    expect(gradient).not.toBe(stripes);
  });

  it('yields null, not a throw, for bytes that are not an image', async () => {
    await expect(perceptualHash(Buffer.from('%PDF-1.4 pretend'))).resolves.toBeNull();
  });
});
