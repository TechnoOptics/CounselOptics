'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { withdrawTemplateSubmissionAction } from '@/lib/template-submissions';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { ConfirmDialog } from '@/components/ConfirmDialog';

/**
 * Pull a document back while it is still waiting on the legal team.
 *
 * Confirmed, because it reaches another person: the document is already in the
 * legal team's queue and withdrawing takes it out from under them. Getting it
 * back in front of them is a fresh submission, not an undo on this button.
 */
export function WithdrawButton({ submissionId }: { submissionId: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function withdraw() {
    setBusy(true);
    setError(null);
    const res = await withdrawTemplateSubmissionAction(submissionId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? t('Could not withdraw this.'));
      return;
    }
    router.refresh();
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => setConfirming(true)}
        className="text-[12.5px] text-muted underline hover:text-foreground disabled:opacity-50"
      >
        <T>Withdraw</T>
      </button>
      {error && <span className="text-[12px] text-rose-700 dark:text-rose-300">{error}</span>}

      {confirming && (
        <ConfirmDialog
          question={t('Withdraw this from review?')}
          detail={t('It comes out of the legal team\u2019s queue and they stop seeing it. To have it looked at you would submit it again.')}
          confirmLabel={t('Withdraw')}
          cancelLabel={t('Leave it with them')}
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void withdraw();
          }}
        />
      )}
    </span>
  );
}
