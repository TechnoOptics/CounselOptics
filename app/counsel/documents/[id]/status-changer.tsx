'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateFirmDocumentAction } from '@/lib/firm-actions';
import { useDismissable } from '@/components/hooks/useDismissable';
import {
  FIRM_DOCUMENT_STATUSES,
  FIRM_DOCUMENT_STATUS_LABEL,
  FIRM_DOCUMENT_STATUS_TONE,
  FIRM_TONE_COLOR,
  type FirmDocumentStatus,
} from '@/lib/firm-types';
import { pillSurface } from '@/components/counsel/StatusPill';
import { T, useT } from '@/components/i18n/LocaleProvider';

function colorOf(s: FirmDocumentStatus) {
  return FIRM_TONE_COLOR[FIRM_DOCUMENT_STATUS_TONE[s]] ?? FIRM_TONE_COLOR.gray;
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
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const boxRef = useDismissable<HTMLDivElement>(open, close);

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
        setError(res.error ?? t('Could not update status.'));
      }
    });
  }

  return (
    <div className="relative inline-block" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        style={pillSurface(colorOf(currentStatus))}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-semibold uppercase tracking-[0.12em] text-foreground transition-colors disabled:opacity-50"
      >
        {FIRM_DOCUMENT_STATUS_LABEL[currentStatus]}
        <span aria-hidden className="text-[9px]">▾</span>
      </button>
      {open && (
          <div
            role="menu"
            className="absolute z-40 mt-2 w-72 right-0 sm:left-0 sm:right-auto rounded-lg ring-1 ring-edge bg-surface shadow-xl p-2 space-y-0.5"
          >
            {FIRM_DOCUMENT_STATUSES.map((s) => {
              const active = s === currentStatus;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => pick(s)}
                  disabled={pending}
                  style={active ? pillSurface(colorOf(s)) : undefined}
                  className={`w-full text-left px-2.5 py-1.5 rounded-md text-[12.5px] transition-colors ${
                    active
                      ? 'text-foreground'
                      : 'hover:bg-surface-2 text-foreground'
                  } disabled:opacity-50`}
                >
                  <span className="font-semibold">
                    {FIRM_DOCUMENT_STATUS_LABEL[s]}
                  </span>
                  <span className="block text-[10.5px] text-muted mt-0.5">
                    <T>{STATUS_HINT[s]}</T>
                  </span>
                </button>
              );
            })}
            {error && (
              <p className="px-2.5 py-1.5 text-[11px] text-rose-700 dark:text-rose-200">
                {error}
              </p>
            )}
            <p className="px-2.5 py-1 text-[10px] text-muted border-t border-edge mt-1 pt-2 font-mono">
              <T>Last moved</T> {new Date(statusUpdatedAt).toLocaleString()}
            </p>
          </div>
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
