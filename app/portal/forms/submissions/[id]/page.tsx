import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getWorkspacePersona } from '@/lib/persona';
import { getPortalTemplateAction } from '@/lib/firm-templates';
import { getTemplateSubmissionAction } from '@/lib/template-submissions';
import { isEditableBySubmitter } from '@/lib/template-approval';
import { displayTicket } from '@/lib/ticket-numbers';
import { resolveSubmissionSigningState } from '@/lib/template-submission-types';
import {
  opensSentence,
  resolveActivityVerdict,
  submitterActivitySentence,
} from '@/lib/signing-activity';
import { ExternalLink } from '@/components/ExternalLink';
import { PageHeader, SectionTitle } from '@/components/counsel/ui';
import { SubmissionStatusPill } from '@/components/portal/SubmissionStatusPill';
import { T } from '@/components/i18n/LocaleProvider';
import { FormFillClient } from '../../[id]/form-fill-client';
import { WithdrawButton } from './withdraw-button';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Document status · Hub' };

/**
 * What an employee sees after they send a filled form to legal: where it is,
 * who it is going to, and, if it came back, what to change. A returned
 * document reopens the form they already filled, prefilled, so fixing one
 * clause never means starting over.
 */
export default async function PortalSubmissionPage({ params }: { params: { id: string } }) {
  const persona = await getWorkspacePersona();
  if (persona.kind !== 'employee') redirect('/portal');

  const res = await getTemplateSubmissionAction(params.id);
  if (!res.ok || !res.submission) notFound();
  const submission = res.submission;
  // Null for every submission released as a read-only share, and for every
  // firm whose database has not had 20260807_flow_join.sql applied. The panel
  // below simply does not render in either case.
  const signing = res.signing ?? null;
  // Which of the two deliveries this took, resolved by the dispatcher's own
  // rule (resolveDispatchMode) inside the action. 'share' is what an absent
  // answer has always meant and is what every submission filed before the
  // column did.
  const deliveryMode = res.deliveryMode ?? 'share';
  const signingState = resolveSubmissionSigningState(
    signing,
    persona.employee.email ?? '',
  );

  const editable = isEditableBySubmitter(submission.status);
  const template = editable && submission.templateId
    ? (await getPortalTemplateAction(submission.firmId, submission.templateId)).template ?? null
    : null;

  if (editable && template) {
    return (
      <FormFillClient
        template={template}
        firmId={submission.firmId}
        firmName={persona.firm.name}
        employeeName={persona.employee.displayName ?? ''}
        employeeEmail={persona.employee.email ?? ''}
        submission={submission}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        size="sm"
        backLink={
          <Link href="/portal/forms" className="text-[12px] text-muted hover:underline">
            ← All forms
          </Link>
        }
        title={submission.templateName}
        subtitleClassName="mt-1"
        subtitle={
          submission.status === 'sent' ? (
            /* Both delivery modes end at 'sent' (see markSubmissionSent), so
               this branch has to say WHICH of the two happened. It used to
               assert the encrypted link and the decryption key whatever the
               mode, which for a signature-mode document told the employee, as
               a completed fact, that something was mailed which was not. They
               are the person the recipient phones to ask what they were sent. */
            deliveryMode === 'signature' ? (
              <T>
                Your legal team approved this and we emailed the recipient a link and a
                separate access code, and asked them to sign it.
              </T>
            ) : (
              <T>
                Your legal team approved this and it has been sent to the recipient as an
                encrypted link. The decryption key went to them in a separate email.
              </T>
            )
          ) : submission.status === 'approved' ? (
            <T>
              Approved. Delivery to the recipient has not completed yet; your legal team can
              send it again from their side.
            </T>
          ) : submission.status === 'withdrawn' ? (
            <T>You withdrew this document. Nothing was sent.</T>
          ) : submission.status === 'declined' ? (
            <T>
              Your legal team has decided this one is not going out. Nothing was sent, and
              their reason is below. If you need something along these lines, talk to them
              or file a request.
            </T>
          ) : (
            <T>
              This is with your legal team. Nothing has been sent to the recipient yet, and
              you will be notified as soon as someone has looked at it.
            </T>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        {/* The reference for this document. It is the thing to quote when
            asking the legal team about it, so it sits with the status rather
            than at the bottom of the page. */}
        <span className="text-[12.5px] text-muted">
          <T>Reference</T>
        </span>
        <span
          className="font-mono text-[13px] text-gold-700 dark:text-gold-300"
          data-no-translate
        >
          {displayTicket(submission)}
        </span>
        <SubmissionStatusPill status={submission.status} />
        <span className="text-[12.5px] text-muted">
          <T>Recipient</T>
        </span>
        <span className="text-[13px] text-foreground" data-no-translate>
          {submission.recipientName
            ? `${submission.recipientName} (${submission.recipientEmail})`
            : submission.recipientEmail}
        </span>
        {submission.status === 'pending' && <WithdrawButton submissionId={submission.id} />}
      </div>

      {/* The end of the process, on the employee's own page.
          Until this, nothing on any portal surface read a signing request, so
          the colleague who filed the document was told it had gone out and
          then heard nothing again. Names and dates sit OUTSIDE <T> and carry
          data-no-translate: <T> resolves through machine translation and a
          person's name is not a phrase to translate. */}
      {signingState && (
        <section className="rounded-xl border border-edge bg-surface p-5">
          <SectionTitle className="mb-2">Signed document</SectionTitle>
          <p className="text-[13px] text-foreground">
            {signingState.kind === 'complete' ? (
              <T>Everyone has signed this. The signed copy is below.</T>
            ) : signingState.kind === 'your_turn' ? (
              <>
                <T>Signed by</T>{' '}
                <span data-no-translate>{signingState.signedBy}</span>
                <T>. Your signature is next.</T>
              </>
            ) : signingState.kind === 'halted' ? (
              <T>This document is not out for signature at the moment.</T>
            ) : signingState.waitingOn ? (
              <>
                <T>Waiting for</T> <span data-no-translate>{signingState.waitingOn}</span>{' '}
                <T>to sign.</T>
              </>
            ) : (
              <T>Every signature is in. The signed copy is being prepared.</T>
            )}
          </p>

          {signing && signing.signers.length > 0 && (
            <ul className="mt-3 space-y-2">
              {signing.signers.map((s) => {
                // What happened to this person's link, in the words the
                // person who filed the document is owed.
                //
                // They have been told their document went out and then heard
                // nothing until a signature landed, which for a document that
                // is never signed is nothing, ever. This is the answer to
                // that: it was opened, or it was not, and how long it has
                // been. It is not an answer about the recipient. There is no
                // address and no device here, and there is no field on this
                // object that could carry one (see SubmitterOpenActivity).
                //
                // An absent `activity` means the events could not be read,
                // which is not the same fact as no opens, so nothing is said.
                const verdict = s.activity
                  ? resolveActivityVerdict({
                      signedAt: s.signedAt,
                      response: s.response,
                      sentAt: signing.sentAt,
                      activity: s.activity,
                      now: new Date(),
                    })
                  : null;
                const opens = s.activity ? opensSentence(s.activity) : null;
                return (
                  <li key={s.email} className="text-[12.5px] text-muted">
                    <span data-no-translate>{s.name?.trim() || s.email}</span>
                    {' · '}
                    {s.signedAt ? (
                      <span data-no-translate>
                        {new Date(s.signedAt).toLocaleDateString()}
                      </span>
                    ) : (
                      <T>not signed yet</T>
                    )}
                    {verdict && verdict.kind !== 'signed' && (
                      <span className="block text-foreground">
                        {submitterActivitySentence(verdict)}
                        {opens ? ` ${opens}` : ''}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* The employee's own turn.
              This is the end of the client's sentence: after the counterparty
              signs, the employee is prompted to sign and date their own part.
              They reach the ceremony from here rather than from an email,
              which is also why the sign page requires them to be signed in:
              an internal signer is issued no access code, so the session is
              what proves it is them. The link carries their own signing
              token and nobody else's (see loadSubmissionSigning). */}
          {signingState.kind === 'your_turn' && signing?.yourSignToken && (
            <div className="mt-4">
              <Link
                href={`/sign/${signing.yourSignToken}`}
                className="btn-primary inline-flex text-[12px]"
              >
                <T>Sign your part</T>
              </Link>
              <p className="mt-2 text-[12.5px] text-muted">
                <T>
                  You will see the document with their signature on it before you
                  sign. Nothing is sent until you do.
                </T>
              </p>
            </div>
          )}

          {signing?.executedUrl ? (
            <ExternalLink
              href={signing.executedUrl}
              className="mt-4 inline-block btn text-[12px] ring-1 ring-gold-500/40 text-gold-700 hover:bg-gold-500/10 dark:text-gold-200"
              download={`${submission.templateName}.pdf`}
            >
              <T>Download the signed document</T>
            </ExternalLink>
          ) : (
            signingState.kind === 'complete' && (
              // Said plainly rather than shown as an empty space, the same way
              // the counsel surfaces state a missing executed copy. A page that
              // says "fully signed" with nothing under it reads as a bug the
              // employee has to guess at.
              <p className="mt-3 text-[12.5px] text-muted">
                <T>
                  The signed copy could not be opened just now. Reload the page,
                  and if it stays this way your legal team can send it to you.
                </T>
              </p>
            )
          )}
        </section>
      )}

      {submission.decisionNote && submission.status !== 'pending' && (
        <div className="rounded-xl border border-edge bg-surface px-4 py-3">
          <p className="text-[13px] font-semibold text-foreground">
            <T>Note from the legal team</T>
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[13px] text-foreground" data-no-translate>
            {submission.decisionNote}
          </p>
        </div>
      )}

      {submission.editedAt && (
        <div className="rounded-xl border border-edge bg-surface px-4 py-3">
          <p className="text-[13px] font-semibold text-foreground">
            <T>The legal team adjusted the wording</T>
          </p>
          <p className="mt-1 text-[13px] text-foreground">
            <T>
              The document below is the version they changed, and it is the one that goes to
              the recipient. What you sent is kept underneath it.
            </T>
          </p>
          <p className="mt-1 text-[12px] text-muted" data-no-translate>
            {`${submission.editedByName ?? 'The legal team'} · ${new Date(submission.editedAt).toLocaleString()}`}
          </p>
          {submission.editNote && (
            <p className="mt-2 whitespace-pre-wrap text-[13px] text-foreground" data-no-translate>
              {submission.editNote}
            </p>
          )}
        </div>
      )}

      <section className="rounded-xl border border-edge bg-surface p-6">
        <SectionTitle className="mb-3">Document</SectionTitle>
        {submission.documentVisible ? (
          <div
            className="max-h-[70vh] overflow-y-auto whitespace-pre-wrap font-serif text-[13.5px] leading-relaxed text-foreground"
            data-no-translate
          >
            {submission.documentText}
          </div>
        ) : (
          <p className="text-[13px] text-muted">
            <T>The wording of this document is not open to you.</T>
          </p>
        )}
      </section>

      {submission.originalDocumentText && (
        <details className="rounded-xl border border-edge bg-surface p-4">
          <summary className="cursor-pointer text-[13px] font-semibold text-foreground">
            <T>What you sent, before the edit</T>
          </summary>
          <div
            className="mt-3 max-h-[50vh] overflow-y-auto whitespace-pre-wrap font-serif text-[13.5px] leading-relaxed text-foreground"
            data-no-translate
          >
            {submission.originalDocumentText}
          </div>
        </details>
      )}
    </div>
  );
}
