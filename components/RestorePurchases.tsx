'use client';

import { useState } from 'react';
import { useIsNativeApp } from '@/components/useIsNativeApp';

/**
 * Apple-required "Restore Purchases" control, shown only inside the iOS
 * app. Apple Guideline 3.1.1 requires any app that sells auto-renewable
 * subscriptions to also offer a way to restore a purchase the Apple ID
 * already owns (e.g. after reinstalling or on a second device). It also
 * tells the user where iOS subscriptions are actually managed (Settings
 * -> Apple ID -> Subscriptions), since those aren't in the Stripe portal.
 *
 * On web + Android this returns null - those platforms use Stripe, which
 * has its own customer portal.
 */
export function RestorePurchases({ userId }: { userId: string }) {
  const { ready, platform } = useIsNativeApp();
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!ready || platform !== 'ios') return null;

  async function restore() {
    setPending(true);
    setMsg(null);
    try {
      const { restorePurchases } = await import('@/lib/iap');
      const res = await restorePurchases(userId);
      // Reconcile server-side regardless, so the subscriptions row
      // reflects whatever RevenueCat reports for this Apple ID.
      await fetch('/api/iap/sync', { method: 'POST' }).catch(() => {});
      if (res.active) {
        setMsg('Subscription restored. Refreshing...');
        window.location.reload();
      } else {
        setMsg('No previous purchase was found on this Apple ID.');
        setPending(false);
      }
    } catch (err) {
      setMsg(
        err instanceof Error ? err.message : 'Could not restore purchases.',
      );
      setPending(false);
    }
  }

  return (
    <div className="card p-5 sm:p-6 space-y-3">
      <div>
        <p className="eyebrow mb-1">Apple subscription</p>
        <p className="text-[13px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
          Subscriptions you buy in the app are billed through your Apple ID.
          Manage or cancel them in Settings &rarr; your name &rarr;
          Subscriptions. Already subscribed on another device? Restore it here.
        </p>
        {/* Apple Guideline 3.1.2 point-of-sale disclosure: the paywall
            must state that the subscription auto-renews, the terms, and
            link to the EULA + Privacy Policy. The tier cards above show
            the title, monthly length, and price. */}
        <p className="mt-2 text-[12px] text-ink-500 dark:text-cream-100/60 leading-relaxed">
          Advottic plans are auto-renewable subscriptions. Payment is charged to
          your Apple ID at confirmation of purchase. The subscription renews
          automatically for the same period, at the price shown above, unless
          canceled at least 24 hours before the current period ends.
        </p>
        <p className="mt-1 text-[12px]">
          <a className="underline text-ink-600 dark:text-cream-100/70" href="/terms">
            Terms of Use (EULA)
          </a>{' '}
          &middot;{' '}
          <a className="underline text-ink-600 dark:text-cream-100/70" href="/privacy">
            Privacy Policy
          </a>
        </p>
      </div>
      <button
        type="button"
        onClick={restore}
        disabled={pending}
        className="btn-secondary text-sm"
      >
        {pending ? 'Restoring...' : 'Restore purchases'}
      </button>
      {msg && (
        <p className="text-xs text-ink-600 dark:text-cream-100/70">{msg}</p>
      )}
    </div>
  );
}
