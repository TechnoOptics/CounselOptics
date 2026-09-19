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
const FILES = [
  'app/page.tsx', 'app/pricing/page.tsx', 'app/features/page.tsx', 'app/enterprise/page.tsx',
  'components/marketing/FeatureIndex.tsx', 'components/EnterpriseSectorTabs.tsx',
  'components/marketing/file/type.ts', 'components/marketing/file/Section.tsx',
  'components/marketing/file/Sheet.tsx', 'components/marketing/file/Definitions.tsx',
  'components/marketing/file/Schedule.tsx', 'components/marketing/file/FilePage.tsx',
  'components/marketing/file/Prose.tsx', 'components/marketing/file/Memo.tsx',
  'components/marketing/file/Entry.tsx', 'components/EnterpriseInquiryForm.tsx',
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
  it.each(FILES)('%s is clean', (rel) => {
    expect(readFileSync(join(ROOT, rel), 'utf8')).not.toMatch(PATTERN);
  });
});
