import 'server-only';
import { cookies } from 'next/headers';
import { getCurrentSubscription, getProfile } from './storage';
import { activeTier } from './tier';
import { tierSlugFromPriceId } from './stripe';
import { personalTierForSlug, COMP_ULTRA_PRICE_ID } from './personal-tiers';
import type { Subscription } from './types';
import type { TierSlug } from './token-packages';

/** Cookie an admin sets to preview a non-firm timeline experience for QA. */
export const TIMELINE_PREVIEW_COOKIE = 'adv_tl_preview';

/**
 * Case Timeline access tiers:
 *
 *  - 'firm'   → the FULL build experience: Bella analysis (OCR, dates, people,
 *               locations, chat parsing), dictation, people tagging, the
 *               generated narrative, and the court-ready export. Exclusive to
 *               firm/counsel plans, where the professionals do the sense-making.
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
  // Comp / founder / support / QA accounts (lifetime Ultra) get the full
  // firm build everywhere, including the consumer timeline. The comp is
  // meant to be unconditional access, not a personal-tier ceiling, so a
  // comped account switching into the consumer view must never hit the
  // "firm-plan feature" gate. Mirrors the admin short-circuit in
  // resolveTimelineAccess.
  if (sub.priceId === COMP_ULTRA_PRICE_ID) return 'firm';
  const slug = tierSlugFromPriceId(sub.priceId);
  if (slug && FIRM_SLUGS.has(slug)) return 'firm';
  if (slug === 'pro_plus') return 'submit';
  // Personal ladder rungs that include the timeline (Plus and up) get the
  // submit-only consumer view.
  const pt = personalTierForSlug(slug);
  if (pt?.timeline) return 'submit';
  // Comp / trialing subs may carry no mapped price id; treat the top coarse
  // tier ('pro') as the submit tier rather than locking them out.
  if (!slug && activeTier(sub) === 'pro') return 'submit';
  return 'locked';
}

/** Server-side resolve for the current user (admins get the full firm build). */
export async function resolveTimelineAccess(): Promise<TimelineAccess> {
  const profile = await getProfile().catch(() => null);
  if (profile?.isAdmin) {
    // Admins can preview the consumer experience for QA via a cookie toggle,
    // without giving up their admin status. Only affects admins.
    const preview = cookies().get(TIMELINE_PREVIEW_COOKIE)?.value;
    if (preview === 'consumer') return 'submit';
    if (preview === 'locked') return 'locked';
    return 'firm';
  }
  const sub = await getCurrentSubscription();
  return timelineAccessFor(sub);
}
