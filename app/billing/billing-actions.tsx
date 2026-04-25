'use client';

import { useState } from 'react';

export function ManageButton({
  stripeReady,
  hasCustomer,
}: {
  stripeReady: boolean;
  hasCustomer: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPortal() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not open billing portal.');
      window.location.assign(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open billing portal.');
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={openPortal}
        disabled={!stripeReady || !hasCustomer || pending}
        className="btn-secondary"
      >
        {pending ? 'Opening portal...' : 'Manage subscription'}
      </button>
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </p>
      )}
    </div>
  );
}
