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
 * KNOWN GAP: this reads page source and does not follow imports, so a
 * component rendered on a marketing page is outside the per-page SURFACES
 * checks unless it is also given its own row. components/EnterpriseInquiryForm.tsx
 * used to carry exactly that gold (a `bg-gold-metal` submit button, `text-gold-300`
 * labels, `focus:ring-gold-400`), found by reading the rendered page on
 * 2026-09-19 and fixed on 2026-09-19 by restyling it to the case-file roles;
 * it now has its own row below rather than being left to the import blind
 * spot again. components/SavingsCalculator.tsx (rendered by app/pricing/page.tsx)
 * was the same shape and the largest live instance of it: a `ring-gold-metal`
 * tool chip, an `accent-gold-metal` slider and a `text-gold-700` figure label,
 * found in the 2026-09-19 pricing capture as 994 pixels of #c79532. Restyled to
 * the case-file roles on 2026-09-19 and given its own row here.
 *
 * THE ONE ALLOWANCE. components/marketing/file/type.ts is one import hop from
 * all four pages and it does name the accent: the keyboard focus ring (review
 * C3) is gold, transient, and painted only while a control has focus. The
 * allowance is the FOCUS declaration and nothing else. It is cut out of the
 * source before the accent rules run, with a positive control proving the cut
 * happened, so a second accent use anywhere in that file still fails.
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

const TYPE_ROLES = 'components/marketing/file/type.ts';
const FOCUS_DECL = /export const FOCUS =[\s\S]*?;\n/;

const SURFACES: [string, number][] = [
  ['app/page.tsx', 1],
  ['app/pricing/page.tsx', 1],
  ['app/features/page.tsx', 0],
  ['app/enterprise/page.tsx', 1],
  ['components/marketing/FeatureIndex.tsx', 0],
  ['components/EnterpriseInquiryForm.tsx', 0],
  ['components/SavingsCalculator.tsx', 0],
  [TYPE_ROLES, 0],
];

describe.each(SURFACES)('%s', (rel, expected) => {
  const src = read(rel);
  // Only type.ts gets the focus-ring allowance, and only over its own FOCUS
  // declaration; every other surface is read whole.
  const outsideFocus = rel === TYPE_ROLES ? src.replace(FOCUS_DECL, '') : src;
  it(`spends the accent ${expected} time(s), and only through Stamp`, () => {
    expect(spends(src)).toBe(expected);
    if (rel === TYPE_ROLES) {
      expect(outsideFocus.length, 'the FOCUS allowance matched nothing').toBeLessThan(src.length);
      expect(src, 'FOCUS no longer paints the ring').toMatch(/focus-visible:ring-accent/);
    }
    expect(outsideFocus).not.toMatch(/\b(?:bg|text|ring|border|from|via|to)-accent\b/);
  });
  it('carries no gold of its own', () => {
    expect(outsideFocus).not.toMatch(/\b(?:bg|text|ring|border|from|via|to)-(?:gold|amber)-[a-z0-9]+/);
    expect(outsideFocus).not.toMatch(/gold-metal|gold-shine|gold-pan/);
    for (const hex of ['#d5bb7e', '#c2a66a', '#f2d896', '#e5c07c', '#b08229', '#d4a14a', '#c79532']) {
      expect(outsideFocus.toLowerCase()).not.toContain(hex);
    }
    expect(outsideFocus).not.toMatch(/#[0-9a-fA-F]{6}\b/);
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
    // The `lg:col-span-7` that used to be spelled here went with the cover's
    // twelve track grid: eleven gutters at gap-14 left each track 14.3px, so
    // the spans never delivered 7 and 5 and the sheet beside this column cut
    // every exhibit name. min-w-0, which is the claim, is unchanged.
    expect(fn('Cover')).toMatch(/Left: editorial copy block[\s\S]{0,80}className="min-w-0"/);
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
