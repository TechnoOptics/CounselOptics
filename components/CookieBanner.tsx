'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'co-cookie-ack';
type Choice = 'accepted' | 'declined' | 'configured';

export function CookieBanner() {
  const [show, setShow] = useState(false);
  const [phase, setPhase] = useState<'overview' | 'configure'>('overview');
  const [analytics, setAnalytics] = useState(false); // Reserved for future use - currently no third-party analytics ship.
  const [marketing, setMarketing] = useState(false); // Reserved for future use - currently no marketing cookies.

  useEffect(() => {
    try {
      const ack = localStorage.getItem(STORAGE_KEY);
      if (!ack) setShow(true);
    } catch {
      /* ignore */
    }
  }, []);

  function persist(choice: Choice) {
    try {
      const payload = JSON.stringify({
        choice,
        analytics,
        marketing,
        at: new Date().toISOString(),
      });
      localStorage.setItem(STORAGE_KEY, payload);
    } catch {
      /* ignore */
    }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cookie and privacy preferences"
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center px-4 py-6"
    >
      {/* Blocking, glow-tinted backdrop. Click does NOT dismiss - choice required. */}
      <div className="absolute inset-0 bg-forest-950/72 backdrop-blur-sm animate-fade-in" />
      <div
        className="relative w-full max-w-2xl rounded-2xl border border-gold-300/40 bg-white shadow-card-hover overflow-hidden animate-fade-up"
        style={{ boxShadow: '0 0 0 1px rgba(213,187,126,0.4), 0 22px 60px -12px rgba(15,45,36,0.45), 0 0 80px rgba(213,187,126,0.18)' }}
      >
        {/* Brand strip */}
        <div className="brand-mark text-cream-200 px-6 py-4">
          <p className="text-[10px] tracking-[0.28em] uppercase font-semibold text-gold-300">
            Cookies &amp; privacy
          </p>
          <h2 className="text-lg font-semibold tracking-tight text-cream-100 mt-1">
            Your cookie preferences
          </h2>
        </div>

        {phase === 'overview' && (
          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-ink-700 leading-relaxed">
              Advottic uses <strong>essential cookies only</strong> - to keep you signed in and
              keep the service secure. We do not run advertising trackers and we do not sell your
              data.
            </p>
            <ul className="text-xs text-ink-600 space-y-1.5 list-disc list-outside pl-5">
              <li>
                <strong>Strictly necessary</strong>: session, CSRF, auth - required to use the
                app. These cannot be turned off.
              </li>
              <li>
                <strong>Functional</strong>: remembers UI preferences (last-active tab, search
                history). Local storage only.
              </li>
              <li>
                <strong>Analytics &amp; marketing</strong>: <em>none currently in use</em>.
                Configure if you want to pre-decline future ones.
              </li>
            </ul>
            <p className="text-xs text-ink-500 leading-relaxed">
              Read our{' '}
              <Link href="/cookies" className="underline text-forest-900 hover:text-forest-700">
                Cookie Policy
              </Link>
              ,{' '}
              <Link href="/privacy" className="underline text-forest-900 hover:text-forest-700">
                Privacy Policy
              </Link>
              , and{' '}
              <Link href="/terms" className="underline text-forest-900 hover:text-forest-700">
                Terms
              </Link>
              .
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => persist('accepted')}
                className="btn bg-forest-900 text-cream-200 hover:bg-forest-800 font-semibold"
              >
                Accept essentials
              </button>
              <button
                type="button"
                onClick={() => setPhase('configure')}
                className="btn-secondary"
              >
                Configure preferences
              </button>
              <button
                type="button"
                onClick={() => persist('declined')}
                className="text-xs text-ink-500 hover:text-ink-900 underline ml-auto"
              >
                Decline non-essentials
              </button>
            </div>
            <p className="text-[11px] text-ink-400 leading-relaxed">
              Note: even &quot;Decline non-essentials&quot; keeps the strictly-necessary auth
              cookie active - without it, sign-in cannot work.
            </p>
          </div>
        )}

        {phase === 'configure' && (
          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-ink-700 leading-relaxed">
              Toggle which categories of cookies you allow. Strictly-necessary cookies are
              always on; analytics and marketing are off by default and we don&apos;t currently
              use any.
            </p>
            <ul className="space-y-2">
              <Toggle
                title="Strictly necessary"
                desc="Session, auth, CSRF. Required for sign-in. Always on."
                checked
                disabled
              />
              <Toggle
                title="Functional"
                desc="UI preferences in local storage. No external transmission."
                checked
                disabled
              />
              <Toggle
                title="Analytics"
                desc="Usage measurement. Not in use today; toggle reserved for future opt-in."
                checked={analytics}
                onChange={setAnalytics}
              />
              <Toggle
                title="Marketing"
                desc="Targeting / advertising. Not in use today; toggle reserved for future opt-in."
                checked={marketing}
                onChange={setMarketing}
              />
            </ul>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPhase('overview')}
                className="btn-ghost"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => persist('configured')}
                className="btn-primary ml-auto"
              >
                Save preferences
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Toggle({
  title,
  desc,
  checked,
  disabled = false,
  onChange,
}: {
  title: string;
  desc: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-ink-200 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-950">{title}</p>
        <p className="text-xs text-ink-500 leading-relaxed mt-0.5">{desc}</p>
      </div>
      <label className={`relative inline-flex h-5 w-9 flex-none ${disabled ? 'opacity-60' : ''}`}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange?.(e.currentTarget.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-ink-300 peer-checked:bg-forest-900 transition-colors"
        />
        <span
          aria-hidden
          className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4"
        />
      </label>
    </li>
  );
}
