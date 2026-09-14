import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * Pages that are not redesigned still wear the file: the paper ground,
 * the Caslon h1, no fade-up reveal. Content is untouched, so this asserts
 * the wrapper CALL and the absence of the retired classes, nothing else.
 */
const ROOT = join(__dirname, '..');
const PAGES = [
  'about', 'what-is-advottic', 'security', 'guides', 'glossary', 'compare', 'press',
  'changelog', 'status', 'accessibility', 'terms', 'privacy', 'cookies', 'dmca',
];

describe.each(PAGES)('app/%s/page.tsx', (p) => {
  const src = stripComments(readFileSync(join(ROOT, `app/${p}/page.tsx`), 'utf8'));
  it('renders through Prose', () => {
    expect(src).toMatch(/<Prose\b[^>]*label=/);
    expect(src).toMatch(/from '@\/components\/marketing\/file'/);
  });
  it('has no scroll reveal and no display-face h1 of its own', () => {
    expect(src).not.toMatch(/animate-fade-up/);
    expect(src).not.toMatch(/<h1[^>]*font-display/);
  });
});
