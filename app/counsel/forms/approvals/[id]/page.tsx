import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { getTemplateSubmissionAction } from '@/lib/template-submissions';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { signedMarkUrl } from '@/lib/template-signature';
import { normalizeCategory } from '@/lib/document-category';
import { displayTicket } from '@/lib/ticket-numbers';
import { DocumentSheets } from '@/components/DocumentSheets';
import { PageHeader, SectionTitle } from '@/components/counsel/ui';
import { SubmissionStatusPill } from '@/components/portal/SubmissionStatusPill';
import { T } from '@/components/i18n/LocaleProvider';
import { ReviewActions } from './review-actions';
import { SubmissionPreviewButton } from './preview-button';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Review document · Counsel' };

/**
 * One document under review: exactly what would be sent, and exactly who it
 * would go to. The decision lives at the bottom, after the document, because
 * that is the order the reviewer should meet them in.
 */
export default async function CounselApprovalDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');

  const res = await getTemplateSubmissionAction(params.id);
  if (!res.ok || !res.submission || res.viewer !== 'legal') notFound();
  const s = res.submission;

  // The mark, fetched here and rendered inside the same block as the document
  // it belongs to. Both come from one place and are gated by one check, so a
  // surface that later withholds the document withholds the signature with it
  // rather than showing a signature on a document nobody may read. The URL is
  // short lived because the bucket is private and has to stay that way.
  //
  // documentVisible is the gate, and it is read here rather than only at the
  // render site: a reviewer who may not read the wording is not handed a URL
  // to the signature on it either.
  const admin = s.documentVisible ? createAdminSupabase() : null;
  const markUrl = admin ? await signedMarkUrl(admin, s.signatureImagePath) : null;

  return (
    <div className="space-y-5 animate-fade-up">
      <PageHeader
        size="sm"
        backLink={
          <Link
            href="/counsel/forms/approvals"
            className="text-[12px] text-ink-500 hover:underline dark:text-cream-100/55"
          >
            ← Document approvals
          </Link>
        }
        title={s.templateName}
        subtitleClassName="mt-1"
        subtitle={<T>Filled by a colleague and addressed to someone outside the company.</T>}
      />

      <div className="grid gap-3 rounded-xl border border-ink-200 bg-white p-4 text-[13px] sm:grid-cols-2 dark:border-forest-700/50 dark:bg-forest-900/40">
        {/* The reference and the kind of document, first, because they are
            what a colleague quotes on the phone about this record. Both come
            from one helper each, so this page and the queue never disagree
            about what a document is called or what it is filed under. */}
        <Detail label="Reference">
          <span className="font-mono text-[12.5px]" data-no-translate>
            {displayTicket(s)}
          </span>
        </Detail>
        <Detail label="Category">
          <span data-no-translate>{normalizeCategory(s.category)}</span>
        </Detail>
        <Detail label="Status">
          <SubmissionStatusPill status={s.status} />
        </Detail>
        <Detail label="Filled by">
          <span data-no-translate>{s.submitterName ?? s.submitterEmail ?? 'A colleague'}</span>
        </Detail>
        <Detail label="Recipient">
          <span data-no-translate>
            {s.recipientName ? `${s.recipientName} (${s.recipientEmail})` : s.recipientEmail}
          </span>
        </Detail>
        <Detail label="Signed as">
          <span data-no-translate>{s.signatureName}</span>
        </Detail>
        {s.signatureIntentAt && (
          <Detail label="Signature">
            <span data-no-translate>
              {`${MODE_LABEL[s.signatureMode ?? 'typed']} \u00b7 ${new Date(s.signatureIntentAt).toLocaleString()}`}
            </span>
          </Detail>
        )}
        {s.recipientNote && (
          <Detail label="Note to the recipient">
            <span data-no-translate>{s.recipientNote}</span>
          </Detail>
        )}
        {s.decidedAt && (
          <Detail label="Decision">
            <span data-no-translate>{`${s.decidedByName ?? 'A colleague'} · ${new Date(s.decidedAt).toLocaleString()}`}</span>
          </Detail>
        )}
        {s.editedAt && (
          <Detail label="Wording edited by">
            <span data-no-translate>{`${s.editedByName ?? 'A colleague'} · ${new Date(s.editedAt).toLocaleString()}`}</span>
          </Detail>
        )}
      </div>

      {s.decisionNote && (
        <div className="rounded-xl border border-ink-200 bg-cream-50/60 px-4 py-3 dark:border-forest-700/50 dark:bg-forest-900/60">
          <p className="text-[13px] font-semibold text-forest-900 dark:text-cream-100">
            <T>Note on the last decision</T>
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink-700 dark:text-cream-100/80" data-no-translate>
            {s.decisionNote}
          </p>
        </div>
      )}

      {s.editNote && (
        <div className="rounded-xl border border-ink-200 bg-cream-50/60 px-4 py-3 dark:border-forest-700/50 dark:bg-forest-900/60">
          <p className="text-[13px] font-semibold text-forest-900 dark:text-cream-100">
            <T>Why the wording was changed</T>
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink-700 dark:text-cream-100/80" data-no-translate>
            {s.editNote}
          </p>
        </div>
      )}

      <section className="rounded-xl border border-ink-200 bg-white p-6 dark:border-forest-700/50 dark:bg-forest-900/40">
        {/* The wording as text is what a reviewer reads closely. The button
            beside it opens the artifact that actually leaves the firm, which
            is a letterheaded PDF and not this. It is offered only to a reader
            who may already see the wording: a prettier read is still a read,
            and the route checks the same predicate again for itself. */}
        <SectionTitle
          className="mb-3"
          action={
            s.documentVisible ? (
              <SubmissionPreviewButton
                submissionId={s.id}
                revision={s.revision}
                documentText={s.documentText}
                title={s.templateName}
              />
            ) : undefined
          }
        >
          What would be sent
        </SectionTitle>
        {s.documentVisible ? (
          <div data-no-translate>
            <DocumentSheets text={s.documentText} markSrc={markUrl} />
          </div>
        ) : (
          <p className="text-[13px] text-ink-600 dark:text-cream-100/70">
            <T>
              The wording is open to the colleague who filled this in and to the owners,
              admins, and attorneys who decide on it. Once it has been approved and sent,
              everyone here can read it. You can still see where it came from, where it is
              going, and what has happened to it.
            </T>
          </p>
        )}
      </section>

      {/* The employee's own text, kept from the first edit onwards, so the
          record can always answer what they submitted separately from what
          the firm sent. */}
      {s.originalDocumentText && (
        <details className="rounded-xl border border-ink-200 bg-white p-4 dark:border-forest-700/50 dark:bg-forest-900/40">
          <summary className="cursor-pointer text-[13px] font-semibold text-forest-900 dark:text-cream-100">
            <T>What your colleague submitted, before the edit</T>
          </summary>
          <div
            className="mt-3 max-h-[50vh] overflow-y-auto whitespace-pre-wrap font-serif text-[13.5px] leading-relaxed text-ink-700 dark:text-cream-100/80"
            data-no-translate
          >
            {s.originalDocumentText}
          </div>
        </details>
      )}

      <ReviewActions
        submissionId={s.id}
        status={s.status}
        canApprove={Boolean(res.canApprove)}
        recipientEmail={s.recipientEmail}
        releaseError={s.releaseError}
        documentText={s.documentText}
        revision={s.revision}
        // What approving will actually do, resolved by the dispatcher's own
        // rule rather than by this page reading the template a second time.
        deliveryMode={res.deliveryMode ?? 'share'}
      />
    </div>
  );
}

/**
 * How the mark was made, in words a reviewer reads. A typed name is stated
 * plainly and without qualification: it is a valid electronic signature, and
 * wording that hinted otherwise would mislead the person deciding.
 */
const MODE_LABEL: Record<'typed' | 'drawn' | 'uploaded', string> = {
  typed: 'Typed',
  drawn: 'Drawn',
  uploaded: 'Uploaded image',
};

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 dark:text-cream-100/40">
        <T>{label}</T>
      </p>
      <div className="mt-1 text-forest-900 dark:text-cream-100">{children}</div>
    </div>
  );
}
