'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { resendSigningEmailsAction } from '@/lib/firm-actions';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * Re-send one signer's mail: the branded sign link, plus a freshly
 * minted access code if they are an outside signer. The recovery path
 * when a send was refused by the mail provider, and the way to nudge a
 * signer who lost the original. The failure is spelled out inline and
 * stays on screen, since a firm needs to know an email did not arrive.
 */
export function ResendButton({
  firmId,
  signatureId,
}: {
  firmId: string;
  signatureId: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function resend() {
    setError(null);
    setSent(false);
    startTransition(async () => {
      const res = await resendSigningEmailsAction(firmId, signatureId);
      if (res.ok) {
        setSent(true);
        router.refresh();
      } else {
        setError(res.error ?? t('Could not send. Try again shortly.'));
      }
    });
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={resend}
        disabled={pending}
        className="text-[11px] underline underline-offset-2 text-ink-600 dark:text-cream-100/70 hover:text-forest-900 dark:hover:text-cream-100 disabled:opacity-50"
      >
        {pending ? <T>Resending...</T> : <T>Resend email</T>}
      </button>
      {sent && (
        <span className="text-[11px] text-emerald-700 dark:text-emerald-300">
          <T>Sent again</T>
        </span>
      )}
      {error && (
        <span className="text-[11px] text-rose-700 dark:text-rose-300 max-w-[28ch] text-right">
          <T>Not sent:</T> <span data-no-translate>{error}</span>
        </span>
      )}
    </span>
  );
}
