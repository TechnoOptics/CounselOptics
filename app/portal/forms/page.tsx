import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getWorkspacePersona } from '@/lib/persona';
import { listPortalTemplatesAction } from '@/lib/firm-templates';
import { listMyTemplateSubmissionsAction } from '@/lib/template-submissions';
import { groupByCategory } from '@/lib/document-category';
import { displayTicket } from '@/lib/ticket-numbers';
import { PageHeader, EmptyState, SectionTitle } from '@/components/counsel/ui';
import { SubmissionStatusPill } from '@/components/portal/SubmissionStatusPill';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Forms · Hub' };

/**
 * Employee Forms: the templates the legal team published (NDA, vendor form,
 * …). Pick one, fill the fields, sign, and export. No ticket needed.
 */
export default async function PortalFormsPage() {
  const persona = await getWorkspacePersona();
  if (persona.kind !== 'employee') redirect('/portal');

  const [res, mine] = await Promise.all([
    listPortalTemplatesAction(persona.firm.id),
    listMyTemplateSubmissionsAction(persona.firm.id),
  ]);
  const templates = res.templates ?? [];
  const submissions = (mine.submissions ?? []).filter((s) => s.status !== 'withdrawn');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Forms"
        subtitle={
          <>
            Documents your legal team has prepared for self-service. Fill one in,
            sign it, and download it, no request needed. If your situation
            doesn&apos;t fit a form,{' '}
            <Link href="/portal/new" className="text-gold-700 underline dark:text-gold-300">
              file a request
            </Link>{' '}
            instead.
          </>
        }
      />

      {templates.length === 0 ? (
        <EmptyState
          title="No forms yet"
          sub={
            <>
              Your legal team hasn&apos;t published any form templates. Ask them,
              or file a request for what you need.
            </>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <Link
              key={t.id}
              href={`/portal/forms/${t.id}`}
              className="group flex flex-col rounded-xl border border-edge bg-surface p-4 transition-all hover:border-gold-500/60 hover:shadow-md dark:hover:bg-forest-800/50"
            >
              {t.category && (
                <span className="mb-2 self-start rounded-full bg-gold-500/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-gold-700 ring-1 ring-gold-500/25 dark:text-gold-300">
                  {t.category}
                </span>
              )}
              <span className="text-[15px] font-semibold text-foreground">{t.name}</span>
              {t.description && (
                <span className="mt-1 line-clamp-2 text-[12.5px] text-muted">
                  {t.description}
                </span>
              )}
              <span className="mt-3 text-[12px] font-medium text-gold-700 group-hover:underline dark:text-gold-300">
                Fill &amp; sign →
              </span>
            </Link>
          ))}
        </div>
      )}

      {submissions.length > 0 && (
        <section className="space-y-2">
          <SectionTitle>Documents you sent for review</SectionTitle>
          {/*
            The same grouping the legal team's queue uses, from the same
            function, so the two sides describe a document the same way. Until
            20260807_flow_join.sql is applied nothing carries a category, this
            resolves to one section, and the list reads as it does today.
          */}
          {groupByCategory(submissions, (s) => s.category).map((group) => (
            <div key={group.category} className="space-y-1.5 pt-1">
              <p
                className="text-[10.5px] font-semibold uppercase tracking-wider text-muted"
                data-no-translate
              >
                {group.category}
              </p>
              <ul className="divide-y divide-edge overflow-hidden rounded-xl border border-edge">
                {group.rows.map((s) => (
                  <li key={s.id} className="bg-surface">
                    <Link
                      href={`/portal/forms/submissions/${s.id}`}
                      className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-surface-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span
                          className="block truncate text-[14px] font-medium text-foreground"
                          data-no-translate
                        >
                          {s.templateName}
                        </span>
                        <span className="block truncate text-[12px] text-muted">
                          <span
                            className="font-mono text-[11.5px] text-gold-700 dark:text-gold-300"
                            data-no-translate
                          >
                            {displayTicket(s)}
                          </span>
                          {' · '}
                          <T>To</T>{' '}
                          <span data-no-translate>{s.recipientEmail}</span>
                        </span>
                      </span>
                      <SubmissionStatusPill status={s.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
