import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  getActiveFirmContext,
  listFirmCases,
  listFirmMembers,
} from '@/lib/firm-storage';
import { getCurrentUser } from '@/lib/supabase/server';
import { STATUS_LABEL, type CaseStatus } from '@/lib/types';
import { T } from '@/components/i18n/LocaleProvider';
import { PageHeader, EmptyState } from '@/components/counsel/ui';
import { StatusPill, PILL_COLORS } from '@/components/counsel/StatusPill';
import { NewMatterButton } from './new-matter-button';
import { CasesFilter, type AssigneeFilterOption } from './cases-filter';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Cases · Counsel' };

// One hex per case status; StatusPill derives the fill and the border
// from it. `archived` used to share `closed`'s grey because the dimmer
// grey that sets it apart, PILL_COLORS.quiet, measured about 3.9:1 on a
// counsel card and failed AA at chip size. `quiet` has since been lifted
// to 4.71:1, so archived can read as the quieter of the two again.
const STATUS_COLOR: Record<CaseStatus, string> = {
  draft: PILL_COLORS.neutral,
  open: PILL_COLORS.good,
  under_review: PILL_COLORS.info,
  needs_evidence: PILL_COLORS.waiting,
  export_ready: PILL_COLORS.good,
  closed: PILL_COLORS.neutral,
  archived: PILL_COLORS.quiet,
};

export default async function CounselCasesPage({
  searchParams,
}: {
  searchParams: { assignee?: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const [allCases, members, user] = await Promise.all([
    listFirmCases(ctx.firm.id),
    listFirmMembers(ctx.firm.id),
    getCurrentUser(),
  ]);

  // Resolve assignee display names once (userId -> label).
  const memberLabel = new Map<string, string>();
  for (const m of members) {
    memberLabel.set(m.userId, m.displayName ?? m.email ?? 'Member');
  }

  // Assignee filter. `?assignee=` is: '' (all), 'me', 'unassigned', or a
  // firm member's user id. `me` resolves to the signed-in attorney.
  const filter = (searchParams.assignee ?? '').trim();
  const meId = user?.id ?? null;
  const cases = allCases.filter((c) => {
    if (!filter) return true;
    if (filter === 'unassigned') return !c.assignedTo;
    if (filter === 'me') return meId != null && c.assignedTo === meId;
    return c.assignedTo === filter;
  });

  const filterOptions: AssigneeFilterOption[] = [
    { value: '', label: 'Everyone' },
    { value: 'me', label: 'Assigned to me' },
    { value: 'unassigned', label: 'Unassigned' },
    ...members.map((m) => ({
      value: m.userId,
      label: memberLabel.get(m.userId) ?? 'Member',
    })),
  ];

  // Bucket by status for the firm-side view.
  const buckets: Record<CaseStatus, typeof cases> = {
    draft: [],
    open: [],
    under_review: [],
    needs_evidence: [],
    export_ready: [],
    closed: [],
    archived: [],
  };
  for (const c of cases) buckets[c.status]?.push(c);

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>Cases</T>}
        title={<T>Firm caseload</T>}
        subtitle={
          <>
            <T>Every case linked to</T> {ctx.firm.name}.{' '}
            <T>Bring your caseload in from</T>{' '}
            <Link href="/counsel/import" className="underline">
              <T>Import data</T>
            </Link>{' '}
            <T>(spreadsheet upload or a migration from another platform).</T>
          </>
        }
        action={
          <div className="flex flex-col items-end gap-2">
            <NewMatterButton firmId={ctx.firm.id} />
            <p className="text-[12px] text-ink-500 dark:text-cream-100/55 font-mono uppercase tracking-wider">
              {cases.length} <T>total</T>
            </p>
          </div>
        }
      />

      {allCases.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <CasesFilter options={filterOptions} current={filter} />
        </div>
      )}

      {allCases.length === 0 ? (
        <EmptyState
          title={<T>No cases yet.</T>}
          sub={
            <>
              <T>
                Open one with &ldquo;New matter&rdquo; above, or import your
                existing caseload: upload a spreadsheet or migrate from
                another platform on the
              </T>{' '}
              <Link href="/counsel/import" className="underline">
                <T>Import data</T>
              </Link>{' '}
              <T>page.</T>
            </>
          }
        />
      ) : cases.length === 0 ? (
        <EmptyState
          title={<T>No matters match this filter.</T>}
          sub={
            <Link href="/counsel/cases" className="underline">
              <T>Clear the assignee filter</T>
            </Link>
          }
        />
      ) : (
        <div className="space-y-6">
          {(Object.keys(buckets) as CaseStatus[]).map((status) =>
            buckets[status].length === 0 ? null : (
              <section key={status}>
                <p className="eyebrow mb-3">
                  {STATUS_LABEL[status]} ({buckets[status].length})
                </p>
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {buckets[status].map((c) => (
                    // Audit W20 V3 CR-31: padding lives on the Link
                    // (not the wrapping <li>) so the entire visible
                    // card area is clickable. Previously the p-4 sat
                    // on the <li>, leaving a ~1rem padding band where
                    // a click landed outside the Link and bounced.
                    // prefetch={false} matches the rest of the Counsel
                    // sidebar (CR-28) - the same router quirk applies
                    // to in-page navigations into auth-shaped routes.
                    <li key={c.id} className="card hover:shadow-card-hover hover:-translate-y-0.5 transition-all">
                      <Link
                        href={`/counsel/cases/${c.id}`}
                        prefetch={false}
                        className="block p-4 rounded-2xl"
                      >
                        <StatusPill size="sm" color={STATUS_COLOR[status]}>
                          {STATUS_LABEL[status]}
                        </StatusPill>
                        <p className="font-semibold text-forest-900 dark:text-cream-100 mt-2 line-clamp-2">
                          {c.title}
                        </p>
                        <p className="text-xs text-ink-500 dark:text-cream-100/55 mt-1">
                          {c.subjectName} &middot; {c.caseType}
                        </p>
                        <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-1">
                          {c.assignedTo ? (
                            <>
                              <T>Assigned:</T>{' '}
                              <span data-no-translate>
                                {memberLabel.get(c.assignedTo) ?? 'Member'}
                              </span>
                            </>
                          ) : (
                            <span className="italic"><T>Unassigned</T></span>
                          )}
                        </p>
                        {c.hearingAt && (
                          <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-1.5 font-mono tabular-nums">
                            <T>Hearing:</T>{' '}
                            {new Date(c.hearingAt).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </p>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ),
          )}
        </div>
      )}
    </div>
  );
}
