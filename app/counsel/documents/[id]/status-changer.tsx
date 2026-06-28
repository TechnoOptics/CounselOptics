'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateFirmDocumentAction } from '@/lib/firm-actions';
import {
  FIRM_DOCUMENT_STATUSES,
  FIRM_DOCUMENT_STATUS_LABEL,
  FIRM_DOCUMENT_STATUS_TONE,
  type FirmDocumentStatus,
} from '@/lib/firm-types';

const TONE_CLASSES: Record<
  ReturnType<typeof toneOf>,
  string
> = {
  gray:
    'bg-ink-100 dark:bg-forest-800/50 text-ink-700 dark:text-cream-100/85 ring-ink-200 dark:ring-forest-700/40',
  blue:
    'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-200 ring-sky-200 dark:ring-sky-700/40',
  amber:
    'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 ring-amber-200 dark:ring-amber-700/40',
  green:
    'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-700/40',
  rose:
    'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 ring-rose-200 dark:ring-rose-700/40',
};

function toneOf(s: FirmDocumentStatus) {
  return FIRM_DOCUMENT_STATUS_TONE[s];
}

/**
 * Inline status changer for a document. Shows the current state as a
 * pill, opens a popover with all 12 workflow states + descriptions,
 * and writes through to firm_documents.status via a server action.
 *
 * Operators move documents through the workflow as the case
 * progresses - mark as "sent" when the request goes out, "signed_*"
 * once the right party has executed it, "overdue" if the deadline
 * passes, etc.
 */
export function DocumentStatusChanger({
  firmId,
  documentId,
  currentStatus,
  statusUpdatedAt,
}: {
  firmId: string;
  documentId: string;
  currentStatus: FirmDocumentStatus;
  statusUpdatedAt: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function pick(next: FirmDocumentStatus) {
    if (next === currentStatus) {
      setOpen(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await updateFirmDocumentAction(firmId, documentId, {
        status: next,
      });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error ?? 'Could not update status.');
      }
    });
  }

  const tone = toneOf(currentStatus);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md ring-1 text-[12px] font-semibold uppercase tracking-[0.12em] transition-colors ${TONE_CLASSES[tone]} disabled:opacity-50`}
      >
        {FIRM_DOCUMENT_STATUS_LABEL[currentStatus]}
        <span aria-hidden className="text-[9px]">▾</span>
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute z-40 mt-2 w-72 right-0 sm:left-0 sm:right-auto rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-900 shadow-xl p-2 space-y-0.5">
            {FIRM_DOCUMENT_STATUSES.map((s) => {
              const t = toneOf(s);
              const active = s === currentStatus;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => pick(s)}
                  disabled={pending}
                  className={`w-full text-left px-2.5 py-1.5 rounded-md text-[12.5px] transition-colors ${
                    active
                      ? TONE_CLASSES[t] + ' ring-1'
                      : 'hover:bg-ink-50 dark:hover:bg-forest-800/40 text-ink-800 dark:text-cream-100/85'
                  } disabled:opacity-50`}
                >
                  <span className="font-semibold">
                    {FIRM_DOCUMENT_STATUS_LABEL[s]}
                  </span>
                  <span className="block text-[10.5px] text-ink-500 dark:text-cream-100/55 mt-0.5">
                    {STATUS_HINT[s]}
                  </span>
                </button>
              );
            })}
            {error && (
              <p className="px-2.5 py-1.5 text-[11px] text-rose-700 dark:text-rose-200">
                {error}
              </p>
            )}
            <p className="px-2.5 py-1 text-[10px] text-ink-500 dark:text-cream-100/70 border-t border-ink-100 dark:border-forest-800/40 mt-1 pt-2 font-mono">
              Last moved {new Date(statusUpdatedAt).toLocaleString()}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

const STATUS_HINT: Record<FirmDocumentStatus, string> = {
  received: 'Incoming from external party',
  submitted: 'Uploaded internally, awaiting review',
  ready: 'Reviewed, ready to use or send',
  sent: 'Sent out for review or signing',
  pending: 'Waiting on a signer or counterparty',
  signed_internal: 'Executed by firm-side attorney',
  signed_employee: 'Signed by firm employee (internal HR)',
  signed_client: 'Signed by client',
  signed_other: 'Signed by counterparty / opposing',
  on_hold: 'Paused (deal halted, info awaited)',
  overdue: 'Past due date with no resolution',
  canceled: 'Canceled',
};
