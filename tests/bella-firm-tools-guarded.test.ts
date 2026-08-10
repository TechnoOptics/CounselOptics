import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * Every Bella tool that is handed `firmId!` must be in FIRM_ONLY.
 *
 * WHY THIS GUARD EXISTS, when most comments in this repo do not get one.
 * The block comment above the firm loaders in lib/bella.ts used to say the
 * loaders ran on the user-scoped client "so RLS still applies on top". They
 * do not: all of them build the service-role admin client, which answers
 * every query regardless of who is asking. A reader who believed that
 * sentence would think there were two independent controls on firm data and
 * would not think twice about adding a twenty-second loader. There is only
 * one control, and this is it: FIRM_ONLY refuses the tool unless the portal
 * resolved to 'firm', which is also the only reason `firmId` is non-null and
 * the only reason the `!` on `firmId!` is sound.
 *
 * So the corrected comment now makes a load-bearing promise. A new firm tool
 * dispatched with `firmId!` but left out of FIRM_ONLY would run in a consumer
 * or HQ chat with `firmId` actually null, turning `.eq('firm_id', firmId)`
 * into a filter on null rows or, in a loader that forgets the filter, into an
 * unscoped read of another firm's data through the service role. Nothing else
 * in the file would notice, which is exactly the shape that put this codebase
 * in trouble before.
 *
 * The source is comment-stripped first, via the shared helper, so a comment
 * that merely mentions a tool name cannot satisfy the guard.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = stripComments(readFileSync(join(repoRoot, 'lib/bella.ts'), 'utf8'));

function firmOnlyToolNames(): string[] {
  const block = source.match(/const FIRM_ONLY:[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
  // The anchor itself. Returning [] here would have made every comparison
  // below trivially true.
  expect(block, 'the FIRM_ONLY set is no longer where this guard looks').toBeTruthy();
  return [...block![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/**
 * Every `name === 'x'` dispatch in executeTool, with the branch that follows
 * it, up to the next dispatch.
 *
 * This used to be one regex requiring `await loader(firmId!` to sit
 * IMMEDIATELY after the condition. It matched 21 of the 37 dispatch sites, and
 * the floors below it were set at 20 and 15, well under the real counts, so a
 * tool dropping out of the sweep was invisible. Rewriting one dispatch as
 * `{ const rows = await loadReferrals(firmId!, input); return rows; }` and
 * deleting it from FIRM_ONLY took it out of the matched set and left the guard
 * green, which is the unscoped service-role read this file exists to prevent.
 *
 * Reading the whole branch instead means no statement order, no formatting and
 * no intermediate variable can hide the `firmId!`.
 */
function dispatchSites(): { name: string; body: string }[] {
  const starts = [...source.matchAll(/name === '([a-z_]+)'/g)].map((m) => ({
    name: m[1],
    at: m.index ?? 0,
  }));
  return starts.map((s, i) => ({
    name: s.name,
    body: source.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : source.length),
  }));
}

function toolsDispatchedWithFirmId(): string[] {
  return dispatchSites()
    .filter((d) => /\bfirmId!/.test(d.body))
    .map((d) => d.name);
}

describe('lib/bella.ts firm tool scoping', () => {
  it('finds the FIRM_ONLY set and the firmId dispatches at all', () => {
    // Without this the assertions below pass vacuously the moment someone
    // reformats executeTool and the patterns stop matching. A guard that
    // silently stops looking is worse than no guard.
    //
    // The floors are tied to each other rather than written as two loose
    // magic numbers: every name in FIRM_ONLY must actually be dispatched, so
    // the sweep cannot quietly shrink below the set it is checking.
    const firmOnly = firmOnlyToolNames();
    const dispatched = new Set(dispatchSites().map((d) => d.name));
    expect(firmOnly.length).toBeGreaterThan(20);
    expect(dispatchSites().length).toBeGreaterThanOrEqual(firmOnly.length);
    expect(firmOnly.filter((t) => !dispatched.has(t))).toEqual([]);
    // Six FIRM_ONLY tools reach their firm context another way and never
    // write `firmId!`, so this stays a floor rather than an equality.
    expect(toolsDispatchedWithFirmId().length).toBeGreaterThan(15);
  });

  it('lists every firmId-scoped tool in FIRM_ONLY', () => {
    const firmOnly = new Set(firmOnlyToolNames());
    const unguarded = toolsDispatchedWithFirmId().filter((t) => !firmOnly.has(t));
    expect(unguarded).toEqual([]);
  });
});
