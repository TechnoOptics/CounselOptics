'use client';

import { useIsNativeApp } from '@/components/useIsNativeApp';
import type { NativePlatform } from '@/lib/platform';

/**
 * iOS subscription status note.
 *
 * Advottic on iOS is a free client for a service the customer buys and
 * administers outside the app. Under App Store Guideline 3.1.1 / 3.1.3(c)
 * Enterprise Services the app sells nothing, and it must also carry no call
 * to action to purchase outside it. There is therefore no Apple
 * "Restore Purchases" control (only required when you sell IAP), no price, no
 * plan choice, and no pointer to where a subscription can be bought - naming
 * the place to buy is itself a call to action. What is left is a plain
 * statement of how access resolves.
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
        Your Advottic plan is tied to your account. When your account has an
        active subscription, all of your features unlock here automatically.
      </p>
    </div>
  );
}
