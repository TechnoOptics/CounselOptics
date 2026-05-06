'use client';

import { useEffect, useState } from 'react';
import { TOKEN_PACKAGES, type TokenPackage } from '@/lib/token-packages';

/**
 * Compact Bella token top-up modal. Renders the four packs
 * (Boost / Boost+ / Power / Mega) and posts to
 * /api/billing/topup-checkout, which creates a Stripe Checkout
 * session and returns the URL we redirect to.
 *
 * `firmPool=true` when the user is acting in firm context - the
 * checkout session metadata then carries the firm_id so the
 * webhook credits the firm pool instead of the personal balance.
 */
export function TopUpModal({
  onClose,
  firmPool,
}: {
  onClose: () => void;
  firmPool: boolean;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function buy(p: TokenPackage) {
    setPending(p.id);
    setError(null);
    try {
      const r = await fetch('/api/billing/topup-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: p.id, firmPool }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      const j = (await r.json()) as { url?: string };
      if (j.url) {
        window.location.href = j.url;
        return;
      }
      throw new Error('No checkout URL.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-forest-950/70 backdrop-blur flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-white dark:bg-forest-900 ring-1 ring-white/10 shadow-2xl p-6 sm:p-8 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="space-y-1">
          <p className="eyebrow">Bella tokens</p>
          <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
            Top up your balance
          </h2>
          <p className="text-[13px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
            Tokens are consumed as Bella works on your tasks.{' '}
            {firmPool
              ? 'Top-ups credit the firm-wide pool.'
              : 'Top-ups credit your personal balance and roll over up to 2x your monthly grant.'}
          </p>
        </header>

        <ul className="grid sm:grid-cols-2 gap-3">
          {TOKEN_PACKAGES.map((p) => {
            const pricing = (p.priceCents / 100).toLocaleString('en-US', {
              style: 'currency',
              currency: 'USD',
            });
            return (
              <li
                key={p.id}
                className={`rounded-xl ring-1 p-4 flex flex-col gap-2 ${
                  p.recommended
                    ? 'ring-2 ring-gold-metal dark:ring-amber-500/60 bg-gradient-to-b from-amber-50/30 to-transparent dark:from-amber-950/15'
                    : 'ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40'
                }`}
              >
                <header className="flex items-baseline justify-between gap-2">
                  <p className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
                    {p.label}
                  </p>
                  {p.recommended && (
                    <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-amber-700 dark:text-amber-300">
                      Best value
                    </p>
                  )}
                </header>
                <p className="font-display text-2xl font-medium tabular-nums text-forest-900 dark:text-cream-100">
                  {pricing}
                </p>
                <p className="text-[11.5px] font-mono tabular-nums text-ink-600 dark:text-cream-100/65">
                  {p.tokens.toLocaleString()} tokens
                </p>
                <p className="text-[12px] text-ink-600 dark:text-cream-100/70 leading-snug flex-1">
                  {p.blurb}
                </p>
                <button
                  type="button"
                  onClick={() => buy(p)}
                  disabled={pending !== null}
                  className={p.recommended ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
                >
                  {pending === p.id ? 'Redirecting...' : `Buy ${p.label}`}
                </button>
              </li>
            );
          })}
        </ul>

        {error && (
          <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
            {error}
          </p>
        )}

        <footer className="flex items-center justify-between gap-3 pt-2 border-t border-ink-100 dark:border-forest-700/40">
          <p className="text-[11px] text-ink-500 dark:text-cream-100/55">
            Tokens never expire. Prices in USD. Tax (where applicable) added at checkout.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost text-sm"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
