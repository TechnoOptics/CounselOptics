'use client';

import { useState } from 'react';

export function BillingActions({
  stripeReady,
  isActive,
  hasCustomer,
}: {
  stripeReady: boolean;
  isActive: boolean;
  hasCustomer: boolean;
}) {
  const [pending, setPending] = useState<'checkout' | 'portal' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout() {
    setPending('checkout');
    setError(null);
    try {
      const res = await fetch('/api/stripe/checkout', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not start checkout.');
      window.location.assign(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout.');
      setPending(null);
    }
  }

  async function openPortal() {
    setPending('portal');
    setError(null);
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not open billing portal.');
      window.location.assign(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open billing portal.');
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {!isActive ? (
          <button
            type="button"
            onClick={startCheckout}
            disabled={!stripeReady || pending !== null}
            className="btn-primary"
          >
            {pending === 'checkout' ? 'Opening Stripe…' : 'Subscribe — $100 / month'}
          </button>
        ) : (
          <button
            type="button"
            onClick={openPortal}
            disabled={!stripeReady || !hasCustomer || pending !== null}
            className="btn-secondary"
          >
            {pending === 'portal' ? 'Opening portal…' : 'Manage subscription'}
          </button>
        )}
      </div>
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}
    </div>
  );
}
