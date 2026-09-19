import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/** Only the four case-file faces appear on marketing surfaces. */
const ROOT = join(__dirname, '..');
const FILES = [
  'app/page.tsx', 'app/pricing/page.tsx', 'app/features/page.tsx', 'app/enterprise/page.tsx',
  'components/marketing/FeatureIndex.tsx', 'components/EnterpriseSectorTabs.tsx',
  'components/marketing/file/type.ts', 'components/marketing/file/Section.tsx',
  'components/marketing/file/Sheet.tsx', 'components/marketing/file/Definitions.tsx',
  'components/marketing/file/Schedule.tsx', 'components/marketing/file/FilePage.tsx',
  'components/marketing/file/Prose.tsx', 'components/marketing/file/Memo.tsx',
  'components/marketing/file/Entry.tsx',
];
const PAGES = FILES.filter((f) => f.startsWith('app/'));

describe.each(FILES)('%s', (rel) => {
  const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
  it('never reaches for Fraunces, Inter, a serif or a mono class', () => {
    expect(src).not.toMatch(/\bfont-(?:display|sans|serif|mono|wordmark)\b/);
  });
  it('uses at least one of the four roles', () => {
    expect(src).toMatch(/font-(?:caslon|caslon-text|public|courier)|\b(?:H1|H2|BODY|LABEL)\b/);
  });
});

/**
 * M1. type.ts's whole premise is that a page cannot re-spell a role. The
 * home firm band and the enterprise cover each hand-copied the display
 * class string with the ink swapped, comments saying so included, because
 * there was no cream variant to import. There is now.
 */
describe.each(PAGES)('%s', (rel) => {
  const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
  it('never spells a display headline itself', () => {
    expect(src).not.toMatch(/className="[^"]*\bfont-caslon(?!-)/);
  });
});

describe('the cream roles', () => {
  it('differ from the ink roles only in the ink', async () => {
    const t = await import('../components/marketing/file/type');
    const shape = (s: string) =>
      s
        .split(/\s+/)
        .filter((c) => !/^(?:dark:|hover:)*(?:text|decoration)-(?!\[)/.test(c))
        .join(' ');
    for (const [ink, cream] of [
      [t.H1, t.H1_CREAM],
      [t.H2, t.H2_CREAM],
      [t.BODY, t.BODY_CREAM],
      [t.LABEL, t.LABEL_CREAM],
      [t.LINK, t.LINK_CREAM],
    ] as [string, string][]) {
      expect(shape(cream)).toBe(shape(ink));
    }
  });
});
