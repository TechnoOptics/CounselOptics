import type { TierSlug } from './token-packages';

/**
 * The five consumer ("personal") plans, the single source of truth for the
 * billing cards AND the feature gates. The coarse `Tier` enum only has three
 * values, which cannot express five distinct case caps or "Bella unlocks at
 * rung 3", so personal gating (case cap, Bella, Advottic Review) reads THIS
 * config by the subscription's fine TierSlug instead — see lib/tier.ts.
 *
 * Ladder (confirmed 2026-07-07): Free $0 / Starter $19 / Plus $29 / Pro $59 /
 * Ultra $99, with case caps 1 / 3 / 8 / 15 / 40 and Bella unlocking at Plus.
 * More "revolutionary" features are locked higher and shown with a padlock so
 * lower tiers see what an upgrade buys.
 *
 * Each paid rung maps to its OWN new TierSlug (starter/plus/premium/ultra) so
 * the legacy basic/standard/pro/pro_plus slugs — and anyone still on them —
 * keep their existing caps untouched.
 */

export type PersonalTierKey = 'free' | 'starter' | 'plus' | 'premium' | 'ultra';

export type PersonalTier = {
  key: PersonalTierKey;
  /** The fine TierSlug the webhook stamps on the subscription. */
  slug: TierSlug;
  name: string;
  tagline: string;
  priceUsd: number;
  /** Cases (and other items) allowed before overage. */
  caseLimit: number;
  bella: boolean;
  aiReview: boolean;
  collaborators: boolean;
  /** Submit-only timeline access (the personal minimal timeline). */
  timeline: boolean;
  monthlyTokens: number;
  /** Env var holding this rung's Stripe price id. Null for Free. */
  stripeEnv: string | null;
  /** One-line highlights shown on the card. */
  highlights: string[];
};

export const PERSONAL_TIERS: PersonalTier[] = [
  {
    key: 'free',
    slug: 'free',
    name: 'Free',
    tagline: 'Start a single case',
    priceUsd: 0,
    caseLimit: 1,
    bella: false,
    aiReview: false,
    collaborators: false,
    timeline: false,
    monthlyTokens: 25_000,
    stripeEnv: null,
    highlights: ['1 case', 'PDF export', 'Find counsel'],
  },
  {
    key: 'starter',
    slug: 'starter',
    name: 'Starter',
    tagline: 'A few matters at once',
    priceUsd: 19,
    caseLimit: 3,
    bella: false,
    aiReview: false,
    collaborators: false,
    timeline: false,
    monthlyTokens: 150_000,
    stripeEnv: 'STRIPE_PRICE_PERSONAL_STARTER',
    highlights: ['3 cases', 'PDF export', 'Priority support'],
  },
  {
    key: 'plus',
    slug: 'plus',
    name: 'Plus',
    tagline: 'Bella unlocks here',
    priceUsd: 29,
    caseLimit: 8,
    bella: true,
    aiReview: false,
    collaborators: false,
    timeline: true,
    monthlyTokens: 500_000,
    stripeEnv: 'STRIPE_PRICE_PERSONAL_PLUS8',
    highlights: ['8 cases', 'Bella AI assistant', 'Case timeline (submit)'],
  },
  {
    key: 'premium',
    slug: 'premium',
    name: 'Pro',
    tagline: 'The full toolkit',
    priceUsd: 59,
    caseLimit: 15,
    bella: true,
    aiReview: true,
    collaborators: true,
    timeline: true,
    monthlyTokens: 1_500_000,
    stripeEnv: 'STRIPE_PRICE_PERSONAL_PRO15',
    highlights: ['15 cases', 'Advottic Review', 'Invite your firm'],
  },
  {
    key: 'ultra',
    slug: 'ultra',
    name: 'Ultra',
    tagline: 'Everything, at scale',
    priceUsd: 99,
    caseLimit: 40,
    bella: true,
    aiReview: true,
    collaborators: true,
    timeline: true,
    monthlyTokens: 3_000_000,
    stripeEnv: 'STRIPE_PRICE_PERSONAL_ULTRA',
    highlights: ['40 cases', 'Everything in Pro', 'Highest token grant'],
  },
];

const BY_SLUG = new Map<TierSlug, PersonalTier>(PERSONAL_TIERS.map((t) => [t.slug, t]));

/** The personal tier for a fine slug, or null if it isn't a personal rung. */
export function personalTierForSlug(slug: TierSlug | null | undefined): PersonalTier | null {
  return slug ? BY_SLUG.get(slug) ?? null : null;
}

/** The new personal paid slugs (excludes Free and all legacy/firm slugs). */
export const PERSONAL_PAID_SLUGS: TierSlug[] = PERSONAL_TIERS.filter((t) => t.priceUsd > 0).map((t) => t.slug);

/** The gateable, "revolutionary" personal features in lock order. */
export type PersonalFeatureKey = 'bella' | 'aiReview' | 'collaborators' | 'timeline';
