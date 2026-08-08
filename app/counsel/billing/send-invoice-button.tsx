'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sendInvoiceAction } from '@/lib/invoicing';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * Issue a draft invoice to the client. Confirm-gated, because this is the
 * point at which a bill actually leaves the firm: the client email is shown
 * on the confirm step so a wrong address is caught before it is used.
 *
 * Feedback is honest either way. The action only reports success when the
 * client was actually reached, and when the email did not go out but the
 * client was notified in the app, that is said plainly rather than hidden
 * behind a green tick.
 */
export function SendInvoiceButton({
  invoiceId,
  clientEmail,
}: {
  invoiceId: string;
  clientEmail: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function go() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await sendInvoiceAction(invoiceId);
      if (res.ok) {
        setConfirming(false);
        if (res.emailed === false) {
          // Hold the page instead of refreshing: a refresh re-renders the
          // row as "sent", this control disappears with it, and the firm
          // never learns the email did not go out.
          setNotice(
            t(
              'Invoice marked sent and the client was notified in the app, but the email did not go out.',
            ),
          );
        } else {
          router.refresh();
        }
      } else {
        setError(res.error ?? t('Could not send this invoice.'));
      }
    });
  }

  if (notice) {
    return (
      <div className="flex flex-col items-end gap-1">
        <p className="text-[11px] text-amber-700 dark:text-amber-300 text-right max-w-[18rem]">
          {notice}
        </p>
        <button
          type="button"
          onClick={() => {
            setNotice(null);
            router.refresh();
          }}
          className="text-[11px] font-semibold underline text-foreground"
        >
          <T>Dismiss</T>
        </button>
      </div>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        className="inline-flex items-center min-h-[40px] px-3 rounded-md text-[11px] font-semibold text-foreground ring-1 ring-edge hover:bg-surface-2"
        title={t('Email this invoice to the client and mark it sent')}
      >
        <T>Send invoice</T>
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted">
          <T>Email this invoice to</T>{' '}
          <span className="font-semibold">{clientEmail}</span>
        </span>
        <button
          type="button"
          onClick={go}
          disabled={pending}
          className="inline-flex items-center min-h-[36px] px-2.5 rounded-md text-[11px] font-semibold text-white bg-forest-800 hover:bg-forest-900 disabled:opacity-50"
        >
          {pending ? <T>Sending...</T> : <T>Send</T>}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          disabled={pending}
          className="inline-flex items-center min-h-[36px] px-2.5 rounded-md text-[11px] font-semibold text-foreground ring-1 ring-edge disabled:opacity-50"
        >
          <T>Cancel</T>
        </button>
      </div>
      {error && (
        <p className="text-[11px] text-rose-700 dark:text-rose-300 text-right max-w-[18rem]">
          {error}
        </p>
      )}
    </div>
  );
}
