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
  if (!block) return [];
  return [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

// Matches both dispatch spellings in executeTool:
//   if (name === 'x') { return await loadX(firmId!); }
//   if (name === 'x') return await loadX(firmId!, input);
function toolsDispatchedWithFirmId(): string[] {
  return [
    ...source.matchAll(
      /name === '([a-z_]+)'\)\s*\{?\s*(?:return\s+)?await\s+\w+\(\s*firmId!/g,
    ),
  ].map((m) => m[1]);
}

describe('lib/bella.ts firm tool scoping', () => {
  it('finds the FIRM_ONLY set and the firmId dispatches at all', () => {
    // Without this the two assertions below pass vacuously the moment
    // someone reformats executeTool and the patterns stop matching. A guard
    // that silently stops looking is worse than no guard.
    expect(firmOnlyToolNames().length).toBeGreaterThan(20);
    expect(toolsDispatchedWithFirmId().length).toBeGreaterThan(15);
  });

  it('lists every firmId-scoped tool in FIRM_ONLY', () => {
    const firmOnly = new Set(firmOnlyToolNames());
    const unguarded = toolsDispatchedWithFirmId().filter((t) => !firmOnly.has(t));
    expect(unguarded).toEqual([]);
  });
});
