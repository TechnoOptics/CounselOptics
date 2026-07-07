import 'server-only';
import { getCurrentSubscription, getProfile } from './storage';
import { activeTier } from './tier';
import { tierSlugFromPriceId } from './stripe';
import type { Subscription } from './types';
import type { TierSlug } from './token-packages';

/**
 * Case Timeline access tiers:
 *
 *  - 'firm'   → the FULL build experience: Bella analysis (OCR, dates, people,
 *               locations, chat parsing), dictation, people tagging, the
 *               generated narrative, and the court-ready export. Exclusive to
 *               firm/counsel plans — the professionals do the sense-making.
 *  - 'submit' → the top PERSONAL plan (Personal Plus): upload bulk or individual
 *               evidence, add context, and see the timeline + calendar overview,
 *               so a client can hand their firm an organised, contextual record.
 *  - 'locked' → everyone else: an upsell.
 *
 * Admins resolve to 'firm' so the team can demo the full build.
 */
export type TimelineAccess = 'firm' | 'submit' | 'locked';

const FIRM_SLUGS: ReadonlySet<TierSlug> = new Set([
  'solo',
  'small_firm',
  'growing_firm',
  'enterprise',
]);

/** Pure entitlement from a subscription. */
export function timelineAccessFor(sub: Subscription | null | undefined): TimelineAccess {
  if (!sub || (sub.status !== 'active' && sub.status !== 'trialing')) return 'locked';
  const slug = tierSlugFromPriceId(sub.priceId);
  if (slug && FIRM_SLUGS.has(slug)) return 'firm';
  if (slug === 'pro_plus') return 'submit';
  // Comp / trialing subs may carry no mapped price id; treat the top coarse
  // tier ('pro') as the submit tier rather than locking them out.
  if (!slug && activeTier(sub) === 'pro') return 'submit';
  return 'locked';
}

/** Server-side resolve for the current user (admins get the full firm build). */
export async function resolveTimelineAccess(): Promise<TimelineAccess> {
  const profile = await getProfile().catch(() => null);
  if (profile?.isAdmin) return 'firm';
  const sub = await getCurrentSubscription();
  return timelineAccessFor(sub);
}
