'use client';

import { useEffect, useState } from 'react';

/**
 * Firm free-trial notice, pinned to the very top of the counsel workspace.
 * Cosmetic only - full features stay on the whole time (the account is
 * entitled independently). The user can dismiss it, but the dismissal is
 * per-SESSION (sessionStorage), so it reappears next visit - the firm asked
 * that the banner stay seen. Calm, professional tone.
 */
export function CounselTrialBanner({
  firmName,
  daysLeft,
}: {
  firmName: string;
  daysLeft: number;
}) {
  const [hidden, setHidden] = useState(true);

  // Read dismissal after mount so SSR + first paint agree (avoids hydration
  // flicker); the banner reveals itself only if this session hasn't closed it.
  useEffect(() => {
    try {
      setHidden(sessionStorage.getItem('adv_trial_banner_dismissed') === '1');
    } catch {
      setHidden(false);
    }
  }, []);

  if (hidden) return null;

  const days = Math.max(0, Math.round(daysLeft));
  const dayLabel = days === 1 ? 'day' : 'days';

  return (
    <div className="relative z-30 border-b border-gold-500/30 bg-gradient-to-r from-gold-500/15 via-gold-400/10 to-gold-500/15">
      <div className="mx-auto flex w-full max-w-none items-center gap-3 px-4 py-2 sm:px-6 lg:px-10">
        <span
          className="hidden h-5 items-center rounded-full bg-gold-400/20 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-gold-200 sm:inline-flex"
          aria-hidden
        >
          Free trial
        </span>
        <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-cream-100/90">
          <span className="font-semibold text-cream-100" data-no-translate>
            {firmName}
          </span>{' '}
          is on a 30‑day free trial, with all features included. Your trial{' '}
          {days > 0 ? (
            <>
              expires in{' '}
              <span className="font-semibold text-gold-200">
                {days} {dayLabel}
              </span>
              .
            </>
          ) : (
            <>has ended, but your access continues.</>
          )}
        </p>
        <button
          type="button"
          onClick={() => {
            try {
              sessionStorage.setItem('adv_trial_banner_dismissed', '1');
            } catch {
              /* private mode - just hide for now */
            }
            setHidden(true);
          }}
          aria-label="Dismiss trial notice"
          className="shrink-0 rounded-md p-1 text-cream-100/60 transition-colors hover:bg-cream-100/10 hover:text-cream-100"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
