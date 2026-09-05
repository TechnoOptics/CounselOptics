import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The lockfile installs no copy of these packages below the release that
 * closed a high or critical advisory.
 *
 * The Security audit workflow fails on high and critical findings. Nine of
 * them on main were plain semver-compatible bumps that `npm audit fix` could
 * make without touching package.json: tar (critical), @capacitor/cli,
 * brace-expansion, browserslist, deepmerge-ts, html-to-text, mailparser,
 * nanoid and tmp. Two of those sit on the evidence path: mailparser reads
 * every uploaded .eml, and html-to-text and deepmerge-ts run under it.
 *
 * This reads the lockfile, which is what `npm ci` installs, so a routine
 * install cannot quietly bring a vulnerable copy back. The floor is per
 * major line, because a package can carry several copies at once (four of
 * brace-expansion on main) and the fix for a 2.x copy is not the fix for a
 * 5.x copy. A major line with no floor of its own falls back to the general
 * floor, which an old line can never satisfy, and that is the point: nothing
 * fixed exists on that line, so the copy has to move.
 *
 * There used to be a named exception here for the tar 6 and @capacitor/cli 5
 * copies nested under @capacitor/assets, which pinned lines with no fixed
 * release. That package left devDependencies on 2026-09-05 (the iOS release
 * workflow runs it through npx instead), so every copy is held now.
 */

type Floors = Record<string, string>;

/** Lowest patched release per major line, from the advisories' ranges. */
const FLOORS: Record<string, Floors> = {
  tar: { '*': '7.5.21' },
  '@capacitor/cli': { '7': '7.4.6', '8': '8.0.2', '*': '7.4.6' },
  'brace-expansion': { '1': '1.1.18', '2': '2.1.4', '*': '5.0.9' },
  browserslist: { '*': '4.28.7' },
  'deepmerge-ts': { '*': '8.0.0' },
  'html-to-text': { '*': '10.0.1' },
  mailparser: { '*': '3.9.16' },
  nanoid: { '3': '3.3.18', '*': '5.0.0' },
  tmp: { '*': '0.2.6' },
};

function triple(v: string): [number, number, number] {
  const [a, b, c] = v.split('-')[0]!.split('.').map(Number);
  return [a ?? 0, b ?? 0, c ?? 0];
}

function atLeast(version: string, floor: string): boolean {
  const [a, b, c] = triple(version);
  const [x, y, z] = triple(floor);
  return a !== x ? a > x : b !== y ? b > y : c >= z;
}

function lockedCopies(name: string): Array<{ at: string; version: string }> {
  const lock = JSON.parse(
    readFileSync(path.join(process.cwd(), 'package-lock.json'), 'utf8'),
  ) as { packages: Record<string, { version?: string }> };
  return Object.entries(lock.packages)
    .filter(([at]) => at.endsWith(`node_modules/${name}`))
    .map(([at, meta]) => ({ at, version: meta.version ?? '' }));
}

describe.each(Object.entries(FLOORS))('%s in the lockfile', (name, floors) => {
  const copies = lockedCopies(name);

  it('is still installed, so the floor is guarding something', () => {
    expect(copies.length).toBeGreaterThan(0);
  });

  it.each(copies)('$at is $version, at or above its floor', ({ version }) => {
    const major = String(triple(version)[0]);
    const floor = floors[major] ?? floors['*']!;
    expect(atLeast(version, floor), `${version} is below ${floor}`).toBe(true);
  });
});
