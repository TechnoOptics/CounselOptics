'use client';

import { useState } from 'react';

type Size = 'small' | 'medium' | 'large';

const OFFERS: Array<{ size: Size; usd: number; tokens: number; label: string }> = [
  { size: 'small', usd: 5, tokens: 200_000, label: 'Quick top-up' },
  { size: 'medium', usd: 12, tokens: 600_000, label: 'Best for steady users' },
  { size: 'large', usd: 25, tokens: 1_500_000, label: 'Power user pack' },
];

/**
 * Three top-up buttons. Each posts to /api/stripe/topup with the size,
 * receives back a Stripe Checkout URL, and redirects the browser to it.
 * After payment, the webhook credits tokens and Stripe sends the user
 * back to /billing?topup=success.
 */
export function TopUpButtons() {
  const [pending, setPending] = useState<Size | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function buy(size: Size) {
    setError(null);
    setPending(size);
    try {
      const res = await fetch('/api/stripe/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ size }),
      });
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        throw new Error(json.error ?? 'Could not start checkout.');
      }
      window.location.href = json.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout.');
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {OFFERS.map((o) => (
          <button
            key={o.size}
            type="button"
            onClick={() => buy(o.size)}
            disabled={pending !== null}
            data-hide-on-ios
            className="card p-4 text-left transition-all hover:-translate-y-0.5 hover:ring-2 hover:ring-gold-400/50 disabled:opacity-60 disabled:cursor-wait"
          >
            <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-gold-700 dark:text-gold-300">
              {o.label}
            </p>
            <p className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 mt-1">
              ${o.usd}
            </p>
            <p className="text-[12px] text-ink-700 dark:text-cream-100/80 mt-1">
              {(o.tokens / 1000).toLocaleString()}k tokens
            </p>
            <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-1">
              {pending === o.size ? 'Opening checkout…' : 'Top up now'}
            </p>
          </button>
        ))}
      </div>
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </p>
      )}
    </div>
  );
}
