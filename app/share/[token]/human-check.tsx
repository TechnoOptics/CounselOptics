'use client';

import { useEffect, useRef, useState } from 'react';
import { loadTurnstileScript } from '@/components/turnstile-widget';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/**
 * Advottic's own "Confirm you are human" control. The visible UI is entirely
 * ours — a black+gold verification tile with a checkbox that animates through
 * verifying → verified. Underneath, Cloudflare Turnstile runs INVISIBLY
 * (execution: 'execute' + appearance: 'interaction-only') to produce the token
 * the server requires before decrypting; its widget only surfaces if
 * Cloudflare genuinely needs the visitor to interact with a challenge. Without
 * a configured site key the tile verifies instantly (env-gated, same as the
 * community forms).
 */
export function HumanCheck({ onToken }: { onToken: (token: string | null) => void }) {
  const [state, setState] = useState<'idle' | 'verifying' | 'verified' | 'error'>('idle');
  const holderRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const readyRef = useRef(false);

  // Mount the invisible widget once; it does nothing until execute() is called.
  useEffect(() => {
    if (!SITE_KEY || !holderRef.current) return;
    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (cancelled || !holderRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(holderRef.current, {
          sitekey: SITE_KEY,
          execution: 'execute',
          appearance: 'interaction-only',
          size: 'flexible',
          callback: (token) => {
            onToken(token);
            setState('verified');
          },
          'expired-callback': () => {
            onToken(null);
            setState('idle');
          },
          'error-callback': () => {
            onToken(null);
            setState('error');
          },
        });
        readyRef.current = true;
      })
      .catch(() => setState('error'));
    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // No site key configured: the control verifies instantly on click.
  const configured = Boolean(SITE_KEY);

  function start() {
    if (state === 'verifying' || state === 'verified') return;
    if (!configured) {
      onToken('skip');
      setState('verified');
      return;
    }
    if (!readyRef.current || !holderRef.current || !window.turnstile) {
      setState('error');
      return;
    }
    setState('verifying');
    try {
      if (state === 'error' && widgetIdRef.current) window.turnstile.reset(widgetIdRef.current);
      window.turnstile.execute(holderRef.current);
    } catch {
      setState('error');
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={start}
        aria-pressed={state === 'verified'}
        disabled={state === 'verified'}
        className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors ${
          state === 'verified'
            ? 'border-gold-500/50 bg-gold-500/10'
            : 'border-ink-200 dark:border-forest-700/60 bg-white dark:bg-forest-950 hover:border-gold-500/60'
        }`}
      >
        {/* Checkbox: empty → spinner → gold check. */}
        <span
          aria-hidden
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ring-1 transition-colors ${
            state === 'verified'
              ? 'bg-gold-500 ring-gold-500 text-forest-950'
              : 'bg-transparent ring-ink-300 dark:ring-forest-600'
          }`}
        >
          {state === 'verifying' ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gold-500/30 border-t-gold-500" />
          ) : state === 'verified' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-forest-900 dark:text-cream-50">
            {state === 'verified' ? 'Verified — you are human' : state === 'verifying' ? 'Verifying…' : 'Confirm you are human'}
          </span>
          <span className="block text-[11px] text-forest-400 dark:text-cream-100/40">
            {state === 'error'
              ? 'Verification failed — tap to try again.'
              : 'Advottic Secure Access · required to decrypt'}
          </span>
        </span>
        {/* Gold shield */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden className={state === 'verified' ? 'text-gold-500' : 'text-forest-300 dark:text-cream-100/25'}>
          <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {/* Cloudflare's widget lives here, invisible unless it must show an
          interactive challenge (rare). */}
      <div ref={holderRef} className="mt-2 flex justify-center empty:hidden" />
    </div>
  );
}
