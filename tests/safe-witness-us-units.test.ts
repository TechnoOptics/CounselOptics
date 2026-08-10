import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Safe Witness is the surface where a person is tracking someone in distress
 * and deciding how fast to move. It is a United States product, so the
 * distance and accuracy readouts have to be in units the reader already
 * thinks in. "You are 0.8 km away" asks someone mid-emergency to convert.
 *
 * The check is a source scan rather than a render because these numbers are
 * assembled inline in template literals across a client component, a route
 * handler and an email body; there is no single function to call. What it
 * pins is the shape that was actually wrong: an interpolated number followed
 * immediately by a metric unit.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const SURFACE = [
  'app/safe',
  'app/api/safe',
  'app/api/safe-alert',
  'components/SafeWitness.tsx',
  'components/DistressOverlay.tsx',
];

function collect(rel: string, out: string[] = []): string[] {
  const abs = join(ROOT, rel);
  const st = statSync(abs);
  if (st.isFile()) {
    if (/\.tsx?$/.test(rel)) out.push(rel);
    return out;
  }
  for (const entry of readdirSync(abs)) collect(join(rel, entry), out);
  return out;
}

const files = SURFACE.flatMap((s) => collect(s));

/** `${...} m`, `${...}m`, `${...} km`, `${...}km` - a number wearing a metric unit. */
const METRIC_READOUT = /\$\{[^{}]*\}\s*k?m\b/;

describe('Safe Witness reports distance in US customary units', () => {
  it('reads a surface wide enough for the check to mean something', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const rel of files) {
    it(`${rel} renders no metric distance`, () => {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      const offenders = src
        .split('\n')
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => METRIC_READOUT.test(line))
        .map(([n, line]) => `${rel}:${n} ${line.trim()}`);
      expect(offenders).toEqual([]);
    });
  }

  it('the two live readouts route through the shared US formatter', () => {
    const tracker = readFileSync(
      join(ROOT, 'app/safe/alert/[id]/live-tracker.tsx'),
      'utf8',
    );
    expect(tracker).toContain('formatDistanceFromMeters');
  });
});
