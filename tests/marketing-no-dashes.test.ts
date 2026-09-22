import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No em dash, en dash, curly quote or emoji in marketing source. The
 * positive control proves the pattern matches; three silent no-match sweeps
 * have shipped.
 *
 * The curly quotes joined the pattern for N7: review round 2 found a
 * typographic apostrophe on the enterprise page (M11), it was fixed by hand,
 * and nothing stopped the next one on a file list that had just grown. The
 * codepoints are written as escapes so this file stays ASCII and cannot fail
 * its own sweep.
 */
const ROOT = join(__dirname, '..');
const PATTERN = /[\u2013\u2014\u2018\u2019\u201c\u201d]|[\u{1F300}-\u{1FAFF}]/u;
/**
 * N4-2. The same characters, written as HTML entities, are invisible to a
 * codepoint sweep, and four of the fourteen pages the round-4 extension
 * added were green while rendering typographic quotes. The entity forms are
 * a separate pattern rather than an arm of PATTERN so a failure names which
 * spelling was found.
 */
const ENTITIES = /&[lr](?:squo|dquo);|&#8216;|&#8217;|&#8220;|&#8221;/;
const FILES = [
  'app/page.tsx', 'app/pricing/page.tsx', 'app/features/page.tsx', 'app/enterprise/page.tsx',
  'components/marketing/FeatureIndex.tsx', 'components/EnterpriseSectorTabs.tsx',
  'components/marketing/file/type.ts', 'components/marketing/file/Section.tsx',
  'components/marketing/file/Sheet.tsx', 'components/marketing/file/Definitions.tsx',
  'components/marketing/file/Schedule.tsx', 'components/marketing/file/FilePage.tsx',
  'components/marketing/file/Prose.tsx', 'components/marketing/file/Memo.tsx',
  'components/marketing/file/Entry.tsx', 'components/EnterpriseInquiryForm.tsx',
  'components/SavingsCalculator.tsx',
  /**
   * N3-4. The four redesigned pages were the whole list, so the sweep did
   * not reach the copy Prose wraps: the about h1 carried a typographic
   * apostrophe, and so did the compare lede and three lines of
   * what-is-advottic. These are the fourteen pages
   * tests/inheriting-pages-wear-the-file.test.ts holds, in its order, and
   * the two lists have to grow together.
   */
  ...[
    'about', 'what-is-advottic', 'security', 'guides', 'glossary', 'compare', 'press',
    'changelog', 'status', 'accessibility', 'terms', 'privacy', 'cookies', 'dmca',
  ].map((p) => `app/${p}/page.tsx`),
  /**
   * N4-2, second half. The listed pages render copy they import, so a data
   * module is as much marketing source as the page is: changelog entries and
   * glossary definitions each carried a literal U+2019 outside the sweep.
   *
   * N5-2. `lib/comparisons.ts` (/compare) and `lib/guides.ts` (/guides) are
   * the same shape as the two above and were left out when this half of the
   * array was added; both were clean, which is why the gap went unnoticed.
   */
  'lib/changelog.ts', 'lib/glossary.ts', 'lib/comparisons.ts', 'lib/guides.ts',
];
describe('the dash sweep', () => {
  it('positive control: the pattern matches', () => {
    expect(PATTERN.test('a \u2014 b')).toBe(true);
    expect(PATTERN.test('a \u2013 b')).toBe(true);
    expect(PATTERN.test('it\u2019s')).toBe(true);
    expect(PATTERN.test('\u2018quoted\u2019')).toBe(true);
    expect(PATTERN.test('\u201cquoted\u201d')).toBe(true);
    expect(PATTERN.test('\u{1F600}')).toBe(true);
  });
  it('positive control: the entity pattern matches every spelling', () => {
    for (const e of ['&rsquo;', '&lsquo;', '&rdquo;', '&ldquo;',
      '&#8216;', '&#8217;', '&#8220;', '&#8221;']) {
      expect(ENTITIES.test(`it${e}s`), e).toBe(true);
    }
    expect(ENTITIES.test('&amp; &rarr; &nbsp;')).toBe(false);
  });
  it.each(FILES)('%s is clean', (rel) => {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    expect(src).not.toMatch(PATTERN);
    expect(src).not.toMatch(ENTITIES);
  });
});
