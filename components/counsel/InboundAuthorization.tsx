'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  INBOUND_AUTHORIZE_HEADING,
  inboundAuthorizeBody,
  readAuthorizationStatus,
} from '@/lib/signing-authorization';
import { thirdPartyPaperHeader } from '@/lib/document-provenance';
import { decideInboundAuthorizationAction } from '@/lib/signing-authorization-actions';
import { T } from '@/components/i18n/LocaleProvider';

/**
 * The legal team's decision on a document the other party sent us.
 *
 * WHAT THIS PANEL IS AND IS NOT. It is not a gate. app/sign/[token], the
 * document bytes route and recordSignature each refuse an unauthorised
 * inbound request for themselves, and the action behind this panel resolves
 * the caller's real role from the database before it writes. If this file
 * were deleted the document would still be unsignable; what would be lost is
 * the only way to make it signable.
 *
 * THE COPY IS THE OWNER'S, VERBATIM, and it lives in
 * lib/signing-authorization.ts rather than here so it can be tested: vitest
 * runs in environment node with no DOM, so a sentence left inside JSX is a
 * sentence no test can read.
 *
 * The note field is offered on both actions and required on only one. A
 * refusal with no reason leaves a colleague holding a document and nothing to
 * take back to the other party; an approval needs no explanation because the
 * document itself is the explanation. The note is the legal team's own record
 * and it is never shown to the employee: only the decision is theirs to read.
 */
export function InboundAuthorization({
  requestId,
  counterparty,
  signatoryName,
  authorizationStatus,
  canDecide,
}: {
  requestId: string;
  /** The party who sent it. Null when the request names no signer yet. */
  counterparty: string | null;
  /** Who would sign it, on our side. */
  signatoryName: string | null;
  authorizationStatus: unknown;
  /**
   * Whether THIS reader may decide. canApproveSubmissions, resolved on the
   * server and passed down. The action asks the same question again against
   * the caller's own session, so this only decides whether a control that
   * would be refused is offered at all.
   */
  canDecide: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const status = readAuthorizationStatus(authorizationStatus);
  const [firstLine, secondLine] = inboundAuthorizeBody({ counterparty, signatoryName });

  const decide = (decision: 'approve' | 'decline') => {
    setError(null);
    start(async () => {
      const res = await decideInboundAuthorizationAction(requestId, decision, note);
      if (!res.ok) {
        setError(res.error ?? 'That decision could not be saved just now.');
        return;
      }
      setNote('');
      router.refresh();
    });
  };

  return (
    <section className="card space-y-3 p-4 text-sm leading-relaxed">
      {/* The provenance line, first, because it is what a reviewer needs to
          know before they read a word of the document. Same sentence as the
          employee's copy of it, from one function. */}
      <p className="text-[12px] text-muted" data-no-translate>
        {thirdPartyPaperHeader(counterparty)}
      </p>

      <h2 className="text-[15px] font-semibold text-foreground">
        <T>{INBOUND_AUTHORIZE_HEADING}</T>
      </h2>
      {/* THESE THREE SENTENCES ARE NOT WRAPPED IN <T>, AND THAT IS THE POINT.
          Each of them has a party name interpolated into it: the counterparty
          who sent the document, and the colleague who would sign it. A <T>
          wrap sends its whole string to be translated, so wrapping these
          would put two real people's names into a translation request on
          every render. data-no-translate is the same mark every other piece
          of firm data on the counsel surface carries, and it is why the
          heading directly above, which is a frozen literal with nothing
          interpolated, IS wrapped. */}
      <p className="text-muted" data-no-translate>
        {firstLine}
      </p>
      <p className="text-muted" data-no-translate>
        {secondLine}
      </p>

      {status !== 'pending' ? (
        <p className="text-[13px] font-medium text-foreground">
          {status === 'approved' ? (
            <T>This has been authorised and can be signed.</T>
          ) : (
            <T>This is not being signed as it stands.</T>
          )}
        </p>
      ) : !canDecide ? (
        <p className="text-[13px] text-muted">
          <T>
            Authorising a document for signature is limited to owners, admins, and
            attorneys.
          </T>
        </p>
      ) : (
        <>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="What would need to change, if it should not be signed as it stands"
            aria-label="Note on this decision"
            className="input w-full py-2"
          />
          {error && (
            <p role="alert" className="text-[13px] text-warn-text">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => decide('approve')}
              className="btn-primary h-9 px-3 text-[12.5px]"
            >
              <T>Approve</T>
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => decide('decline')}
              className="btn-secondary h-9 px-3 text-[12.5px]"
            >
              <T>Send it back with a note</T>
            </button>
          </div>
        </>
      )}
    </section>
  );
}
