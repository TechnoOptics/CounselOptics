/**
 * Gift subscriptions: shared pricing + tier display info.
 *
 * Pricing model: simple monthly rate × duration. 12-month gifts get
 * a 20% prepay discount that mirrors the annual discount surfaced on
 * /pricing, so a gifter buying a year doesn't pay more than a
 * recipient who self-subscribes annually would.
 *
 * NO node imports in this file. It's imported by client components
 * (app/gift/gift-form.tsx). Server-only helpers (e.g. token
 * generation, which needs node:crypto) live in lib/gift-server.ts.
 */

import { formatUsdFromCents } from './format';

export type GiftTierSlug =
  | 'pro'
  | 'pro_plus'
  | 'solo'
  | 'small_firm'
  | 'growing_firm';

export type GiftDuration = 1 | 3 | 6 | 12;

export type GiftTier = {
  slug: GiftTierSlug;
  name: string;
  monthlyCents: number;
  blurb: string;
  audience: 'individual' | 'firm';
  perSeat: boolean;
};

export const GIFT_TIERS: GiftTier[] = [
  {
    slug: 'pro',
    name: 'Personal Pro',
    monthlyCents: 1_900,
    blurb:
      '20 cases/contracts, 500K Bella tokens, Safe Witness, Wear OS app.',
    audience: 'individual',
    perSeat: false,
  },
  {
    slug: 'pro_plus',
    name: 'Personal Plus',
    monthlyCents: 2_900,
    blurb:
      'Everything in Pro, family share for 4, Safe Witness for each member.',
    audience: 'individual',
    perSeat: false,
  },
  {
    slug: 'solo',
    name: 'Counsel - Solo',
    monthlyCents: 5_900,
    blurb:
      'Single attorney + 1 staff. Practice management, Bella tier 1, court-form auto-fill.',
    audience: 'firm',
    perSeat: true,
  },
  {
    slug: 'small_firm',
    name: 'Counsel - Small Firm',
    monthlyCents: 9_900,
    blurb:
      'Up to 25 users, Bella tier 2 letterhead, Employee Hub, IOLTA, marketplace.',
    audience: 'firm',
    perSeat: true,
  },
  {
    slug: 'growing_firm',
    name: 'Counsel - Growing Firm',
    monthlyCents: 14_900,
    blurb:
      'Up to 100 users, analytics, SAML SSO, custom Bella training.',
    audience: 'firm',
    perSeat: true,
  },
];

export const GIFT_DURATIONS: { months: GiftDuration; label: string }[] = [
  { months: 1, label: '1 month' },
  { months: 3, label: '3 months' },
  { months: 6, label: '6 months' },
  { months: 12, label: '1 year (20% off)' },
];

/**
 * Total Stripe charge in cents for a (tier × duration) gift. 12-month
 * gifts get a 20% discount; everything else is monthly rate × months.
 *
 * Firm tiers (Solo / Small Firm / Growing Firm) are gifted at a
 * single-seat rate. The recipient can add seats later from /billing
 * - we don't sell a multi-seat gift in v1 because the gifter often
 * doesn't know how many seats the recipient will end up needing.
 */
export function giftAmountCents(
  tier: GiftTierSlug,
  duration: GiftDuration,
): number {
  const t = GIFT_TIERS.find((x) => x.slug === tier);
  if (!t) throw new Error(`Unknown tier: ${tier}`);
  const gross = t.monthlyCents * duration;
  // Annual prepay discount mirrors /pricing's "20% off with annual
  // prepay" line. Applied only on the 12-month duration; everything
  // shorter is full-price-per-month.
  return duration === 12 ? Math.round(gross * 0.8) : gross;
}

/**
 * Human-readable price in dollars with cents.
 *
 * Was `` `$${(cents / 100).toFixed(2)}` ``, which renders a twelve-month
 * gift as `$1200.00`. Intl places the grouping separator.
 */
export function formatDollars(cents: number): string {
  return formatUsdFromCents(cents);
}

export function getGiftTier(slug: string): GiftTier | null {
  return GIFT_TIERS.find((t) => t.slug === slug) ?? null;
}

/**
 * Compute the recipient subscription expiry: now + N months,
 * normalized to the same time-of-day. Edge case: claiming on Feb 29
 * for 1 year shifts to Feb 28 of next year (JS Date arithmetic
 * handles the month overflow correctly).
 */
export function expiryFromNow(durationMonths: GiftDuration): Date {
  const d = new Date();
  d.setMonth(d.getMonth() + durationMonths);
  return d;
}
