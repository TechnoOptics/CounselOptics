'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markInvoicePaidAction } from '@/lib/invoicing';

export function MarkPaidButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);
    startTransition(async () => {
      const res = await markInvoicePaidAction(invoiceId);
      if (res.ok) router.refresh();
      else setError(res.error ?? 'Failed.');
    });
  }
  return (
    <button
      type="button"
      onClick={go}
      disabled={pending}
      className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 hover:underline"
      title={error ?? 'Mark invoice as paid manually (eg. wire received outside Stripe)'}
    >
      {pending ? '...' : 'Mark paid'}
    </button>
  );
}
