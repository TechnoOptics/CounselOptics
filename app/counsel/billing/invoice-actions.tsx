'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { voidInvoiceAction, deleteDraftInvoiceAction } from '@/lib/invoicing';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * Void (sent) or delete (draft) an invoice, releasing its billable time.
 * Confirm-gated: the first click reveals a confirm/cancel pair so a
 * mis-click can't wipe an invoice or free its time entries.
 */
export function InvoiceRowActions({
  firmId,
  invoiceId,
  status,
}: {
  firmId: string;
  invoiceId: string;
  status: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Draft = delete outright; sent = void (keep for the record).
  const isDraft = status === 'draft';
  if (status !== 'draft' && status !== 'sent') return null;

  const label = isDraft ? t('Delete draft') : t('Void invoice');

  function go() {
    setError(null);
    startTransition(async () => {
      const res = isDraft
        ? await deleteDraftInvoiceAction(firmId, invoiceId)
        : await voidInvoiceAction(firmId, invoiceId);
      if (res.ok) {
        // voidInvoiceAction returns ok:true with a warning message when
        // the entries couldn't be released - surface it, don't hide it.
        if (res.error) {
          setError(res.error);
          router.refresh();
        } else {
          setConfirming(false);
          router.refresh();
        }
      } else {
        setError(res.error ?? t('Failed.'));
      }
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        className="inline-flex items-center min-h-[40px] px-3 rounded-md text-[11px] font-semibold text-rose-700 dark:text-rose-300 ring-1 ring-rose-200 dark:ring-rose-900/40 hover:bg-rose-50 dark:hover:bg-rose-950/30"
        title={
          isDraft
            ? t('Delete this draft and return its time to billable')
            : t('Cancel this invoice and return its time to billable')
        }
      >
        {label}
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-ink-600 dark:text-cream-100/70">
          {isDraft ? <T>Delete &amp; release time?</T> : <T>Void &amp; release time?</T>}
        </span>
        <button
          type="button"
          onClick={go}
          disabled={pending}
          className="inline-flex items-center min-h-[36px] px-2.5 rounded-md text-[11px] font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50"
        >
          {pending ? '...' : <T>Confirm</T>}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          disabled={pending}
          className="inline-flex items-center min-h-[36px] px-2.5 rounded-md text-[11px] font-semibold text-ink-700 dark:text-cream-100/85 ring-1 ring-ink-200 dark:ring-forest-700/40 disabled:opacity-50"
        >
          <T>Cancel</T>
        </button>
      </div>
      {error && (
        <p className="text-[11px] text-rose-700 dark:text-rose-300 text-right max-w-[16rem]">
          {error}
        </p>
      )}
    </div>
  );
}
