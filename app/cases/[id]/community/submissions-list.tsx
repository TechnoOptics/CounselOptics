'use client';

import { useState, useTransition } from 'react';
import { getWitnessFileSignedUrl, markSubmissionReviewedAction } from '@/lib/community-actions';
import type { WitnessSubmission } from '@/lib/community-types';

export function SubmissionsList({
  caseId,
  communityCaseId: _communityCaseId,
  submissions,
}: {
  caseId: string;
  communityCaseId: string;
  submissions: WitnessSubmission[];
}) {
  const letters = submissions.filter((s) => s.kind === 'letter_of_support');
  const evidence = submissions.filter((s) => s.kind === 'evidence');

  return (
    <div className="card p-5 sm:p-6 space-y-4">
      <p className="eyebrow">
        Submissions ({submissions.length}) — private to you and your attorney
      </p>
      {submissions.length === 0 ? (
        <p className="text-sm text-ink-500 dark:text-cream-100/55">
          Nothing submitted yet. Share the public page link to start collecting support.
        </p>
      ) : (
        <>
          {letters.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-cream-100/55 mb-2">
                Letters of Support ({letters.length})
              </p>
              <ul className="space-y-3">
                {letters.map((s) => (
                  <SubmissionRow key={s.id} caseId={caseId} submission={s} />
                ))}
              </ul>
            </div>
          )}
          {evidence.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-cream-100/55 mb-2 mt-2">
                Evidence &amp; testimonials ({evidence.length})
              </p>
              <ul className="space-y-3">
                {evidence.map((s) => (
                  <SubmissionRow key={s.id} caseId={caseId} submission={s} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<WitnessSubmission['status'], string> = {
  pending_review: 'Pending review',
  received: 'Received',
  reviewed: 'Reviewed',
  flagged: 'Flagged',
  pending_purge: 'Scheduled for deletion',
  purged: 'Deleted',
};

function SubmissionRow({ caseId, submission }: { caseId: string; submission: WitnessSubmission }) {
  const [pending, startTransition] = useTransition();
  const [markingReviewed, startMarkReviewed] = useTransition();
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [idFrontUrl, setIdFrontUrl] = useState<string | null>(null);
  const [idBackUrl, setIdBackUrl] = useState<string | null>(null);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [status, setStatus] = useState(submission.status);
  const [confirmedRisk, setConfirmedRisk] = useState(false);

  const isPendingReview = status === 'pending_review';

  return (
    <li className="rounded-lg border border-ink-200 dark:border-forest-700/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-forest-900 dark:text-cream-100">
          {submission.fullName || 'Anonymous'}
        </p>
        <div className="flex items-center gap-2">
          <span
            className={`text-[11px] px-2 py-0.5 rounded-full ${
              isPendingReview
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                : 'bg-ink-100 text-ink-600 dark:bg-forest-800 dark:text-cream-100/70'
            }`}
          >
            {STATUS_LABEL[status]}
          </span>
          <p className="text-xs text-ink-500 dark:text-cream-100/55">
            {new Date(submission.createdAt).toLocaleString()}
          </p>
        </div>
      </div>

      {submission.mailingAddress && (
        <p className="text-xs text-ink-500 dark:text-cream-100/55 mt-1">
          {submission.mailingAddress.street}, {submission.mailingAddress.city},{' '}
          {submission.mailingAddress.state} {submission.mailingAddress.zip}
        </p>
      )}

      {submission.letterBody && (
        <p className="text-sm text-ink-700 dark:text-cream-100/80 mt-2 whitespace-pre-wrap">
          {submission.letterBody}
        </p>
      )}
      {submission.testimonialText && (
        <p className="text-sm text-ink-700 dark:text-cream-100/80 mt-2 whitespace-pre-wrap">
          {submission.testimonialText}
        </p>
      )}

      {submission.evidenceFilePath && (
        <div className="mt-3">
          {fileUrl ? (
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs">
              Open {submission.evidenceFileName || 'file'}
            </a>
          ) : (
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const url = await getWitnessFileSignedUrl(submission.id, 'evidence_file_path');
                  setFileUrl(url);
                })
              }
            >
              {pending ? 'Loading…' : `View ${submission.evidenceFileName || 'file'}`}
            </button>
          )}
        </div>
      )}

      {(submission.idFrontPath || submission.idBackPath || submission.signatureImagePath) && (
        <div className="mt-3 rounded-lg border border-dashed border-ink-300 dark:border-forest-700/60 p-3 space-y-2">
          <p className="text-xs font-semibold text-ink-700 dark:text-cream-100/80">
            ID &amp; signature (never shown publicly)
          </p>
          {isPendingReview && !confirmedRisk ? (
            <div className="text-xs text-amber-800 dark:text-amber-200 space-y-2">
              <p>
                This file hasn&rsquo;t been scanned for malware yet. Only open it if the letter
                text and sender look legitimate, and avoid opening it on a machine with access to
                other client files.
              </p>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setConfirmedRisk(true)}
              >
                I understand — show file options
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <FileRevealButton
                label="Front of ID"
                url={idFrontUrl}
                onLoad={async () => setIdFrontUrl(await getWitnessFileSignedUrl(submission.id, 'id_front_path'))}
              />
              <FileRevealButton
                label="Back of ID"
                url={idBackUrl}
                onLoad={async () => setIdBackUrl(await getWitnessFileSignedUrl(submission.id, 'id_back_path'))}
              />
              <FileRevealButton
                label="Signature"
                url={signatureUrl}
                onLoad={async () =>
                  setSignatureUrl(await getWitnessFileSignedUrl(submission.id, 'signature_image_path'))
                }
              />
            </div>
          )}
          {isPendingReview && (
            <button
              type="button"
              className="btn-primary text-xs mt-1"
              disabled={markingReviewed}
              onClick={() =>
                startMarkReviewed(async () => {
                  const result = await markSubmissionReviewedAction(submission.id, caseId);
                  if (result.ok) setStatus('reviewed');
                })
              }
            >
              {markingReviewed ? 'Saving…' : 'Mark reviewed'}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function FileRevealButton({
  label,
  url,
  onLoad,
}: {
  label: string;
  url: string | null;
  onLoad: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs">
        Open {label}
      </a>
    );
  }
  return (
    <button
      type="button"
      className="btn-secondary text-xs"
      disabled={pending}
      onClick={() => startTransition(onLoad)}
    >
      {pending ? 'Loading…' : `View ${label}`}
    </button>
  );
}
