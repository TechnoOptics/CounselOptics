/**
 * Single source of truth for Advottic Counsel (firm-tier) pricing
 * numbers - the price, seat band, and matters-per-attorney cap for
 * each tier. Previously these were hand-copied into both
 * app/pricing/page.tsx and components/SavingsCalculator.tsx with no
 * shared constant; they agreed by discipline, not by construction, so
 * a future price change to one file could silently desync from the
 * other. Both now import from here for the numbers; each file keeps
 * its own presentation content (marketing blurbs, feature lists,
 * ROI-calculator UI) since those are legitimately per-surface.
 *
 * Mirrors the shape of TIER_FEATURES in lib/types.ts for the consumer
 * (Basic/Standard/Pro) ladder, but kept separate: firm tiers price
 * per-seat and have no equivalent of TierSlug's 'free'/'pro'/'pro_plus'
 * personal-track values.
 */

export type FirmTierId = 'solo' | 'small_firm' | 'growing_firm' | 'enterprise';

export type FirmTierPricing = {
  id: FirmTierId;
  name: string;
  /** Dollars per user per month. `null` for Enterprise (negotiated). */
  pricePerUserMonth: number | null;
  /** Only set for Enterprise: the "From $X" floor shown on /pricing. */
  enterpriseFromPrice?: number;
  /** Seat band floor (Growing Firm's "26+" starts where Small Firm's 25-seat cap ends). */
  minAttorneys?: number;
  /** Seat band ceiling. `null` = no per-seat ceiling (Enterprise). */
  maxAttorneys: number | null;
  /** Matters-per-attorney floor before token overage billing kicks in. `null` = negotiated. */
  mattersPerAttorney: number | null;
};

export const FIRM_TIER_PRICING: Record<FirmTierId, FirmTierPricing> = {
  solo: {
    id: 'solo',
    name: 'Solo',
    pricePerUserMonth: 59,
    maxAttorneys: 1,
    mattersPerAttorney: 30,
  },
  small_firm: {
    id: 'small_firm',
    name: 'Small Firm',
    pricePerUserMonth: 99,
    maxAttorneys: 25,
    mattersPerAttorney: 50,
  },
  growing_firm: {
    id: 'growing_firm',
    name: 'Growing Firm',
    pricePerUserMonth: 149,
    minAttorneys: 26,
    maxAttorneys: 100,
    mattersPerAttorney: 100,
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    pricePerUserMonth: null,
    enterpriseFromPrice: 1800,
    minAttorneys: 101,
    maxAttorneys: null,
    mattersPerAttorney: null,
  },
};

/** Formatted price string for the /pricing tier cards, e.g. "$59" or "From $1,800". */
export function formatFirmTierPrice(tier: FirmTierPricing): string {
  if (tier.pricePerUserMonth !== null) return `$${tier.pricePerUserMonth}`;
  if (tier.enterpriseFromPrice !== undefined) {
    return `From $${tier.enterpriseFromPrice.toLocaleString('en-US')}`;
  }
  return 'Contact us';
}

/**
 * Picks the tier a firm falls into by attorney count, for the savings
 * calculator's ROI estimate. The wider band wins - an attorney count
 * past a tier's ceiling is treated as the next tier up (firms grow
 * into seats).
 */
export function pickFirmTierByAttorneys(attorneys: number): FirmTierPricing {
  if (attorneys <= FIRM_TIER_PRICING.solo.maxAttorneys!) return FIRM_TIER_PRICING.solo;
  if (attorneys <= FIRM_TIER_PRICING.small_firm.maxAttorneys!) return FIRM_TIER_PRICING.small_firm;
  if (attorneys <= FIRM_TIER_PRICING.growing_firm.maxAttorneys!) return FIRM_TIER_PRICING.growing_firm;
  return FIRM_TIER_PRICING.enterprise;
}
