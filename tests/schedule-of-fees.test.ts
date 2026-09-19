import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONSUMER_ROWS, CONSUMER_TIERS, FIRM_ROWS, FIRM_TIERS } from '../app/pricing/schedule';
import { FIRM_TIER_PRICING } from '../lib/firm-pricing';
import { PERSONAL_TIERS } from '../lib/personal-tiers';
import { stripComments } from './support/strip-comments';

/**
 * Pricing is a schedule of fees: two ruled tables built from the tier
 * arrays that already existed, one stamp, the iOS branch untouched.
 */
const ROOT = join(__dirname, '..');
const PAGE = stripComments(readFileSync(join(ROOT, 'app/pricing/page.tsx'), 'utf8'));
const DATA = stripComments(readFileSync(join(ROOT, 'app/pricing/schedule.ts'), 'utf8'));

describe('the schedule', () => {
  it('renders both audiences through Schedule from the existing tier arrays', () => {
    expect(PAGE.match(/<Schedule\b/g)?.length).toBe(2);
    expect(PAGE).toMatch(/columns=\{CONSUMER_TIERS\.map\(tierToColumn\)\}/);
    expect(PAGE).toMatch(/columns=\{FIRM_TIERS\.map\(tierToColumn\)\}/);
  });
  it('puts the one stamp on Pro', () => {
    expect(PAGE.match(/stampOn=/g)?.length).toBe(1);
    expect(PAGE).toMatch(/stampOn="pro"/);
    expect(PAGE).not.toMatch(/\b(?:bg|text|ring|border)-gold-|gold-metal|amber-/);
  });
  it('keeps the iOS branch that renders nothing purchasable', () => {
    expect(PAGE).toMatch(/serverPlatform === 'ios'/);
    expect(PAGE).toMatch(/href="\/gift"[^>]*data-hide-on-ios|data-hide-on-ios[^>]*href="\/gift"/);
  });
  it('gives every section a heading, so the FAQ h3s are not orphaned', () => {
    // Section renders its Courier label as a div, which is right visually
    // but leaves a section with no h2 out of a screen reader's heading
    // list; on this page it also meant the eleven FAQ h3s sat under the
    // gift block's h2, two sections above them.
    for (const label of ['For one person', 'For firms', 'Frequently asked']) {
      const section = PAGE.slice(PAGE.indexOf(`label="${label}"`));
      expect(
        section.slice(0, section.indexOf('</Section>')),
        `the "${label}" section has no heading`,
      ).toMatch(/<h2[^>]*>/);
    }
  });
  it('no longer ships cards, the partner strip or a gold button', () => {
    expect(PAGE).not.toMatch(/TechTrustStrip|TierCard|className="card|btn-primary|rounded-2xl|rounded-3xl/);
  });
});

/**
 * C1. The table used to derive each cell by substring-matching a row label
 * against a tier's marketing `features[]`. Inheritance is expressed there as
 * prose ("Everything in Starter, plus:"), which a matcher cannot read, so
 * every inherited feature rendered as a middle dot meaning "not included" and
 * the public page stated that Plus, Pro and Ultra lose court-ready export,
 * Safe Witness, e-sign and priority support. The matrices are declared
 * literally now, and these assertions hold them to the tier data rather than
 * to the prose.
 */
describe('the matrices say what each tier actually includes', () => {
  const MIDDLE_DOT = '·';
  const audiences: [string, typeof CONSUMER_TIERS, typeof CONSUMER_ROWS][] = [
    ['consumer', CONSUMER_TIERS, CONSUMER_ROWS],
    ['firm', FIRM_TIERS, FIRM_ROWS],
  ];

  it('is declared, not derived from a substring match on the feature prose', () => {
    expect(PAGE + DATA).not.toMatch(/featureRows/);
    expect(DATA).toMatch(/const CONSUMER_ROWS: ScheduleRow\[\]/);
    expect(DATA).toMatch(/const FIRM_ROWS: ScheduleRow\[\]/);
  });

  it.each(audiences)('%s: one filled cell per tier on every row', (_name, tiers, rows) => {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.cells.length, `${row.label} does not have one cell per tier`).toBe(tiers.length);
      for (const cell of row.cells) {
        expect(cell.trim().length, `${row.label} has an empty cell`).toBeGreaterThan(0);
      }
    }
  });

  it.each(audiences)(
    '%s: never prints "not included" against a tier that inherits the one below it',
    (_name, tiers, rows) => {
      const inheriting = tiers.filter((t) => t.features.some((f) => /^Everything in .+, plus/i.test(f)));
      expect(inheriting.length, 'no tier expresses inheritance any more').toBeGreaterThan(0);
      for (const tier of inheriting) {
        const i = tiers.indexOf(tier);
        for (const row of rows) {
          expect(row.cells[i], `${tier.name} inherits, but "${row.label}" says it does not`).not.toBe(
            MIDDLE_DOT,
          );
        }
      }
    },
  );

  it('reads the consumer ladder off lib/personal-tiers.ts', () => {
    const ladder = CONSUMER_TIERS.map((t) => PERSONAL_TIERS.find((p) => p.name === t.name));
    expect(ladder.every(Boolean), 'a pricing column names a tier that does not exist').toBe(true);
    const cells = (label: string) => CONSUMER_ROWS.find((r) => r.label === label)?.cells;
    const yesNo = (b: boolean) => (b ? 'Yes' : 'No');
    expect(CONSUMER_TIERS.map((t) => t.price)).toEqual(ladder.map((p) => `$${p!.priceUsd}`));
    expect(cells('Cases')).toEqual(ladder.map((p) => String(p!.caseLimit)));
    expect(cells('Advottic Review')).toEqual(ladder.map((p) => yesNo(p!.aiReview)));
    expect(cells('Invite your law firm')).toEqual(ladder.map((p) => yesNo(p!.collaborators)));
    expect(cells('Case timeline, group cases')).toEqual(
      ladder.map((p) => yesNo(p!.timeline && p!.groupCases)),
    );
  });

  it('reads the firm seat bands off lib/firm-pricing.ts', () => {
    const order = [
      FIRM_TIER_PRICING.solo,
      FIRM_TIER_PRICING.small_firm,
      FIRM_TIER_PRICING.growing_firm,
      FIRM_TIER_PRICING.enterprise,
    ];
    expect(FIRM_TIERS.map((t) => t.name)).toEqual(order.map((t) => t.name));
    const cells = (label: string) => FIRM_ROWS.find((r) => r.label === label)?.cells;
    expect(cells('Matters per attorney')).toEqual(
      order.map((t) => (t.mattersPerAttorney === null ? 'Negotiated' : String(t.mattersPerAttorney))),
    );
  });
});
