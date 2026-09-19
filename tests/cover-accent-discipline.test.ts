import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * One gold per page, and only through Stamp.
 *
 * Spec section 8 asks for this guard to be "kept and extended to the
 * pricing and enterprise covers". It used to read app/page.tsx only, with
 * a partial copy of the gold rule in tests/firm-front-door.test.ts and
 * another in tests/schedule-of-fees.test.ts; three owners of one rule is
 * how a rule drifts, so all four marketing pages are held here and those
 * two files keep only their own page-specific assertions.
 *
 * Reads comment-stripped source and asserts calls and classes, not names
 * in prose. Replaces tests/hero-accent-discipline.test.ts, whose hero this
 * cover replaces.
 *
 * KNOWN GAP, found by reading the rendered page on 2026-09-19 and left for
 * the owner: this reads page source and does not follow imports, so a
 * component rendered on a marketing page is outside it. One does carry its
 * own gold today. components/EnterpriseInquiryForm.tsx paints a
 * `bg-gold-metal` submit button ("Request a walkthrough", measured
 * rgb(199,149,50) over a gold gradient), `text-gold-300` field labels and
 * `focus:ring-gold-400`, which makes /enterprise spend the accent twice and
 * contradicts the spec's "Buttons are ink on paper (or cream on forest),
 * never gold". It is pre-existing rather than new on this branch and
 * restyling a lead-generation form is an owner's call, so it is written
 * down here rather than left true by omission.
 */
const ROOT = join(__dirname, '..');
const read = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'));
const PAGE = read('app/page.tsx');

/**
 * How many times a file spends the accent. The pricing page never writes
 * `<Stamp>`: it hands Schedule a `stamp={...}` prop, which is the same
 * single claim on the reader's eye and has to count as one.
 */
const spends = (src: string) =>
  (src.match(/<Stamp\b/g)?.length ?? 0) + (src.match(/\bstamp=\{/g)?.length ?? 0);

const SURFACES: [string, number][] = [
  ['app/page.tsx', 1],
  ['app/pricing/page.tsx', 1],
  ['app/features/page.tsx', 0],
  ['app/enterprise/page.tsx', 1],
  ['components/marketing/FeatureIndex.tsx', 0],
];

describe.each(SURFACES)('%s', (rel, expected) => {
  const src = read(rel);
  it(`spends the accent ${expected} time(s), and only through Stamp`, () => {
    expect(spends(src)).toBe(expected);
    expect(src).not.toMatch(/\b(?:bg|text|ring|border|from|via|to)-accent\b/);
  });
  it('carries no gold of its own', () => {
    expect(src).not.toMatch(/\b(?:bg|text|ring|border|from|via|to)-(?:gold|amber)-[a-z0-9]+/);
    expect(src).not.toMatch(/gold-metal|gold-shine|gold-pan/);
    for (const hex of ['#d5bb7e', '#c2a66a', '#f2d896', '#e5c07c', '#b08229', '#d4a14a', '#c79532']) {
      expect(src.toLowerCase()).not.toContain(hex);
    }
    expect(src).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });
  it('never sets the display face in italic', () => {
    expect(src).not.toMatch(/\bitalic\b/);
  });
});

function fn(name: string): string {
  const start = PAGE.search(new RegExp(`^function ${name}\\b`, 'm'));
  expect(start, `${name} is not a top-level function`).toBeGreaterThan(-1);
  const rest = PAGE.slice(start + 1);
  const next = rest.search(/^(?:export )?(?:async )?function \w/m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('the home cover', () => {
  it("is where the page's one Stamp lives", () => {
    expect(fn('Cover')).toMatch(/<Stamp\b/);
  });
});

describe('the headline', () => {
  it('is set with the shared H1 role', () => {
    expect(fn('Cover')).toMatch(/<h1 className=\{H1\}>/);
    expect(PAGE).not.toMatch(/font-display|font-serif|font-sans/);
  });
  it('keeps the copy column shrinkable', () => {
    expect(fn('Cover')).toMatch(/Left: editorial copy block[\s\S]{0,80}className="min-w-0 lg:col-span-7"/);
  });
});

describe('the one motion', () => {
  it('is the cover sheet and nothing else', () => {
    expect(PAGE.match(/assemble\b/g)?.length).toBe(1);
    expect(fn('Cover')).toMatch(/<Sheet[^>]*\bassemble\b/);
    expect(PAGE).not.toMatch(/animate-fade-up|stagger|cv-auto|gold-pan/);
  });
});

describe('what the page no longer carries', () => {
  it('imports none of the retired sections', () => {
    for (const name of [
      'AudienceSplit', 'FeatureGallery', 'TestimonialMarquee', 'TechTrustStrip', 'SectionPhoto',
      'BrowserFrame', 'ProductShowcaseBand', 'ApprovalToExecuted', 'BellaAvatar', 'AboutTeaser',
    ]) {
      expect(PAGE, `${name} should be gone from the home page`).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
  it('feeds the FAQ list and the JSON-LD from one shared array', () => {
    expect(PAGE).toMatch(/^import \{ HOME_FAQ \} from '@\/lib\/home-faq';/m);
    expect(PAGE).toMatch(/<FaqJsonLd questions=\{HOME_FAQ\}/);
    expect(PAGE).toMatch(/HOME_FAQ\.map\(/);
  });
});
