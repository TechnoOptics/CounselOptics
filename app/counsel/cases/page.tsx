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
import { NewMatterButton } from './new-matter-button';
import { CasesFilter, type AssigneeFilterOption } from './cases-filter';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Cases · Counsel' };

const STATUS_TONE: Record<CaseStatus, string> = {
  draft: 'bg-ink-100 text-ink-700 ring-ink-300/40 dark:bg-forest-800/60 dark:text-cream-100/85 dark:ring-forest-700/40',
  open: 'bg-emerald-50 text-emerald-800 ring-emerald-300/40 dark:bg-emerald-950/30 dark:text-emerald-100 dark:ring-emerald-500/30',
  under_review: 'bg-sky-50 text-sky-800 ring-sky-300/40 dark:bg-sky-950/30 dark:text-sky-100 dark:ring-sky-500/30',
  needs_evidence: 'bg-amber-50 text-amber-900 ring-amber-300/40 dark:bg-amber-950/30 dark:text-amber-100 dark:ring-amber-500/30',
  export_ready: 'bg-emerald-50 text-emerald-800 ring-emerald-300/40 dark:bg-emerald-950/30 dark:text-emerald-100 dark:ring-emerald-500/30',
  closed: 'bg-ink-100 text-ink-700 ring-ink-300/40 dark:bg-forest-800/60 dark:text-cream-100/85 dark:ring-forest-700/40',
  archived: 'bg-ink-100 text-ink-600 ring-ink-300/40 dark:bg-forest-800/40 dark:text-cream-100/55 dark:ring-forest-700/40',
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
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1"><T>Cases</T></p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            <T>Firm caseload</T>
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
            <T>Every case linked to</T> {ctx.firm.name}.{' '}
            <T>Bring your caseload in from</T>{' '}
            <Link href="/counsel/import" className="underline">
              <T>Import data</T>
            </Link>{' '}
            <T>(spreadsheet upload or a migration from another platform).</T>
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <NewMatterButton firmId={ctx.firm.id} />
          <p className="text-[12px] text-ink-500 dark:text-cream-100/55 font-mono uppercase tracking-wider">
            {cases.length} <T>total</T>
          </p>
        </div>
      </header>

      {allCases.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <CasesFilter options={filterOptions} current={filter} />
        </div>
      )}

      {allCases.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-display text-2xl text-forest-900 dark:text-cream-100">
            <T>No cases yet.</T>
          </p>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 max-w-md mx-auto leading-relaxed">
            <T>
              Open one with &ldquo;New matter&rdquo; above, or import your
              existing caseload &mdash; upload a spreadsheet or migrate from
              another platform on the
            </T>{' '}
            <Link href="/counsel/import" className="underline">
              <T>Import data</T>
            </Link>{' '}
            <T>page.</T>
          </p>
        </div>
      ) : cases.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-display text-xl text-forest-900 dark:text-cream-100">
            <T>No matters match this filter.</T>
          </p>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2">
            <Link href="/counsel/cases" className="underline">
              <T>Clear the assignee filter</T>
            </Link>
          </p>
        </div>
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
                        <span
                          className={`inline-flex items-center px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded ring-1 ${STATUS_TONE[status]}`}
                        >
                          {STATUS_LABEL[status]}
                        </span>
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
