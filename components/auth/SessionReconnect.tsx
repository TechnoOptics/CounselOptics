'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Soft "reconnecting" screen shown when a server-side session read
 * THREW (not when the visitor is genuinely signed out). A transient
 * read failure - a corrupted cookie, an Edge decode error, or the
 * brief window during a Vercel deploy when the client holds a stale
 * bundle - must NOT evict the user to /sign-in the way a real logout
 * does. Instead we hold their place and quietly retry.
 *
 * Behavior:
 *   - Auto-retries via router.refresh() a few times with a gentle
 *     backoff. If the hiccup clears, the layout re-renders normally
 *     and this component unmounts - the user never left the page.
 *   - After the auto-retries are exhausted, we stop hammering and
 *     offer a manual "Try again", plus a plain link to sign in as a
 *     last resort. We never redirect on the user's behalf.
 *
 * The copy stays calm and reassuring (users here are often in legal
 * distress); it explains this is a reconnect, not a sign-out.
 */

// A short, finite backoff. Kept small so a genuine blip resolves
// within a couple of seconds without the user reaching for a button.
const RETRY_DELAYS_MS = [1500, 3000, 5000];

export function SessionReconnect({
  signInHref = '/sign-in',
}: {
  /** Where the manual "Sign in" fallback link points. */
  signInHref?: string;
}) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const exhausted = attempt >= RETRY_DELAYS_MS.length;

  useEffect(() => {
    if (exhausted) return;
    const delay = RETRY_DELAYS_MS[attempt];
    const t = setTimeout(() => {
      setAttempt((a) => a + 1);
      // Re-run the server component tree. If the session read now
      // succeeds this whole component is replaced by the real shell.
      router.refresh();
    }, delay);
    return () => clearTimeout(t);
  }, [attempt, exhausted, router]);

  return (
    <div className="dark counsel-shell min-h-screen flex items-center justify-center px-4 py-16 text-cream-100">
      <div
        role="status"
        aria-live="polite"
        className="popup-panel max-w-md w-full p-8 space-y-3 text-center"
      >
        <p className="eyebrow justify-center">Advottic</p>
        <div className="flex items-center justify-center gap-2 pt-1">
          {!exhausted && (
            <span
              aria-hidden
              className="h-2 w-2 rounded-full bg-gold-300 animate-pulse flex-none"
            />
          )}
          <h1 className="font-display text-2xl font-medium text-cream-100">
            {exhausted ? 'Still reconnecting' : 'Reconnecting…'}
          </h1>
        </div>
        <p className="text-sm text-cream-100/70 leading-relaxed">
          {exhausted
            ? "We're having trouble restoring your session right now. You're still signed in — give it another moment, or try again."
            : "One moment while we restore your session. You haven't been signed out."}
        </p>
        {exhausted && (
          <div className="flex flex-col gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setAttempt(0);
                router.refresh();
              }}
              className="btn bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold justify-center"
            >
              Try again
            </button>
            <a
              href={signInHref}
              className="btn w-full text-cream-100/70 hover:text-cream-100 hover:bg-cream-100/5 justify-center"
            >
              Sign in
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
