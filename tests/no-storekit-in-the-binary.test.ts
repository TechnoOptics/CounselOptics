import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripComments } from './support/strip-comments';

/**
 * Advottic on iOS sells nothing, and the signed binary should say so too.
 *
 * WHAT WENT WRONG. Apple In-App Purchase was removed from the product in July
 * 2026, but `@revenuecat/purchases-capacitor` stayed in package.json. Capacitor
 * lists every installed plugin in the generated native project, so the signed
 * binary kept linking RevenueCat and StoreKit native code with no JavaScript
 * caller left (finding 21 and section 1 of
 * docs/IOS_3_1_1_REACHABILITY_SWEEP.md). The only module that ever imported
 * the plugin, lib/iap.ts, had no importer of its own.
 *
 * A comment on the Billing row in components/UserMenuClient.tsx also claimed
 * that subscriptions are sold through In-App Purchase on iOS. The row's
 * conclusion (keep it reachable) is right; the stated reason was false, and
 * false comments on this subject have been trusted instead of the code before.
 *
 * WHAT IS ASSERTED. The dependency is gone from package.json, the lockfile and
 * the Capacitor-generated Android gradle files; no source under app/,
 * components/ or lib/ names the package (comments stripped, so a comment
 * describing the removal cannot satisfy or trip this); lib/iap.ts does not
 * exist; and the Billing row's comment makes no In-App Purchase claim while
 * the row itself is still rendered and still ungated. Each file read carries
 * a positive control proving the right file was read.
 *
 * The comment check deliberately reads the RAW source: the defect is the
 * comment, so stripping it first would hide the thing being guarded.
 */

const ROOT = join(__dirname, '..');
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === 'node_modules' || name === '.next') continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

describe('the RevenueCat/StoreKit plugin is out of the dependency graph', () => {
  it('package.json lists no @revenuecat package in any dependency block', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, Record<string, string> | undefined>;
    const blocks = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
    const names = blocks.flatMap((b) => Object.keys(pkg[b] ?? {}));
    expect(names).toContain('@capacitor/ios'); // positive control: the real dependency map was read
    expect(names.filter((n) => n.startsWith('@revenuecat/'))).toEqual([]);
  });

  it('package-lock.json resolves nothing from RevenueCat', () => {
    const lock = read('package-lock.json');
    expect(lock).toContain('node_modules/@capacitor/ios'); // positive control
    expect(lock).not.toMatch(/revenuecat/i);
  });

  it('the Capacitor-generated Android gradle files no longer include the plugin project', () => {
    const settings = read('android/capacitor.settings.gradle');
    const build = read('android/app/capacitor.build.gradle');
    expect(settings).toContain("include ':capacitor-preferences'"); // positive control
    expect(build).toContain("implementation project(':capacitor-preferences')"); // positive control
    expect(settings).not.toMatch(/revenuecat/i);
    expect(build).not.toMatch(/revenuecat/i);
  });

  it('no source under app/, components/ or lib/ imports the package, and lib/iap.ts is gone', () => {
    const files = ['app', 'components', 'lib'].flatMap((d) => walk(join(ROOT, d)));
    expect(files.length).toBeGreaterThan(200); // positive control: the walk saw the tree
    expect(files.map((f) => relative(ROOT, f))).toContain('lib/iap-guard.ts'); // positive control
    const offenders = files.filter((f) => stripComments(readFileSync(f, 'utf8')).includes('@revenuecat/'));
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
    expect(existsSync(join(ROOT, 'lib/iap.ts'))).toBe(false);
  });
});

describe('UserMenuClient: the Billing row is kept for the true reason', () => {
  const raw = read('components/UserMenuClient.tsx');
  const stripped = stripComments(raw);

  it('still renders the Billing row, ungated (positive control and the conclusion that stays)', () => {
    const row = stripped.match(/<MenuLink href="\/billing"[^>]*>/);
    expect(row).not.toBeNull();
    expect(row![0]).not.toMatch(/data-hide-on-ios|data-hide-in-app/);
  });

  it('the comment on that row does not claim anything is sold through Apple', () => {
    const start = raw.indexOf('!props.isCounselMode && (');
    const end = raw.indexOf('href="/billing"', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const commentRegion = raw.slice(start, end);
    expect(commentRegion).toMatch(/sells nothing/); // the true reason is stated
    expect(commentRegion).not.toMatch(/sold through|are sold|In-App Purchase there|StoreKit there|RevenueCat/);
  });
});
