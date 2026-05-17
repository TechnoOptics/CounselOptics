'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

// Storage keys / cookie name. Both the legacy localStorage key and
// the cross-subdomain cookie name are read at boot so users who
// ack'd before the cross-domain migration aren't re-prompted.
const STORAGE_KEY = 'co-cookie-ack';
const COOKIE_KEY = 'co_cookie_ack';
type Choice = 'accepted' | 'declined' | 'configured';

/**
 * Where the cookie's Domain attribute should point so that one ack
 * on advottic.com is honored by enterprise.advottic.com,
 * hq.advottic.com, and any future tenant subdomain.
 *
 * Strategy (audit V5 CR-50):
 *   - Walk the hostname from right to left.
 *   - Skip the public-suffix label (last two labels usually: `co.uk`,
 *     `advottic.com`). We treat anything below the apex `.advottic.com`
 *     as a subdomain to share into.
 *   - Use `.advottic.com` when on advottic.com or *.advottic.com.
 *   - For localhost / IP / preview deploys (vercel.app), fall back
 *     to host-scoped (no Domain attr) - there's nothing to share.
 *
 * We intentionally don't try to detect arbitrary parent domains; the
 * production deployment lives on advottic.com and we hard-code that.
 */
function consentCookieDomain(): string | null {
  if (typeof location === 'undefined') return null;
  const host = location.hostname;
  // Bare apex + every subdomain of advottic.com → write at parent.
  if (host === 'advottic.com' || host.endsWith('.advottic.com')) {
    return '.advottic.com';
  }
  return null;
}

/**
 * Read the existing consent record. Tries the cross-subdomain cookie
 * first (post-V5 storage), then falls back to the host-scoped
 * localStorage value users on the previous build may already have.
 */
function readStoredChoice(): { choice: Choice } | null {
  if (typeof document !== 'undefined') {
    const match = document.cookie
      .split(';')
      .map((p) => p.trim())
      .find((p) => p.startsWith(COOKIE_KEY + '='));
    if (match) {
      const raw = decodeURIComponent(match.slice(COOKIE_KEY.length + 1));
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.choice === 'string') {
          return { choice: parsed.choice as Choice };
        }
      } catch {
        /* fall through to localStorage */
      }
    }
  }
  try {
    const legacy = localStorage.getItem(STORAGE_KEY);
    if (!legacy) return null;
    const parsed = JSON.parse(legacy);
    if (parsed && typeof parsed.choice === 'string') {
      return { choice: parsed.choice as Choice };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Write the consent record to BOTH the cross-subdomain cookie and
 * legacy localStorage (the latter so a user who clears cookies but
 * keeps localStorage still doesn't get re-prompted, and for back-
 * compat with any older codepath still reading localStorage).
 */
function writeStoredChoice(payload: object) {
  const serialized = JSON.stringify(payload);
  // Cookie write
  try {
    if (typeof document !== 'undefined') {
      const domain = consentCookieDomain();
      // 13 months - Apple/Google's cap on first-party cookies.
      const maxAge = 60 * 60 * 24 * 397;
      const domainAttr = domain ? `; Domain=${domain}` : '';
      const secure = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie =
        `${COOKIE_KEY}=${encodeURIComponent(serialized)}; Max-Age=${maxAge}; Path=/${domainAttr}; SameSite=Lax${secure}`;
    }
  } catch {
    /* ignore */
  }
  // localStorage mirror
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    /* ignore */
  }
}

/**
 * GDPR-style cookie banner. On first visit we open the full
 * preferences dialog with a strong backdrop dim so it's the obvious
 * thing on screen - users should not have to hunt for a tiny pill
 * to give consent. They can still minimize it to a pill (close
 * button) if they want to defer. After a choice is persisted the
 * component renders nothing.
 *
 * Z-index sits at 50 so the legal-terms ConsentModal (z-55) wins
 * when a brand-new signed-in user sees both at once.
 */
export function CookieBanner() {
  const [show, setShow] = useState(false);
  // Default to expanded so the dialog opens itself on first paint
  // with the focus animation + backdrop dim. The mount effect below
  // confirms there's no stored choice before showing anything.
  const [expanded, setExpanded] = useState(true);
  // Focus the panel when the popup expands so it's the focal point
  // (consistent with the other notification pop-ups).
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (expanded) requestAnimationFrame(() => panelRef.current?.focus());
  }, [expanded]);
  const [phase, setPhase] = useState<'overview' | 'configure'>('overview');
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    // Read whichever store has the ack - cookie wins so a user who
    // ack'd on advottic.com is never re-prompted on enterprise. or
    // hq.advottic.com (audit V5 CR-50). If we only find a legacy
    // localStorage record, the writer below will mirror it into the
    // cookie on next persist() call.
    const stored = readStoredChoice();
    if (!stored) setShow(true);
  }, []);

  function persist(choice: Choice) {
    writeStoredChoice({
      choice,
      analytics,
      marketing,
      at: new Date().toISOString(),
    });
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

  // Expanded: centered modal on every breakpoint with a strong
  // backdrop dim so the rest of the screen reads as out-of-focus.
  // The user picks a choice or minimizes to the pill - tapping the
  // backdrop minimizes (does not auto-accept anything).
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cookie and privacy preferences"
      className="fixed inset-0 z-[50] flex items-center justify-center p-3 sm:p-6"
    >
      <button
        type="button"
        aria-label="Minimize cookie preferences"
        onClick={() => setExpanded(false)}
        className="absolute inset-0 bg-forest-950/70 backdrop-blur-md animate-fade-in"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative w-full max-w-md rounded-2xl bg-white dark:bg-forest-900 shadow-card-hover overflow-hidden animate-cookie-focus focus:outline-none"
        style={{
          boxShadow:
            '0 28px 80px -10px rgba(15,45,36,0.65), 0 0 90px rgba(213,187,126,0.32)',
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
            {/*
              Audit W20 V3 CR-26: the dialog used to offer "Accept
              essentials / Configure / Decline non-essentials" - but
              there ARE no non-essentials today (the /cookies page
              and the body text above both say so), so the decline +
              configure buttons read as theatre. Collapsed to a
              single "Got it" CTA. When/if we add non-essential
              cookies in the future, restore the toggle UI behind
              a feature flag.
            */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => persist('accepted')}
                className="btn-primary text-[13px] px-3.5 py-2"
              >
                Got it
              </button>
              <Link
                href="/cookies"
                className="text-[11.5px] text-ink-500 dark:text-cream-100/55 hover:text-forest-900 dark:hover:text-cream-100 underline ml-auto"
              >
                Read the full policy
              </Link>
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
