'use client';

import { useIsNativeApp } from '@/components/useIsNativeApp';
import type { NativePlatform } from '@/lib/platform';

/**
 * iOS subscription note (reader model).
 *
 * Advottic does NOT sell subscriptions inside the iOS app — there is no Apple
 * In-App Purchase. Plans are purchased on the web (advottic.com via Stripe)
 * and the app unlocks based on the signed-in account's entitlement. So instead
 * of an Apple "Restore Purchases" control (only required when you sell IAP),
 * iOS users get a short note telling them where their subscription lives.
 *
 * On web + Android this returns null. `serverPlatform` is the authoritative,
 * non-racy signal (see TierCard for the full rationale) so a lost bridge race
 * can't hide this from a real iOS session.
 */
export function RestorePurchases({
  serverPlatform,
}: {
  serverPlatform: NativePlatform;
}) {
  const { ready, platform } = useIsNativeApp();
  const isIOS = serverPlatform === 'ios' || (ready && platform === 'ios');
  if (!isIOS) return null;

  return (
    <div className="card p-5 sm:p-6">
      <p className="eyebrow mb-1">Your subscription</p>
      <p className="text-[13px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
        Advottic subscriptions are managed on the web. To start, change, or
        cancel your plan, sign in at{' '}
        <span className="font-semibold text-forest-900 dark:text-cream-100">advottic.com</span>{' '}
        in your browser. Once you&apos;re subscribed, your access unlocks here
        automatically — there&apos;s nothing to buy inside the app.
      </p>
    </div>
  );
}
