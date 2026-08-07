'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  decideTemplateSubmissionAction,
  editTemplateSubmissionAction,
  retryTemplateReleaseAction,
} from '@/lib/template-submissions';
import type { ReviewAction, SubmissionStatus } from '@/lib/template-approval';
import type { DeliveryMode } from '@/lib/submission-dispatch';
import { T } from '@/components/i18n/LocaleProvider';

/**
 * The three outcomes: approve, edit, decline. Sending it back with a note is
 * the fourth thing this panel does and is deliberately not the same as
 * declining, because one of them keeps the submission alive and the other ends
 * it.
 *
 * Editing used to be refused here on the grounds that the document carries a
 * colleague's name and signature, so it is theirs to change. That concern is
 * real and it is answered by recording the edit rather than by refusing it:
 * the server keeps the employee's own text, stamps who changed it and when,
 * and tells them. What goes out is the edited version, and what they sent is
 * still readable beside it.
 *
 * Only a role that may release documents sees any of these controls, and the
 * server checks the same thing again on every one of them.
 *
 * `documentText` and `revision` are the wording this page actually rendered and
 * the version it came from, and both are sent with the edit and with the
 * decision. The server makes each conditional on them, so a colleague who
 * changed the wording while this page was open cannot have their change
 * silently overwritten, and nobody is recorded as approving text that arrived
 * after they read the page. When that happens the answer is to reload and look
 * again, which is what the server says. `revision` is the one the server's
 * conditional write swaps on, because it carries the same guarantee in a few
 * bytes and the whole document does not fit in a request URL.
 */
export function ReviewActions({
  submissionId,
  status,
  canApprove,
  recipientEmail,
  releaseError,
  documentText,
  revision,
  deliveryMode,
}: {
  submissionId: string;
  status: SubmissionStatus;
  canApprove: boolean;
  recipientEmail: string;
  releaseError: string | null;
  documentText: string;
  revision: number;
  /**
   * Which of the two deliveries approving performs. Required rather than
   * optional on purpose: the page that renders this panel is the only thing
   * that knows, it did not pass it, and an approver was told about a delivery
   * that was not going to happen. A required prop makes that omission a
   * compile error instead of a wrong sentence.
   */
  deliveryMode: DeliveryMode;
}) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(documentText);

  const decide = async (action: ReviewAction) => {
    setBusy(true);
    setError(null);
    const res = await decideTemplateSubmissionAction(
      submissionId,
      action,
      note,
      documentText,
      revision,
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Could not record that decision.');
      return;
    }
    router.refresh();
  };

  const saveEdit = async () => {
    setBusy(true);
    setError(null);
    const res = await editTemplateSubmissionAction(
      submissionId,
      draft,
      note,
      documentText,
      revision,
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Could not save that change.');
      return;
    }
    setEditing(false);
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
          ) : status === 'declined' ? (
            <T>
              This document is not going out. Nothing was sent, and your colleague has been
              told. If it should go out after all, they can fill the form again.
            </T>
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
          This is waiting on an owner, admin, or attorney. You can see who it is from and
          where it is going, and raise anything you notice with them.
        </T>
      </div>
    );
  }

  const inputCls =
    'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[14px] text-forest-900 outline-none focus:border-gold-500/70 focus:ring-2 focus:ring-gold-500/25 dark:border-forest-700/50 dark:bg-forest-900/60 dark:text-cream-100';

  return (
    <div className="space-y-3 rounded-xl border border-ink-200 bg-white p-4 dark:border-forest-700/50 dark:bg-forest-900/40">
      <p className="text-[13px] font-semibold text-forest-900 dark:text-cream-100">
        <T>Your decision</T>
      </p>
      {/* The mechanism, in the words the employee's own fill page uses for the
          same two deliveries. A reviewer approving a signature-mode document
          was told about the encrypted share, which is not what happens to it. */}
      <p className="text-[12.5px] text-ink-600 dark:text-cream-100/70">
        {deliveryMode === 'signature' ? (
          <T>
            Approving emails the recipient a link and a separate access code, and asks
            them to sign the document. You can change the wording first, send it back
            for your colleague to fix, or decide it is not going out.
          </T>
        ) : (
          <T>
            Approving sends the document to the recipient as an encrypted link, with the key
            in a separate email. You can change the wording first, send it back for your
            colleague to fix, or decide it is not going out.
          </T>
        )}
      </p>

      {editing ? (
        <div className="space-y-3">
          <p className="text-[12.5px] text-ink-600 dark:text-cream-100/70">
            <T>
              What you save here is what gets sent. The version your colleague submitted is
              kept on the record, your name and the time are stamped on the change, and they
              are told it was made.
            </T>
          </p>
          <textarea
            rows={18}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className={`${inputCls} font-serif text-[13.5px] leading-relaxed`}
            data-no-translate
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || !draft.trim() || draft === documentText}
              onClick={() => void saveEdit()}
              className="btn-primary disabled:opacity-50"
            >
              {busy ? <T>Saving…</T> : <T>Save the change</T>}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDraft(documentText);
                setEditing(false);
                setError(null);
              }}
              className="btn-secondary text-sm disabled:opacity-50"
            >
              <T>Leave it as it is</T>
            </button>
          </div>
          {draft === documentText && (
            <p className="text-[12px] text-ink-500 dark:text-cream-100/55">
              <T>Nothing has changed yet.</T>
            </p>
          )}
          {error && <p className="text-[12.5px] text-rose-700 dark:text-rose-300">{error}</p>}
        </div>
      ) : (
        <>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What should change, why it is not going out, or a note for the record"
            className={inputCls}
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
              disabled={busy}
              onClick={() => {
                setDraft(documentText);
                setEditing(true);
                setError(null);
              }}
              className="btn-secondary text-sm disabled:opacity-50"
            >
              <T>Edit the wording</T>
            </button>
            <button
              type="button"
              disabled={busy || !note.trim()}
              onClick={() => void decide('request_changes')}
              className="btn-secondary text-sm disabled:opacity-50"
            >
              <T>Send back with a note</T>
            </button>
            <button
              type="button"
              disabled={busy || !note.trim()}
              onClick={() => void decide('decline')}
              className="btn-secondary text-sm disabled:opacity-50"
            >
              <T>Decline, do not send</T>
            </button>
            <span className="text-[12px] text-ink-500 dark:text-cream-100/55">
              <T>Goes to</T> <span data-no-translate>{recipientEmail}</span>
            </span>
          </div>
          {!note.trim() && (
            <p className="text-[12px] text-ink-500 dark:text-cream-100/55">
              <T>
                A note is required to send it back or to decline, so your colleague knows
                where it landed.
              </T>
            </p>
          )}
          {error && <p className="text-[12.5px] text-rose-700 dark:text-rose-300">{error}</p>}
        </>
      )}
    </div>
  );
}
