import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { firmVocabulary } from '../lib/firm-vocabulary';
import { stripComments } from './support/strip-comments';

/**
 * A corporate workspace showed "Employees 1 / 1 on the books" while its
 * directory held five active people.
 *
 * The count was right and the word was wrong. /counsel/clients is the portal
 * roster; /counsel/employees is the directory. In-house vocabulary renames the
 * roster to "Employees", so the tile has to say what it is counting or it
 * reads as a headcount that disagrees with the directory next to it.
 */

describe('the headline tile says what it counts', () => {
  /** Mutation: give the corporate vocabulary "on the books". Goes red. */
  it('does not claim a corporate roster is a headcount', () => {
    expect(firmVocabulary('corporate').clientsMeasure).toBe('with portal access');
    expect(firmVocabulary('corporate').clientsMeasure).not.toContain('books');
  });

  it('keeps the law firm wording, where clients on the books is true', () => {
    expect(firmVocabulary('firm').clientsMeasure).toBe('on the books');
    expect(firmVocabulary('individual').clientsMeasure).toBe('on the books');
  });

  /**
   * The roster and the directory must not carry the same word in the same
   * rail, which is what lib/firm-vocabulary.ts already says about `directory`.
   */
  it('keeps the roster and the directory distinct in-house', () => {
    const v = firmVocabulary('corporate');
    expect(v.clients).toBe('Employees');
    expect(v.directory).not.toBe(v.clients);
  });
});

describe('the dashboard reads the measure rather than hard-coding it', () => {
  /**
   * Mutation: put the literal back in the page. Goes red.
   *
   * Comments are stripped first, so the sentence explaining this cannot
   * satisfy it.
   */
  it('renders vocab.clientsMeasure on the headline tile', () => {
    const src = stripComments(
      readFileSync(fileURLToPath(new URL('../app/counsel/page.tsx', import.meta.url)), 'utf8'),
    );
    expect(src).toContain('{vocab.clientsMeasure}');
    expect(src).not.toContain('<T>on the books</T>');
  });
});
