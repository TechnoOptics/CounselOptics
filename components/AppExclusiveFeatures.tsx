'use client';

import { useIsNativeApp } from '@/components/useIsNativeApp';
import { GetTheApp } from '@/components/GetTheApp';

/**
 * "What the Advottic app does that the website can't" showcase.
 *
 * Two jobs:
 *  1. Marketing / App Store Guideline 4.2 - makes the app's native,
 *     device-only value explicit. In the native app it confirms the
 *     features are live ("on this device"); on the web it's a shop
 *     window with the download badges. A reviewer opening the app
 *     sees concrete capabilities a plain website can't offer.
 *  2. The web fallback for every mobile-gated feature in one place,
 *     per the product decision to show a "get the app" prompt rather
 *     than hide gated controls.
 *
 * Each feature lists the device capability it relies on, which is
 * exactly why it can only run inside the app.
 */
type Feature = {
  title: string;
  desc: string;
  /** Hidden on this native platform when the capability isn't real there. */
  hideOn?: 'ios' | 'android';
  icon: React.ReactNode;
};

const FEATURES: Feature[] = [
  {
    title: 'Face ID / Touch ID lock',
    desc: 'Unlock Advottic with your face or fingerprint - no email magic-link round-trip on every launch.',
    icon: (
      <path d="M7 4H5a1 1 0 0 0-1 1v2m0 10v2a1 1 0 0 0 1 1h2m10 0h2a1 1 0 0 0 1-1v-2M17 4h2a1 1 0 0 0 1 1v2M9 10h.01M15 10h.01M9.5 15a3.5 3.5 0 0 0 5 0" />
    ),
  },
  {
    title: 'One-tap Safe Alert, live GPS',
    desc: 'Press and hold to send a trusted contact your location - then keep streaming it with continuous background GPS the web cannot do.',
    icon: (
      <path d="M12 21s-7-4.5-7-10a7 7 0 0 1 14 0c0 5.5-7 10-7 10zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
    ),
  },
  {
    title: 'Wear OS wrist trigger',
    hideOn: 'ios',
    desc: 'Fire Safe Alert and capture voice notes straight from your watch, hands-free, even with your phone in your pocket.',
    icon: (
      <>
        <rect x="6" y="6" width="12" height="12" rx="2" />
        <path d="M9 6l1-3h4l1 3M9 18l1 3h4l1-3" />
      </>
    ),
  },
  {
    title: 'Instant push alerts',
    desc: 'Hearing reminders, deadline radar, and Safe Witness updates arrive the moment they happen - not next time you open a tab.',
    icon: (
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
    ),
  },
  {
    title: 'Scan exhibits with your camera',
    desc: 'Capture documents and evidence with the camera straight into a case, auto-dated from the photo.',
    icon: (
      <>
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </>
    ),
  },
  {
    title: 'Voice notes & dictation',
    desc: 'Speak your case notes; on-device speech recognition turns them into text without typing.',
    icon: (
      <>
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
      </>
    ),
  },
];

export function AppExclusiveFeatures({ className = '' }: { className?: string }) {
  const { ready, isNative, platform } = useIsNativeApp();
  const inApp = ready && isNative;
  const features = FEATURES.filter((f) => !(ready && f.hideOn === platform));

  return (
    <section
      className={`rounded-2xl ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-900/40 p-5 sm:p-6 ${className}`}
    >
      <p className="eyebrow mb-1">The Advottic app</p>
      <h2 className="font-display text-xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
        {inApp ? 'App-only features, ready on this device' : 'Do more with the Advottic app'}
      </h2>
      <p className="text-sm text-ink-500 dark:text-cream-100/60 mt-1">
        {inApp
          ? 'These run on your phone’s hardware, so they only work here in the app:'
          : 'These use your phone’s hardware and only work inside the app, not the website:'}
      </p>

      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {features.map((f) => (
          <li
            key={f.title}
            className="flex gap-3 rounded-xl bg-forest-900/[0.03] dark:bg-cream-100/[0.03] p-3.5"
          >
            <span
              aria-hidden
              className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-forest-900/5 dark:bg-cream-100/5 text-forest-800 dark:text-gold-300"
            >
              <svg
                width="19"
                height="19"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {f.icon}
              </svg>
            </span>
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-forest-900 dark:text-cream-100 flex items-center gap-1.5">
                {f.title}
                {inApp && (
                  <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                    ✓ on
                  </span>
                )}
              </p>
              <p className="text-[12.5px] text-ink-600 dark:text-cream-100/65 leading-snug mt-0.5">
                {f.desc}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {ready && !isNative && (
        <div className="mt-5">
          <GetTheApp />
        </div>
      )}
      {inApp && (
        <p className="mt-4 text-[12px] text-emerald-700 dark:text-emerald-400">
          ✓ You&rsquo;re in the Advottic app, so all of the above are available on this device.
        </p>
      )}
    </section>
  );
}
