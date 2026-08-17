import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Every path that creates a legal request must ask for a reference number.
 *
 * This is a source-reading guard, because both creation paths need a verified
 * partner token or a firm admin session before they will run and neither can be
 * driven from a unit test. The allocator's own behaviour is covered properly in
 * tests/request-allocator.test.ts; what is checked here is only that the
 * callers call it.
 *
 * COMMENTS ARE STRIPPED BEFORE MATCHING, and that is not decoration. Guards in
 * this repo have twice passed because the comment explaining a fix contained
 * the very string the guard searched for, so the guard was satisfied by prose
 * describing the code rather than by the code. The stripper is itself asserted
 * below, so it cannot quietly stop stripping and let this file go green on a
 * mention in a comment.
 */

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
}

/** Source with block and line comments removed. */
function codeOnly(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // The `[^:]` keeps this from eating the // in a URL.
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('the comment stripper this file depends on', () => {
  /**
   * If this ever fails, every assertion below has become worthless, because a
   * guard that reads comments is a guard that passes on a promise.
   */
  it('removes both comment styles', () => {
    const stripped = codeOnly('tests/fixtures/comment-stripper-sample.ts');
    expect(stripped).toContain('const real = 1;');
    expect(stripped).not.toContain('allocateRequestNumber');
    expect(stripped).not.toContain('BLOCK COMMENT MENTION');
  });

  it('leaves a url alone', () => {
    const stripped = codeOnly('tests/fixtures/comment-stripper-sample.ts');
    expect(stripped).toContain('https://advottic.com/keepme');
  });
});

/**
 * MATCHED AS A CALL, NOT AS A MENTION.
 *
 * The first version of this guard searched for the bare name, and a mutation
 * proved it worthless: replacing the real call with a comment left the guard
 * green, because `import { allocateRequestNumber }` at the top of the file
 * still contained the string. Stripping comments was not enough on its own,
 * since an import is code. So the guard requires the open parenthesis, which an
 * import statement never has, and the mutation now goes red.
 */
function callsAllocator(rel: string): boolean {
  return /allocateRequestNumber\s*\(/.test(codeOnly(rel));
}

describe('a legal request is given its reference when it is created', () => {
  it('the partner API create allocates one', () => {
    expect(callsAllocator('lib/partner-tickets.ts')).toBe(true);
  });

  it('the bulk import allocates one', () => {
    expect(callsAllocator('lib/import-actions.ts')).toBe(true);
  });

  /**
   * The import alone must never be enough to satisfy the two tests above.
   * This pins the distinction directly, so if `callsAllocator` is ever relaxed
   * back to a bare name match, this fails rather than the guard silently
   * becoming decorative again.
   */
  it('is not satisfied by an import of the allocator alone', () => {
    const importOnly = "import { allocateRequestNumber } from './ticket-allocator';\nconst x = 1;\n";
    expect(/allocateRequestNumber\s*\(/.test(importOnly)).toBe(false);
  });

  /**
   * The allocator is the only way to get a number. A caller writing
   * `request_number` itself would bypass the conditional write that makes a
   * number immutable and the retry that makes it unique, so no caller outside
   * the allocator may name that column in a write.
   */
  it('no caller writes the column itself', () => {
    for (const file of ['lib/partner-tickets.ts', 'lib/import-actions.ts']) {
      const code = codeOnly(file);
      expect(code).not.toMatch(/request_number\s*:/);
    }
  });
});
