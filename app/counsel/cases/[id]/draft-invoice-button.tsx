'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { buildDraftInvoiceAction } from '@/lib/invoicing';

function fmtCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

export function DraftInvoiceButton({
  firmId,
  caseId,
  caseTitle,
  unbilledCents,
}: {
  firmId: string;
  caseId: string;
  caseTitle: string;
  unbilledCents: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');

  function go() {
    setError(null);
    if (!email.trim()) {
      setError('Client email is required.');
      return;
    }
    startTransition(async () => {
      const res = await buildDraftInvoiceAction(
        firmId,
        caseId,
        email.trim().toLowerCase(),
        name.trim() || null,
      );
      if (res.ok && res.invoiceId) {
        router.push(`/counsel/billing`);
      } else {
        setError(res.error ?? 'Failed.');
      }
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="btn-primary text-sm"
      >
        Draft invoice ({fmtCents(unbilledCents)})
      </button>
    );
  }
  return (
    <div className="space-y-2 w-full sm:w-auto">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Client name (optional)"
        className="input text-sm"
      />
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Client email"
        type="email"
        className="input text-sm"
      />
      {error && (
        <p className="text-[11px] text-rose-700 dark:text-rose-300">{error}</p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="btn-ghost text-sm"
          disabled={pending}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={go}
          className="btn-primary text-sm"
          disabled={pending}
        >
          {pending ? 'Drafting...' : `Draft for ${fmtCents(unbilledCents)}`}
        </button>
      </div>
      <p className="text-[10.5px] text-ink-500 dark:text-cream-100/55 text-right">
        Drafts <em>{caseTitle}</em>; opens billing dashboard.
      </p>
    </div>
  );
}
