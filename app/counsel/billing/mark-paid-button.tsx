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
      if (res.ok) router.refresh();
      else setError(res.error ?? t('Failed.'));
    });
  }
  return (
    <button
      type="button"
      onClick={go}
      disabled={pending}
      className="inline-flex items-center min-h-[40px] px-3 rounded-md text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-900/40 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50"
      title={error ?? t('Mark invoice as paid manually (eg. wire received outside Stripe)')}
    >
      {pending ? '...' : <T>Mark paid</T>}
    </button>
  );
}
