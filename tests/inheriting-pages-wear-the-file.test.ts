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
  it('leaves behind no empty header landmark', () => {
    // Moving each page's hero into Prose left five pages with a literally
    // empty <header>, a dead landmark still contributing pt-2 / pt-4 sm:pt-8
    // of phantom space and, on two of them, a text-center wrapping nothing.
    expect(src).not.toMatch(/<header[^>]*>\s*<\/header>/);
  });
});

describe('app/status/page.tsx', () => {
  const src = stripComments(readFileSync(join(ROOT, 'app/status/page.tsx'), 'utf8'));
  it('sets the status as body, not as the display headline', () => {
    // docs/DESIGN.md: "A status is not a headline. Headline type is for names
    // of things. Sentences are body." The same file lists a status sentence
    // set as a headline among the seven defects that shipped green.
    const title = /<Prose[\s\S]*?\btitle=(\{[\s\S]*?\}|"[^"]*")/.exec(src)?.[1] ?? '';
    expect(title, 'the Prose title is gone').toBeTruthy();
    expect(title).not.toMatch(/All systems operational|degraded|Unable to probe/);
    expect(src).toMatch(/All systems operational/);
  });
  it('keeps the live dot beside the sentence it belongs to', () => {
    expect(src).toMatch(/animate-ping[\s\S]{0,900}All systems operational/);
  });
});

describe('components/marketing/file/Prose.tsx', () => {
  const src = stripComments(readFileSync(join(ROOT, 'components/marketing/file/Prose.tsx'), 'utf8'));
  it('excludes button classes from the descendant-link underline', () => {
    // Regression: Prose's [&_a]:underline selector used to underline every
    // descendant link, including the btn-primary/btn-secondary CTAs that
    // about, compare and press nest inside it.
    const underlineSelector = src.match(/\[&_a[^\]]*\]:underline\b/)?.[0] ?? '';
    expect(underlineSelector).toContain(':not(.btn-primary)');
  });
  it('carries the same exclusion on the underline-offset selector', () => {
    const offsetSelector = src.match(/\[&_a[^\]]*\]:underline-offset-4\b/)?.[0] ?? '';
    expect(offsetSelector).toContain(':not(.btn-primary)');
  });
});

describe('app/security/page.tsx sub-processor table', () => {
  it('wraps the table in a scrollable container', () => {
    const src = stripComments(readFileSync(join(ROOT, 'app/security/page.tsx'), 'utf8'));
    expect(src).toMatch(/<div className="overflow-x-auto">\s*<table/);
  });
});

/**
 * N5-3. Prose.tsx:59 carries `[&_.eyebrow:has(+h2)]:mt-12` and
 * `[&_.eyebrow+h2]:mt-0` so a `.eyebrow` kicker takes the block's top
 * margin instead of the h2 it names. The class-list pin on Prose (above)
 * only sees that those selectors exist, not that the pages which rely on
 * them still put the kicker paragraph directly in front of its h2. Of the
 * fourteen pages this file covers, only about and security use the
 * `.eyebrow` shape (each via its own page-local `Section` helper); guides
 * and changelog use a different kicker (a category/date row inside the
 * `<li>`, already spaced by the list's own `space-y`) and are not this
 * rule's concern. If a page-local Section helper grows a wrapper between
 * the `<p className="eyebrow">` and its `<h2>`, N4-1's inversion (48px of
 * space stranded on the block above instead of sitting on the heading)
 * returns silently, because nothing else here reads that adjacency.
 */
const EYEBROW_H2_PAGES = ['about', 'security'];

describe.each(EYEBROW_H2_PAGES)('app/%s/page.tsx kicker', (p) => {
  const src = stripComments(readFileSync(join(ROOT, `app/${p}/page.tsx`), 'utf8'));
  it('the eyebrow paragraph is immediately followed by the h2 it names', () => {
    expect(src).toMatch(/<p className="eyebrow[^"]*">\{eyebrow\}<\/p>[\s}]*<h2\b/);
  });
});
