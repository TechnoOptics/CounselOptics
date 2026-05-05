'use client';

import { useEffect, useState } from 'react';

/**
 * Compact opt-in for browser push notifications. Drops in anywhere
 * on the consumer side; renders as a small button when permission
 * is "default", silent when "denied" or already-subscribed.
 *
 * Server side requires NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY.
 * The button silently no-ops when the public key is missing.
 */
export function PushOptIn() {
  const [state, setState] = useState<
    'idle' | 'subscribing' | 'subscribed' | 'denied' | 'unsupported' | 'noenv'
  >('idle');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported');
      return;
    }
    if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
      setState('noenv');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }
    // Check existing subscription.
    (async () => {
      const reg = await navigator.serviceWorker
        .getRegistration('/sw-push.js')
        .catch(() => null);
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) setState('subscribed');
      }
    })();
  }, []);

  async function subscribe() {
    setState('subscribing');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setState(perm === 'denied' ? 'denied' : 'idle');
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw-push.js');
      const keyBytes = urlBase64ToUint8Array(
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '',
      );
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes.buffer.slice(
          keyBytes.byteOffset,
          keyBytes.byteOffset + keyBytes.byteLength,
        ) as ArrayBuffer,
      });
      const json = sub.toJSON();
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
        }),
      });
      setState('subscribed');
    } catch {
      setState('idle');
    }
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

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = typeof window !== 'undefined' ? window.atob(b64) : '';
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}
