'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  decideTemplateSubmissionAction,
  retryTemplateReleaseAction,
} from '@/lib/template-submissions';
import type { SubmissionStatus } from '@/lib/template-approval';
import { T } from '@/components/i18n/LocaleProvider';

/**
 * Approve, or send it back with a note. There is deliberately no edit here:
 * the document carries a colleague's name and signature, so it is theirs to
 * change. Approving is what sends it, and only a role that may release
 * documents sees the button; the server checks the same thing again.
 */
export function ReviewActions({
  submissionId,
  status,
  canApprove,
  recipientEmail,
  releaseError,
}: {
  submissionId: string;
  status: SubmissionStatus;
  canApprove: boolean;
  recipientEmail: string;
  releaseError: string | null;
}) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (action: 'approve' | 'request_changes') => {
    setBusy(true);
    setError(null);
    const res = await decideTemplateSubmissionAction(submissionId, action, note);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Could not record that decision.');
      return;
    }
    router.refresh();
  };

  const retry = async () => {
    setBusy(true);
    setError(null);
    const res = await retryTemplateReleaseAction(submissionId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Could not send it again.');
      return;
    }
    router.refresh();
  };

  if (status !== 'pending') {
    return (
      <div className="space-y-3 rounded-xl border border-ink-200 bg-white p-4 dark:border-forest-700/50 dark:bg-forest-900/40">
        <p className="text-[13px] text-ink-700 dark:text-cream-100/80">
          {status === 'sent' ? (
            <T>This has been sent to the recipient. No further action is needed.</T>
          ) : status === 'approved' ? (
            <T>Approved. The delivery has not completed yet and can be tried again.</T>
          ) : status === 'changes_requested' ? (
            <T>Sent back to your colleague. It will return here once they resend it.</T>
          ) : (
            <T>Your colleague withdrew this. Nothing was sent.</T>
          )}
        </p>
        {releaseError && (
          <p className="text-[12.5px] text-ink-500 dark:text-cream-100/55" data-no-translate>
            {releaseError}
          </p>
        )}
        {status === 'approved' && canApprove && (
          <button type="button" disabled={busy} onClick={() => void retry()} className="btn-primary disabled:opacity-50">
            {busy ? <T>Sending…</T> : <T>Try sending again</T>}
          </button>
        )}
        {error && (
          <p className="text-[12.5px] text-rose-700 dark:text-rose-300">{error}</p>
        )}
      </div>
    );
  }

  if (!canApprove) {
    return (
      <div className="rounded-xl border border-ink-200 bg-white p-4 text-[13px] text-ink-700 dark:border-forest-700/50 dark:bg-forest-900/40 dark:text-cream-100/80">
        <T>
          This is waiting on an owner, admin, or attorney. You can read it and raise anything
          you notice with them.
        </T>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-ink-200 bg-white p-4 dark:border-forest-700/50 dark:bg-forest-900/40">
      <p className="text-[13px] font-semibold text-forest-900 dark:text-cream-100">
        <T>Your decision</T>
      </p>
      <p className="text-[12.5px] text-ink-600 dark:text-cream-100/70">
        <T>
          Approving sends the document to the recipient as an encrypted link, with the key
          in a separate email. Sending it back returns it to your colleague to fix.
        </T>
      </p>
      <textarea
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What should change, or a note for the record"
        className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[14px] text-forest-900 outline-none focus:border-gold-500/70 focus:ring-2 focus:ring-gold-500/25 dark:border-forest-700/50 dark:bg-forest-900/60 dark:text-cream-100"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide('approve')}
          className="btn-primary disabled:opacity-50"
        >
          {busy ? <T>Working…</T> : <T>Approve and send</T>}
        </button>
        <button
          type="button"
          disabled={busy || !note.trim()}
          onClick={() => void decide('request_changes')}
          className="btn-secondary text-sm disabled:opacity-50"
        >
          <T>Send back with a note</T>
        </button>
        <span className="text-[12px] text-ink-500 dark:text-cream-100/55">
          <T>Goes to</T> <span data-no-translate>{recipientEmail}</span>
        </span>
      </div>
      {!note.trim() && (
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55">
          <T>A note is required to send it back, so your colleague knows what to change.</T>
        </p>
      )}
      {error && <p className="text-[12.5px] text-rose-700 dark:text-rose-300">{error}</p>}
    </div>
  );
}
