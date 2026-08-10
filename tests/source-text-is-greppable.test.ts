import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * No tracked source file may contain a raw NUL byte.
 *
 * This is not a style rule. A NUL anywhere in a file makes grep, ripgrep and
 * git diff treat the WHOLE file as binary: grep then prints "binary file
 * matches" at best and, with the flags most tooling uses, silently reports
 * nothing at all. Every shell-based check over that file returns zero hits and
 * reads as a pass. Four files in this repo carried one, three of them source
 * that the guards in tests/ and scripts/test/ read as text:
 *
 *   lib/document-layout.ts, lib/letterhead-design.ts  a control-character
 *     class written with the raw characters instead of escapes
 *   app/counsel/forms/forms-manage-client.tsx  a raw NUL as a join separator
 *   tests/accent-text.test.ts  a raw NUL as a composite-key separator
 *
 * Every one of those was deliberate, and every one of them still reads exactly
 * the same when written as an escape, so nothing is given up by requiring
 * the escape. What is gained is that a text tool cannot go quiet over the file.
 *
 * The file list is walked from the tree rather than written out, so a new
 * directory is covered the day it appears.
 */

const root = fileURLToPath(new URL('../', import.meta.url));
const ROOTS = ['app', 'components', 'lib', 'scripts', 'supabase', 'tests', 'types'];
const TEXT = /\.(ts|tsx|mjs|js|jsx|css|sql|json|md)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (TEXT.test(entry.name)) out.push(full);
  }
  return out;
}

const FILES = ROOTS.flatMap((r) => walk(join(root, r)));

describe('source text stays greppable', () => {
  /**
   * The anti-vacuity floor. If the walk ever resolves to nothing, or to a
   * handful of files, the sweep below iterates almost nothing and passes
   * without measuring anything. The repo has well over a thousand today.
   */
  it('walks the whole tree, not a fragment of it', () => {
    expect(FILES.length).toBeGreaterThan(800);
    expect(FILES.some((f) => f.endsWith('lib/document-layout.ts'))).toBe(true);
    expect(FILES.some((f) => f.endsWith('app/counsel/forms/forms-manage-client.tsx'))).toBe(
      true,
    );
  });

  it('has no raw NUL byte in any source file', () => {
    const offenders = FILES.filter((f) => readFileSync(f).includes(0)).map((f) =>
      f.slice(root.length),
    );
    expect(offenders).toEqual([]);
  });
});
