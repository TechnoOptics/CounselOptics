import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * Every export of lib/import-actions.ts that reaches the database must call
 * requireFirmMember first.
 *
 * WHY THIS ONE GETS A GUARD. The file's header used to say membership is
 * verified "at the top of every action". Two of the seven exports have no
 * gate at all. That is currently harmless, and only currently: previewCsvAction
 * and previewJsonDumpAction parse caller-supplied text and touch nothing. But
 * this is a `'use server'` module, so every export is a public endpoint, and
 * the header told a reader those endpoints were already gated. Someone adding
 * a lookup to a preview - resolving a client name, checking for duplicates
 * before import - would be adding an unauthenticated read while believing the
 * gate above already ran.
 *
 * That is the shape this codebase keeps getting hurt by: a service-role write
 * behind nothing but a UI that happens to call it correctly. The corrected
 * header now promises the narrower, true thing, and this holds the file to it
 * without freezing which functions exist.
 *
 * The source is comment-stripped via the shared helper first, so a comment
 * that merely mentions requireFirmMember cannot pass for a call to it.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = stripComments(
  readFileSync(join(repoRoot, 'lib/import-actions.ts'), 'utf8'),
);

const DB_ACCESS = /\.from\(|createAdminSupabase|createServerSupabase|auth\.admin/;

function exportedActions(): { name: string; gated: boolean; touchesDb: boolean }[] {
  const marks = [...source.matchAll(/^export async function (\w+)/gm)];
  return marks.map((mark, i) => {
    const body = source.slice(
      mark.index,
      i + 1 < marks.length ? marks[i + 1].index : source.length,
    );
    return {
      name: mark[1],
      gated: /requireFirmMember\(\)/.test(body),
      touchesDb: DB_ACCESS.test(body),
    };
  });
}

describe('lib/import-actions.ts membership gate', () => {
  it('still parses the module into exported server actions', () => {
    // Guards against the file being reorganised into a shape these regexes no
    // longer see, which would leave the real assertion passing on an empty
    // list forever.
    const actions = exportedActions();
    expect(actions.length).toBeGreaterThanOrEqual(5);
    expect(actions.some((a) => a.touchesDb && a.gated)).toBe(true);
  });

  it('gates every action that reaches the database on requireFirmMember', () => {
    const ungated = exportedActions()
      .filter((a) => a.touchesDb && !a.gated)
      .map((a) => a.name);
    expect(ungated).toEqual([]);
  });
});
