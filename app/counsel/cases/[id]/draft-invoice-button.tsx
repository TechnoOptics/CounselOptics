'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { buildDraftInvoiceAction } from '@/lib/invoicing';
import { T, useT } from '@/components/i18n/LocaleProvider';

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
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');

  function go() {
    setError(null);
    if (!email.trim()) {
      setError(t('Client email is required.'));
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
        setError(res.error ?? t('Failed.'));
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
        <T>Draft invoice</T> ({fmtCents(unbilledCents)})
      </button>
    );
  }
  return (
    <div className="space-y-2 w-full sm:w-auto">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('Client name (optional)')}
        className="input text-sm"
      />
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t('Client email')}
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
          <T>Cancel</T>
        </button>
        <button
          type="button"
          onClick={go}
          className="btn-primary text-sm"
          disabled={pending}
        >
          {pending ? (
            <T>Drafting...</T>
          ) : (
            <>
              <T>Draft for</T> {fmtCents(unbilledCents)}
            </>
          )}
        </button>
      </div>
      <p className="text-[10.5px] text-ink-500 dark:text-cream-100/55 text-right">
        <T>Drafts</T> <em>{caseTitle}</em>; <T>opens billing dashboard.</T>
      </p>
    </div>
  );
}
