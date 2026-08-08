'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { withdrawTemplateSubmissionAction } from '@/lib/template-submissions';
import { T } from '@/components/i18n/LocaleProvider';

/** Pull a document back while it is still waiting on the legal team. */
export function WithdrawButton({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await withdrawTemplateSubmissionAction(submissionId);
          setBusy(false);
          if (!res.ok) {
            setError(res.error ?? 'Could not withdraw this.');
            return;
          }
          router.refresh();
        }}
        className="text-[12.5px] text-muted underline hover:text-foreground disabled:opacity-50"
      >
        <T>Withdraw</T>
      </button>
      {error && <span className="text-[12px] text-rose-700 dark:text-rose-300">{error}</span>}
    </span>
  );
}
