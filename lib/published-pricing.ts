import { PERSONAL_TIERS } from './personal-tiers';
import { FIRM_TIER_PRICING } from './firm-pricing';

/**
 * Every price Advottic publishes to the outside world, derived from the
 * two pricing modules rather than retyped beside them.
 *
 * This module exists because the same price was hand-maintained in three
 * places and they disagreed. The JSON-LD on the home page advertised
 * "Personal Pro $19" and "Personal Plus $29"; the shipped consumer
 * ladder is Free / Starter $19 / Plus $29 / Pro $59 / Ultra $99. So both
 * published names named a tier that does not exist, the two most
 * expensive real tiers were missing from the SERP entirely, and the
 * /pricing aggregate declared offerCount 6 against 9 real tiers with a
 * description ("from $19/month") that contradicted its own lowPrice of
 * 0. /llms-full.txt, which AI assistants quote verbatim, repeated the
 * same two invented tiers.
 *
 * lib/personal-tiers.ts and lib/firm-pricing.ts are the source of truth.
 * Anything published reads from here.
 *
 * Guards: tests/published-pricing.test.ts pins these values to the tier
 * modules, and scripts/test/published-pricing-invariants.mjs fails if a
 * price literal is typed back into a publishing surface.
 */
export type PublishedOffer = { name: string; priceUsd: number };

/** The individually published offers: every tier that has a fixed price. */
export function publishedOffers(): PublishedOffer[] {
  const personal = PERSONAL_TIERS.filter((t) => t.priceUsd > 0).map((t) => ({
    name: `Personal ${t.name}`,
    priceUsd: t.priceUsd,
  }));
  const firm = Object.values(FIRM_TIER_PRICING)
    .filter((t) => t.pricePerUserMonth !== null)
    .map((t) => ({
      name: `Counsel ${t.name}`,
      priceUsd: t.pricePerUserMonth as number,
    }));
  return [...personal, ...firm];
}

/**
 * The AggregateOffer numbers. Counts every tier a buyer can land on,
 * including Free and including Enterprise, which contributes its
 * published "From" floor as the top of the range.
 */
export function publishedPriceRange(): {
  offerCount: number;
  lowPrice: number;
  highPrice: number;
} {
  const firmTiers = Object.values(FIRM_TIER_PRICING);
  const prices = [
    ...PERSONAL_TIERS.map((t) => t.priceUsd),
    ...firmTiers.map((t) => t.pricePerUserMonth ?? t.enterpriseFromPrice ?? 0),
  ];
  return {
    offerCount: PERSONAL_TIERS.length + firmTiers.length,
    lowPrice: Math.min(...prices),
    highPrice: Math.max(...prices),
  };
}

/** "$1,800" - the way a price is written in prose and in tables. */
export function formatUsd(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}
