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
    // The gold rule itself lives in tests/cover-accent-discipline.test.ts,
    // which holds all four marketing pages to it.
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
  /**
   * N5. This used to ban the middle dot on an inheriting tier, which is the
   * glyph the broken derivation produced; no cell is a middle dot any more,
   * so that assertion guarded a shape the code no longer uses and a plain
   * `No` in the same place (the same lie in different punctuation) passed.
   *
   * The positive property instead: a tier that says "Everything in X, plus"
   * never offers LESS than X on any row. Strength order, smallest first:
   *
   *   withheld (`No`, and the old middle dot) = 0
   *   granted (`Yes`, `Alerts`, a count, a name) = 1
   *   `With SMS` = 2
   *
   * Only Safe Witness is graded (No < Alerts < With SMS); every other row
   * either withholds a feature or grants it, so the fallback is coarse on
   * purpose: it cannot rank `50` against `100`, and it does not try to. It
   * catches the one thing that is a lie, a tier that inherits and then
   * withholds, and it still catches the middle dot because the dot is a
   * withholding.
   */
  /**
   * The tier a tier says it inherits, read off its own features[] prose, or
   * null when it claims no inheritance. "Everything in X, plus" is how the
   * marketing copy states it and X is the tier's name verbatim.
   */
  const parentNamed = (tier: { features: readonly string[] }) => {
    for (const f of tier.features) {
      const m = /^Everything in (.+?), plus/i.exec(f);
      if (m) return m[1];
    }
    return null;
  };

  const MIDDLE_DOT = '·';
  const WITHHELD = new Set(['No', MIDDLE_DOT, '-']);
  const GRADED = ['No', 'Alerts', 'With SMS'];
  const strength = (cell: string) => {
    const c = cell.trim();
    if (WITHHELD.has(c)) return 0;
    const graded = GRADED.indexOf(c);
    return graded > -1 ? graded : 1;
  };
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

  it('positive control: the strength order ranks withheld below granted', () => {
    expect(strength('No')).toBe(0);
    expect(strength(MIDDLE_DOT)).toBe(0);
    expect(strength('Yes')).toBe(1);
    expect(strength('Alerts')).toBe(1);
    expect(strength('With SMS')).toBe(2);
  });

  it('positive control: the parent is read out of the inheritance line', () => {
    expect(parentNamed({ features: ['Everything in Growing Firm, plus:'] })).toBe('Growing Firm');
    expect(parentNamed({ features: ['everything in Starter, plus'] })).toBe('Starter');
    expect(parentNamed({ features: ['Two cases', 'Bella from Plus'] })).toBe(null);
  });

  it.each(audiences)(
    '%s: a tier that inherits another never offers less than it on any row',
    (_name, tiers, rows) => {
      // N3-5. This used to compare against tiers[i - 1] and assume the tier
      // named in the line was the adjacent one: a line naming a non-adjacent
      // tier would have been silently graded against the wrong column, and a
      // tier at index 0 declaring inheritance would have thrown on
      // tiers[-1].name instead of failing with a message. The name is parsed
      // out of the line now and the parent is looked up by it.
      const inheriting = tiers
        .map((tier, i) => ({ tier, i, parent: parentNamed(tier) }))
        .filter((e) => e.parent !== null);
      expect(inheriting.length, 'no tier expresses inheritance any more').toBeGreaterThan(0);
      for (const { tier, i, parent } of inheriting) {
        const p = tiers.findIndex((t) => t.name === parent);
        expect(
          p,
          `${tier.name} says it inherits "${parent}", which is not a tier on this schedule`,
        ).toBeGreaterThan(-1);
        for (const row of rows) {
          expect(
            strength(row.cells[i]),
            `${tier.name} inherits ${parent}, but "${row.label}" drops from ` +
              `"${row.cells[p]}" to "${row.cells[i]}"`,
          ).toBeGreaterThanOrEqual(strength(row.cells[p]));
        }
      }
    },
  );

  /**
   * N1. Two firm cells are the only ones in either matrix that neither
   * lib/firm-pricing.ts nor the tier's own features[] states: Enterprise's
   * "Firm letterhead on PDFs" and "Employee Hub". Both are true, and this
   * page says so itself: the FAQ at app/pricing/page.tsx answers "Firm
   * letterhead on every generated PDF" and "Employee Hub" with "Small Firm
   * and up". What makes them derived rather than asserted is Enterprise's
   * own inheritance line, which is what puts them under the assertion above.
   */
  it('sources every repeated Enterprise cell through an inheritance line', () => {
    // N3-5. The exact list of repeated labels used to be pinned here, which
    // would have turned red on any future row that legitimately repeats
    // (a Yes on both columns) with a message about sourcing that does not
    // explain that failure. What the test is for is the sourcing, so that
    // is all it asserts now, and its message names the repeats it found.
    const [growing, enterprise] = FIRM_TIERS.slice(-2);
    expect([growing.name, enterprise.name]).toEqual(['Growing Firm', 'Enterprise']);
    const gi = FIRM_TIERS.indexOf(growing);
    const ei = FIRM_TIERS.indexOf(enterprise);
    const repeats = FIRM_ROWS.filter((r) => r.cells[ei] === r.cells[gi]).map((r) => r.label);
    expect(
      repeats.length,
      `no ${enterprise.name} cell repeats ${growing.name} any more, so this test guards nothing`,
    ).toBeGreaterThan(0);
    expect(
      parentNamed(enterprise),
      `${repeats.join(' and ')} repeat ${growing.name}'s cell on ${enterprise.name}, and only ` +
        `${enterprise.name}'s own features[] can source that`,
    ).toBe(growing.name);
  });

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
