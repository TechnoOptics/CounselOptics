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

/**
 * Copies the floor cannot reach, by name, so nobody mistakes them for fixed.
 *
 * @capacitor/assets 3.0.5 (its latest) pins @capacitor/cli ^5.3.0, and that
 * line's newest release, 5.7.8, still carries tar 6.2.1. No 5.x cli and no
 * 6.x tar closes the advisory, so `npm audit fix` cannot move either without
 * `--force`, and npm's "fix available" for them is wrong. They are dev-only
 * tooling behind `npx capacitor-assets generate`. The versions are pinned
 * here so the day either one changes, this file goes red and someone looks
 * again instead of the exception silently outliving its reason.
 */
const KNOWN_UNFIXED: Record<string, string> = {
  'node_modules/@capacitor/assets/node_modules/@capacitor/cli': '5.7.8',
  'node_modules/@capacitor/assets/node_modules/tar': '6.2.1',
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

  const held = copies.filter((c) => !(c.at in KNOWN_UNFIXED));
  const excepted = copies.filter((c) => c.at in KNOWN_UNFIXED);

  it.each(excepted)('$at is the known unfixed $version, and nothing newer', ({ at, version }) => {
    expect(version).toBe(KNOWN_UNFIXED[at]);
  });

  it.each(held)('$at is $version, at or above its floor', ({ version }) => {
    const major = String(triple(version)[0]);
    const floor = floors[major] ?? floors['*']!;
    expect(atLeast(version, floor), `${version} is below ${floor}`).toBe(true);
  });
});
