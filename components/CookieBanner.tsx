'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'co-cookie-ack';
type Choice = 'accepted' | 'declined' | 'configured';

/**
 * Compact, friendly cookie banner. Lives at the bottom of the viewport
 * as a small pill with a soft gold glow that gently asks for attention
 * without taking the screen. Click to expand into full preferences.
 *
 * Until the user makes a choice the pill stays. Once the choice is
 * persisted in localStorage the component renders nothing.
 */
export function CookieBanner() {
  const [show, setShow] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [phase, setPhase] = useState<'overview' | 'configure'>('overview');
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

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

  // Collapsed: small glowing pill at the bottom that taps to expand.
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label="Cookie preferences"
        className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:w-auto z-[55] cookie-pill inline-flex items-center justify-center gap-3 rounded-full bg-forest-950/95 dark:bg-forest-900 text-cream-100 px-4 py-3 ring-1 ring-gold-400/40 shadow-card-hover backdrop-blur"
      >
        <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-gold-400" />
        <span className="text-[12px] font-medium tracking-tight">
          We use only the cookies that keep you signed in.
        </span>
        <span className="hidden sm:inline text-[11px] uppercase tracking-[0.18em] text-gold-300 ml-1">
          Settings →
        </span>
      </button>
    );
  }

  // Expanded: small dialog anchored to the bottom on mobile, bottom-right on desktop.
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Cookie and privacy preferences"
      className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center sm:justify-end p-3 sm:p-6"
    >
      <button
        type="button"
        aria-label="Close cookie preferences"
        onClick={() => setExpanded(false)}
        className="absolute inset-0 bg-forest-950/40 backdrop-blur-[2px] animate-fade-in"
      />
      <div
        className="relative w-full sm:max-w-md rounded-2xl border border-gold-300/40 bg-white dark:bg-forest-900 shadow-card-hover overflow-hidden animate-fade-up"
        style={{
          boxShadow:
            '0 0 0 1px rgba(213,187,126,0.4), 0 18px 50px -12px rgba(15,45,36,0.45), 0 0 60px rgba(213,187,126,0.18)',
        }}
      >
        <div className="brand-mark text-cream-200 px-5 py-3.5 flex items-center justify-between">
          <div>
            <p className="text-[10px] tracking-[0.28em] uppercase font-semibold text-gold-300">
              Cookies &amp; privacy
            </p>
            <h2 className="text-[15px] font-semibold tracking-tight text-cream-100 mt-0.5">
              Your preferences
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label="Close"
            className="text-cream-100/70 hover:text-cream-100 p-1"
          >
            <CloseIcon />
          </button>
        </div>

        {phase === 'overview' && (
          <div className="px-5 py-4 space-y-3.5">
            <p className="text-[13.5px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
              We only use cookies that keep you signed in and the service running. No advertising
              trackers, ever. We never sell your data.
            </p>
            <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
              <Link href="/cookies" className="underline">Cookie Policy</Link>
              {' · '}
              <Link href="/privacy" className="underline">Privacy</Link>
              {' · '}
              <Link href="/terms" className="underline">Terms</Link>
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => persist('accepted')}
                className="btn-primary text-[13px] px-3.5 py-2"
              >
                Accept essentials
              </button>
              <button
                type="button"
                onClick={() => setPhase('configure')}
                className="btn-secondary text-[13px] px-3.5 py-2"
              >
                Configure
              </button>
              <button
                type="button"
                onClick={() => persist('declined')}
                className="text-[11.5px] text-ink-500 dark:text-cream-100/55 hover:text-forest-900 dark:hover:text-cream-100 underline ml-auto"
              >
                Decline non-essentials
              </button>
            </div>
          </div>
        )}

        {phase === 'configure' && (
          <div className="px-5 py-4 space-y-3.5">
            <p className="text-[13px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
              Strictly-necessary cookies are always on; nothing else is currently in use.
            </p>
            <ul className="space-y-2">
              <PrefToggle
                title="Strictly necessary"
                desc="Session, auth, CSRF. Required to sign in."
                checked
                disabled
              />
              <PrefToggle
                title="Functional"
                desc="UI preferences in local storage."
                checked
                disabled
              />
              <PrefToggle
                title="Analytics"
                desc="Not in use today; reserved for future opt-in."
                checked={analytics}
                onChange={setAnalytics}
              />
              <PrefToggle
                title="Marketing"
                desc="Not in use today; reserved for future opt-in."
                checked={marketing}
                onChange={setMarketing}
              />
            </ul>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPhase('overview')}
                className="btn-ghost text-[12.5px]"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => persist('configured')}
                className="btn-primary text-[12.5px] ml-auto"
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

function PrefToggle({
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
    <li className="flex items-start justify-between gap-3 rounded-lg border border-ink-200 dark:border-forest-700/50 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-ink-950 dark:text-cream-100">{title}</p>
        <p className="text-[11px] text-ink-500 dark:text-cream-100/55 leading-relaxed mt-0.5">
          {desc}
        </p>
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
          className="absolute inset-0 rounded-full bg-ink-300 dark:bg-forest-700 peer-checked:bg-forest-900 dark:peer-checked:bg-gold-metal transition-colors"
        />
        <span
          aria-hidden
          className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4"
        />
      </label>
    </li>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
