'use client';

import { useState } from 'react';
import { useWatchStatus } from './useWatchStatus';

/**
 * "Connect your watch" surface for the phone app.
 *
 * The phone and watch are separately Play-signed, so the Wearable
 * Data Layer cannot bridge them - the reliable path is the watch's
 * QR pairing against the account. This card makes that path
 * discoverable from the phone and reflects live connection state
 * when the native AdvotticWatch plugin can see a paired node.
 *
 * Native Android shell only: that is where "mobile <-> watch" is a
 * real relationship. On web/desktop/iOS it renders nothing (the
 * watch still pairs directly to the account via the QR, no phone
 * needed). Dismissible so it never nags once acknowledged.
 */
export function WatchConnectCard() {
  const status = useWatchStatus();
  const [dismissed, setDismissed] = useState(false);

  // Until the native query resolves we render nothing. On web the
  // hook settles with nodeCount 0 + isWatch heuristics.
  // Render the card ONLY inside the Capacitor Android shell. Desktop
  // browsers and mobile-web users can't pair a watch (no QR camera
  // in the right place, no Play Store hand-off), so a 'Use Advottic
  // on your watch' nudge there is pure noise. Suppressing it on
  // desktop was an explicit user request in May 2026.
  if (status.loading || status.isWatch || !status.isNativeShell) return null;

  const connected =
    status.watchAppInstalled && status.watchReachable;
  const pairedNoApp = status.watchPaired && !status.watchAppInstalled;

  // Nothing watch-related visible and the user dismissed the hint:
  // stay out of the way. We still show the connected confirmation
  // (it's reassuring, not noise) unless dismissed.
  if (dismissed) return null;
  // No paired node and no app: this is most phones. Show a compact,
  // one-line, dismissible hint rather than a big card.
  const minimal = !status.watchPaired && !status.watchAppInstalled;

  if (connected) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900 flex items-center justify-between gap-3 dark:border-emerald-700/40 dark:bg-emerald-950/30 dark:text-emerald-100">
        <span className="inline-flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full bg-emerald-500"
            aria-hidden
          />
          Your Wear OS watch is connected. Cases, the next hearing, and
          your action center sync to your wrist.
        </span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-[12px] underline opacity-70 hover:opacity-100"
        >
          Hide
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gold-200 bg-cream-50 px-4 py-3.5 text-sm text-forest-900 dark:border-gold-700/40 dark:bg-forest-900/40 dark:text-cream-100">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold flex items-center gap-2">
            <WatchGlyph />
            {pairedNoApp
              ? 'Finish setting up your Wear OS watch'
              : 'Use Advottic on your Wear OS watch'}
          </p>
          {!minimal && (
            <ol className="mt-2 space-y-1 text-[13px] text-ink-700 dark:text-cream-100/80 list-decimal pl-5 leading-relaxed">
              <li>
                Install <strong>Advottic</strong> from the Play Store on
                the watch{pairedNoApp ? ' (it is paired already)' : ''}.
              </li>
              <li>
                Open it - it shows a QR code automatically the first
                time.
              </li>
              <li>Scan that QR with this phone&rsquo;s camera.</li>
              <li>
                Approve the link (you&rsquo;ll be signed in) - the
                watch then syncs your cases over a secure connection.
              </li>
            </ol>
          )}
          {minimal && (
            <p className="mt-1 text-[13px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
              Open Advottic on your Wear OS watch - it shows a QR you
              scan with this phone to link it to your account.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 text-[12px] underline text-ink-500 hover:text-forest-900 dark:text-cream-100/55 dark:hover:text-cream-100"
        >
          Hide
        </button>
      </div>
    </div>
  );
}

function WatchGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="6" y="6" width="12" height="12" rx="3" />
      <path d="M9 3h6M9 21h6M12 9v3l2 1" />
    </svg>
  );
}
