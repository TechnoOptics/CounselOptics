import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { listFirmTemplateSubmissionsAction } from '@/lib/template-submissions';
import { isAwaitingReview } from '@/lib/template-approval';
import { PageHeader, EmptyState, SectionTitle } from '@/components/counsel/ui';
import { SubmissionStatusPill } from '@/components/portal/SubmissionStatusPill';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Document approvals · Counsel' };

/**
 * The review queue. An employee filled a firm template and named an outside
 * recipient; nothing has been sent. Everyone on the legal team can read what
 * is waiting; owners, admins, and attorneys can release it.
 */
export default async function CounselFormApprovalsPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');

  const res = await listFirmTemplateSubmissionsAction(ctx.firm.id);
  const submissions = res.submissions ?? [];
  const waiting = submissions.filter((s) => isAwaitingReview(s.status));
  const decided = submissions.filter((s) => !isAwaitingReview(s.status));

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>Counsel · self-service</T>}
        title={<T>Document approvals</T>}
        subtitle={
          <T>
            Forms your colleagues have filled in and addressed to someone outside the
            company. Nothing here has been sent. Read the finished document, then approve
            it to send it, or send it back with a note.
          </T>
        }
      />

      {!res.canApprove && (
        <p className="rounded-lg border border-ink-200 bg-cream-50/60 px-4 py-3 text-[13px] text-ink-700 dark:border-forest-700/50 dark:bg-forest-900/60 dark:text-cream-100/80">
          <T>
            You can follow everything in this queue: who filled each form in, who it is
            addressed to, and where it has got to. Releasing a document to an outside party,
            and reading the wording of one that has not been released yet, is limited to
            owners, admins, and attorneys.
          </T>
        </p>
      )}

      <section className="space-y-2">
        <SectionTitle>Waiting for review</SectionTitle>
        {waiting.length === 0 ? (
          <EmptyState title="Nothing waiting" sub="Filled forms addressed to an outside party will land here." />
        ) : (
          <SubmissionList items={waiting} />
        )}
      </section>

      {decided.length > 0 && (
        <section className="space-y-2">
          <SectionTitle>Decided</SectionTitle>
          <SubmissionList items={decided} />
        </section>
      )}
    </div>
  );
}

function SubmissionList({
  items,
}: {
  items: Awaited<ReturnType<typeof listFirmTemplateSubmissionsAction>>['submissions'];
}) {
  return (
    <ul className="divide-y divide-ink-100 overflow-hidden rounded-xl border border-ink-200 dark:divide-forest-800/50 dark:border-forest-700/50">
      {(items ?? []).map((s) => (
        <li key={s.id} className="bg-white dark:bg-forest-900/40">
          <Link
            href={`/counsel/forms/approvals/${s.id}`}
            className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-cream-50 dark:hover:bg-forest-800/40"
          >
            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-[14px] font-medium text-forest-900 dark:text-cream-100"
                data-no-translate
              >
                {s.templateName}
              </span>
              <span className="block truncate text-[12px] text-ink-500 dark:text-cream-100/55">
                <span data-no-translate>{s.submitterName ?? s.submitterEmail ?? 'A colleague'}</span>
                {' · '}
                <T>to</T> <span data-no-translate>{s.recipientEmail}</span>
                {s.revision > 1 ? ` · v${s.revision}` : ''}
              </span>
            </span>
            <SubmissionStatusPill status={s.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
