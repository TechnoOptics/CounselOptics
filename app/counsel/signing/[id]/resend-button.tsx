'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { resendSigningEmailsAction } from '@/lib/firm-actions';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * Re-send one signer's mail: the branded sign link, plus a freshly
 * minted access code if they are an outside signer. The recovery path
 * when a send was refused by the mail provider, or when the signer lost
 * the original. The failure is spelled out inline and stays on screen,
 * since a firm needs to know an email did not arrive.
 *
 * For an outside signer this rotates a credential, and the copy has to
 * say so. The old code stops working the moment the new one is sent, and
 * a signer who had already unlocked the document is asked for the new
 * code the next time they open the link - so an operator reaching for
 * this as a friendly nudge would otherwise interrupt someone who was
 * partway through signing. It stays one button, and stays the recovery
 * action: a link-only nudge would be a second mode on a public endpoint,
 * and the honest label costs nothing.
 */
export function ResendButton({
  firmId,
  signatureId,
  rotatesCode = false,
  alreadyUnlocked = false,
}: {
  firmId: string;
  signatureId: string;
  /** Outside signer: resending mints a new access code. */
  rotatesCode?: boolean;
  /** They have already entered the current code at least once. */
  alreadyUnlocked?: boolean;
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
        title={
          rotatesCode
            ? t(
                'Sends the link again with a new access code. The code they have now stops working.',
              )
            : t('Sends the sign link again.')
        }
        className="text-[11px] underline underline-offset-2 text-ink-600 dark:text-cream-100/70 hover:text-forest-900 dark:hover:text-cream-100 disabled:opacity-50"
      >
        {pending ? (
          <T>Resending...</T>
        ) : rotatesCode ? (
          <T>Resend with a new code</T>
        ) : (
          <T>Resend email</T>
        )}
      </button>
      {rotatesCode && alreadyUnlocked && !sent && !error && (
        <span className="text-[11px] text-ink-500 dark:text-cream-100/55 max-w-[28ch] text-right">
          <T>They have already entered their code. A new one asks them for it again.</T>
        </span>
      )}
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
