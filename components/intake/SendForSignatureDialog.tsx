'use client';

import { Dialog } from '@/components/Dialog';
import { CreateSigningRequestForm } from '@/app/counsel/documents/[id]/signing-form';
import { SEND_FOR_SIGNATURE_LABEL } from '@/lib/intake-signature-send';
import type { SigningDirection } from '@/lib/signing-authorization';

/**
 * The existing signing composer, opened over the ticket with one of the
 * ticket's own documents already chosen.
 *
 * There is deliberately no second composer here. CreateSigningRequestForm is
 * the form the documents surface uses, it already carries the signer list, the
 * message, the download choice, the disclosure copy and the partial-send
 * recovery path, and it already calls router.refresh() on success, which is
 * what makes the ticket's Signing panel catch up without a reload. This file
 * is the frame around it and the document it is pointed at.
 */
export function SendForSignatureDialog({
  firmId,
  documentId,
  documentName,
  direction,
  onClose,
}: {
  firmId: string;
  documentId: string;
  /** Shown so the reader can see which file they are about to send. */
  documentName: string;
  /**
   * Which way this signature runs, taken from the answer the person filing
   * gave (lib/intake-signature-direction.ts) rather than chosen again here.
   * Asking a second time would let the two records disagree about the same
   * fact, and the ticket's answer is the one the legal team has been reading.
   */
  direction: SigningDirection;
  onClose: () => void;
}) {
  return (
    <Dialog onClose={onClose} ariaLabel={SEND_FOR_SIGNATURE_LABEL} size="lg">
      <div className="p-4 sm:p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-forest-900 dark:text-cream-100">
              {SEND_FOR_SIGNATURE_LABEL}
            </p>
            {/* The file name is the requester's or a colleague's words, so it
                is shown as written and kept away from the translator. */}
            <p
              data-no-translate
              className="mt-0.5 truncate text-[12px] text-ink-500 dark:text-cream-100/55"
            >
              {documentName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-ink-200 px-2.5 py-1 text-[12px] text-forest-900 dark:border-forest-700/50 dark:text-cream-100"
          >
            Close
          </button>
        </div>
        {direction === 'inbound' && (
          <p className="mb-3 text-[12px] leading-relaxed text-ink-500 dark:text-cream-100/55">
            This document came from the other party, so it goes to your legal
            team to authorise before anybody can sign it. Nothing is sent to
            them.
          </p>
        )}
        <CreateSigningRequestForm
          firmId={firmId}
          documentId={documentId}
          direction={direction}
        />
      </div>
    </Dialog>
  );
}
