import { describe, it, expect } from 'vitest';
import { publishedOffers, publishedPriceRange } from '@/lib/published-pricing';
import { PERSONAL_TIERS } from '@/lib/personal-tiers';
import { FIRM_TIER_PRICING } from '@/lib/firm-pricing';

/**
 * Published prices must equal the shipped ladder.
 *
 * This exists because they did not. The JSON-LD advertised "Personal Pro
 * $19" and "Personal Plus $29" while the shipped consumer ladder was
 * Free / Starter $19 / Plus $29 / Pro $59 / Ultra $99. Both published
 * names were wrong, the two most expensive real tiers were absent from
 * the SERP, and the aggregate claimed 6 offers against 9 real tiers with
 * a description that contradicted its own lowPrice.
 *
 * The assertions below are deliberately written against the tier
 * modules, not against a second hand-written list of expected numbers.
 * A copy of the expected values here would be a fourth place to drift.
 */
describe('published pricing', () => {
  it('publishes every fixed-price tier, and only real ones', () => {
    const published = publishedOffers();

    const expected = [
      ...PERSONAL_TIERS.filter((t) => t.priceUsd > 0).map((t) => ({
        name: `Personal ${t.name}`,
        priceUsd: t.priceUsd,
      })),
      ...Object.values(FIRM_TIER_PRICING)
        .filter((t) => t.pricePerUserMonth !== null)
        .map((t) => ({
          name: `Counsel ${t.name}`,
          priceUsd: t.pricePerUserMonth as number,
        })),
    ];

    expect(published).toEqual(expected);
  });

  it('names no tier that does not exist', () => {
    const realNames = new Set([
      ...PERSONAL_TIERS.map((t) => `Personal ${t.name}`),
      ...Object.values(FIRM_TIER_PRICING).map((t) => `Counsel ${t.name}`),
    ]);
    for (const offer of publishedOffers()) {
      expect(realNames.has(offer.name)).toBe(true);
    }
  });

  it('omits no paid consumer tier', () => {
    const publishedNames = publishedOffers().map((o) => o.name);
    for (const tier of PERSONAL_TIERS.filter((t) => t.priceUsd > 0)) {
      expect(publishedNames).toContain(`Personal ${tier.name}`);
    }
  });

  it('counts every tier a buyer can land on, including Free and Enterprise', () => {
    const { offerCount } = publishedPriceRange();
    expect(offerCount).toBe(
      PERSONAL_TIERS.length + Object.keys(FIRM_TIER_PRICING).length,
    );
  });

  it('spans the real price range', () => {
    const { lowPrice, highPrice } = publishedPriceRange();
    const firmTiers = Object.values(FIRM_TIER_PRICING);
    const everyPrice = [
      ...PERSONAL_TIERS.map((t) => t.priceUsd),
      ...firmTiers.map((t) => t.pricePerUserMonth ?? t.enterpriseFromPrice ?? 0),
    ];
    expect(lowPrice).toBe(Math.min(...everyPrice));
    expect(highPrice).toBe(Math.max(...everyPrice));
    // No published offer may sit outside the advertised aggregate range.
    for (const offer of publishedOffers()) {
      expect(offer.priceUsd).toBeGreaterThanOrEqual(lowPrice);
      expect(offer.priceUsd).toBeLessThanOrEqual(highPrice);
    }
  });
});
