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
describe.each(FILES)('%s', (rel) => {
  const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
  it('never reaches for Fraunces, Inter, a serif or a mono class', () => {
    expect(src).not.toMatch(/\bfont-(?:display|sans|serif|mono|wordmark)\b/);
  });
  it('uses at least one of the four roles', () => {
    expect(src).toMatch(/font-(?:caslon|caslon-text|public|courier)|\b(?:H1|H2|BODY|LABEL)\b/);
  });
});
