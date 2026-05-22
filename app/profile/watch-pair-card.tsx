'use client';

import Link from 'next/link';
import { useWatchStatus } from '@/components/useWatchStatus';

/**
 * Wear OS pair-watch link card for /profile.
 *
 * Only rendered inside the Capacitor Android phone app shell. On
 * desktop browsers and mobile-web there's no pairing flow worth
 * surfacing - the watch QR is meant to be scanned with the phone,
 * the 6-digit code is meant to be typed into the already-signed-in
 * phone app, and the Play Store hand-off only works on Android.
 *
 * Returns null while the native-shell query is still resolving so
 * we never show-then-hide on first paint of a desktop browser.
 */
export function WatchPairCard() {
  const status = useWatchStatus();
  if (status.loading || !status.isNativeShell) return null;
  return (
    <Link
      href="/pair-watch"
      className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-900/40 hover:ring-forest-700 dark:hover:ring-gold-metal/40 transition-colors p-4 block"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base text-forest-900 dark:text-cream-100">
            Pair Wear OS watch
          </p>
          <p className="text-[12.5px] text-ink-600 dark:text-cream-100/70 mt-1 leading-snug">
            Open Advottic on your watch, tap{' '}
            <strong>Link a watch</strong>, then type the 6-digit code
            it shows.
          </p>
        </div>
        <span
          aria-hidden
          className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-forest-900/5 dark:bg-cream-100/5 text-forest-900 dark:text-cream-100"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="6" y="6" width="12" height="12" rx="2" />
            <path d="M9 6l1-3h4l1 3M9 18l1 3h4l1-3" />
          </svg>
        </span>
      </div>
      <p className="text-[12px] font-semibold text-forest-900 dark:text-cream-100 mt-3 inline-flex items-center gap-1">
        Pair a watch <span aria-hidden>→</span>
      </p>
    </Link>
  );
}

/**
 * Section header for the Devices card. Renamed away from
 * 'Companion devices' when there's no companion-device affordance
 * to render, so a desktop user doesn't see a heading that exists
 * only to introduce a card they can't see.
 */
export function DevicesSectionHeader() {
  const status = useWatchStatus();
  // While loading we show the conservative (desktop) wording. If we
  // later resolve into native, the heading flips to the wider
  // 'Companion devices' label.
  const native = !status.loading && status.isNativeShell;
  return (
    <div>
      <p className="eyebrow mb-2">{native ? 'Devices' : 'Safety'}</p>
      <h2 className="font-display text-xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
        {native ? 'Companion devices' : 'Safe Witness'}
      </h2>
      <p className="text-sm text-ink-500 dark:text-cream-100/55 mt-0.5">
        {native
          ? 'Pair a Wear OS watch so your next hearing, action center, and docket appear on your wrist.'
          : 'Set up Safe Witness so a trusted contact gets a one-tap alert with your location when you press and hold the watch button - or trigger it from the web.'}
      </p>
    </div>
  );
}
