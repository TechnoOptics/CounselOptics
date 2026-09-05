import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * The home cover, held to the case-file spec: the accent makes exactly one
 * claim on the page and it is the hearing stamp; the headline is Caslon,
 * never italic, never gold; the copy column can shrink; the page owns the
 * one motion. Replaces tests/hero-accent-discipline.test.ts, whose hero
 * this cover replaces. Reads comment-stripped source and asserts calls and
 * classes, not names in prose.
 */
const ROOT = join(__dirname, '..');
const PAGE = stripComments(readFileSync(join(ROOT, 'app/page.tsx'), 'utf8'));

function fn(name: string): string {
  const start = PAGE.search(new RegExp(`^function ${name}\\b`, 'm'));
  expect(start, `${name} is not a top-level function`).toBeGreaterThan(-1);
  const rest = PAGE.slice(start + 1);
  const next = rest.search(/^(?:export )?(?:async )?function \w/m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('the cover spends the accent once, on the stamp', () => {
  it('renders exactly one Stamp on the whole page, inside Cover', () => {
    expect(PAGE.match(/<Stamp\b/g)?.length).toBe(1);
    expect(fn('Cover')).toMatch(/<Stamp\b/);
  });
  it('carries no other gold anywhere on the page', () => {
    expect(PAGE).not.toMatch(/\b(?:bg|text|ring|border|from|via|to)-gold-[a-z0-9]+/);
    expect(PAGE).not.toMatch(/gold-metal|gold-shine|gold-pan/);
    for (const hex of ['#d5bb7e', '#c2a66a', '#f2d896', '#e5c07c', '#b08229', '#d4a14a', '#c79532']) {
      expect(PAGE.toLowerCase()).not.toContain(hex);
    }
    expect(PAGE).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });
});

describe('the headline', () => {
  it('is set with the shared H1 role and is never italic', () => {
    expect(fn('Cover')).toMatch(/<h1 className=\{H1\}>/);
    expect(PAGE).not.toMatch(/\bitalic\b/);
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
