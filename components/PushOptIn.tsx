'use client';

import { useEffect, useState } from 'react';
import { ensurePushSubscribed } from '@/lib/push-client';

/**
 * Compact opt-in for browser push notifications. Drops in anywhere
 * on the consumer side; renders as a small button when permission
 * is "default", silent when "denied" or already-subscribed.
 *
 * On mount it calls the shared helper in silent mode: if the browser
 * already has permission it subscribes WITHOUT a prompt (this is what
 * keeps notifications on by default across sessions/devices). The
 * button only appears when permission still needs to be requested.
 *
 * Server side requires NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY.
 * The button silently no-ops when the public key is missing.
 */
export function PushOptIn() {
  const [state, setState] = useState<
    'idle' | 'subscribing' | 'subscribed' | 'denied' | 'unsupported' | 'noenv'
  >('idle');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await ensurePushSubscribed(false);
      if (cancelled) return;
      if (res === 'subscribed') setState('subscribed');
      else if (res === 'denied') setState('denied');
      else if (res === 'unsupported') setState('unsupported');
      else if (res === 'noenv') setState('noenv');
      else setState('idle'); // needs-permission / error
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function subscribe() {
    setState('subscribing');
    const res = await ensurePushSubscribed(true);
    if (res === 'subscribed') setState('subscribed');
    else if (res === 'denied') setState('denied');
    else if (res === 'unsupported') setState('unsupported');
    else if (res === 'noenv') setState('noenv');
    else setState('idle');
  }

  if (state === 'unsupported' || state === 'noenv') return null;
  if (state === 'denied') {
    return (
      <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55 italic">
        Browser notifications are blocked for advottic.com. Re-enable them in
        your browser settings to get pinged when something needs your action.
      </p>
    );
  }
  if (state === 'subscribed') {
    return (
      <p className="text-[11.5px] text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
        Browser notifications on for this device
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={subscribe}
      disabled={state === 'subscribing'}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-900/40 text-[12px] font-medium text-ink-700 dark:text-cream-100/85 hover:text-forest-900 dark:hover:text-cream-100 transition-colors"
    >
      {state === 'subscribing' ? 'Subscribing...' : 'Enable browser notifications'}
    </button>
  );
}
