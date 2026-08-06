import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getWorkspacePersona } from '@/lib/persona';
import { getPortalTemplateAction } from '@/lib/firm-templates';
import { getTemplateSubmissionAction } from '@/lib/template-submissions';
import { isEditableBySubmitter } from '@/lib/template-approval';
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
          <Link href="/portal/forms" className="text-[12px] text-ink-500 hover:underline dark:text-cream-100/55">
            ← All forms
          </Link>
        }
        title={submission.templateName}
        subtitleClassName="mt-1"
        subtitle={
          submission.status === 'sent' ? (
            <T>
              Your legal team approved this and it has been sent to the recipient as an
              encrypted link. The decryption key went to them in a separate email.
            </T>
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
        <SubmissionStatusPill status={submission.status} />
        <span className="text-[12.5px] text-ink-500 dark:text-cream-100/55">
          <T>Recipient</T>
        </span>
        <span className="text-[13px] text-forest-900 dark:text-cream-100" data-no-translate>
          {submission.recipientName
            ? `${submission.recipientName} (${submission.recipientEmail})`
            : submission.recipientEmail}
        </span>
        {submission.status === 'pending' && <WithdrawButton submissionId={submission.id} />}
      </div>

      {submission.decisionNote && submission.status !== 'pending' && (
        <div className="rounded-xl border border-ink-200 bg-white px-4 py-3 dark:border-forest-700/50 dark:bg-forest-900/40">
          <p className="text-[13px] font-semibold text-forest-900 dark:text-cream-100">
            <T>Note from the legal team</T>
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink-700 dark:text-cream-100/80" data-no-translate>
            {submission.decisionNote}
          </p>
        </div>
      )}

      {submission.editedAt && (
        <div className="rounded-xl border border-ink-200 bg-white px-4 py-3 dark:border-forest-700/50 dark:bg-forest-900/40">
          <p className="text-[13px] font-semibold text-forest-900 dark:text-cream-100">
            <T>The legal team adjusted the wording</T>
          </p>
          <p className="mt-1 text-[13px] text-ink-700 dark:text-cream-100/80">
            <T>
              The document below is the version they changed, and it is the one that goes to
              the recipient. What you sent is kept underneath it.
            </T>
          </p>
          <p className="mt-1 text-[12px] text-ink-500 dark:text-cream-100/55" data-no-translate>
            {`${submission.editedByName ?? 'The legal team'} · ${new Date(submission.editedAt).toLocaleString()}`}
          </p>
          {submission.editNote && (
            <p className="mt-2 whitespace-pre-wrap text-[13px] text-ink-700 dark:text-cream-100/80" data-no-translate>
              {submission.editNote}
            </p>
          )}
        </div>
      )}

      <section className="rounded-xl border border-ink-200 bg-white p-6 dark:border-forest-700/50 dark:bg-forest-900/40">
        <SectionTitle className="mb-3">Document</SectionTitle>
        <div
          className="max-h-[70vh] overflow-y-auto whitespace-pre-wrap font-serif text-[13.5px] leading-relaxed text-forest-900 dark:text-cream-100/90"
          data-no-translate
        >
          {submission.documentText}
        </div>
      </section>

      {submission.originalDocumentText && (
        <details className="rounded-xl border border-ink-200 bg-white p-4 dark:border-forest-700/50 dark:bg-forest-900/40">
          <summary className="cursor-pointer text-[13px] font-semibold text-forest-900 dark:text-cream-100">
            <T>What you sent, before the edit</T>
          </summary>
          <div
            className="mt-3 max-h-[50vh] overflow-y-auto whitespace-pre-wrap font-serif text-[13.5px] leading-relaxed text-ink-700 dark:text-cream-100/80"
            data-no-translate
          >
            {submission.originalDocumentText}
          </div>
        </details>
      )}
    </div>
  );
}
