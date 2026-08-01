'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markInvoicePaidAction } from '@/lib/invoicing';
import { T, useT } from '@/components/i18n/LocaleProvider';

export function MarkPaidButton({ invoiceId }: { invoiceId: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);
    startTransition(async () => {
      const res = await markInvoicePaidAction(invoiceId);
      // ok:true can still carry a warning: the invoice is paid, but the
      // Stripe payment link could not be switched off, so the client's Pay
      // button still works and someone has to deactivate it in Stripe.
      // Refresh either way, then show it.
      if (res.ok) router.refresh();
      if (res.error) setError(res.error);
      else if (!res.ok) setError(t('Failed.'));
    });
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="inline-flex items-center min-h-[40px] px-3 rounded-md text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-900/40 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50"
        title={error ?? t('Mark invoice as paid manually (eg. wire received outside Stripe)')}
      >
        {pending ? '...' : <T>Mark paid</T>}
      </button>
      {error && (
        <p className="text-[11px] text-rose-700 dark:text-rose-300 text-right max-w-[16rem]">
          {error}
        </p>
      )}
    </div>
  );
}
