import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext, listFirmCases } from '@/lib/firm-storage';
import { STATUS_LABEL, type CaseStatus } from '@/lib/types';

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

export default async function CounselCasesPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const cases = await listFirmCases(ctx.firm.id);

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
          <p className="eyebrow mb-1">Cases</p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Firm caseload
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
            Every case linked to {ctx.firm.name}. To attach a personal Advottic case to the firm, open it in the personal view and use{' '}
            <span className="font-mono text-[12px] bg-ink-100 dark:bg-forest-800 px-1.5 py-0.5 rounded">
              Share with firm
            </span>
            .
          </p>
        </div>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 font-mono uppercase tracking-wider">
          {cases.length} total
        </p>
      </header>

      {cases.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-display text-2xl text-forest-900 dark:text-cream-100">
            No cases yet.
          </p>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 max-w-md mx-auto leading-relaxed">
            Cases appear here when a client invites you, or when one of your team members
            attaches a personal Advottic case to the firm. The case page in personal view
            has a &ldquo;Share with firm&rdquo; control.
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
                    <li key={c.id} className="card p-4 hover:shadow-card-hover hover:-translate-y-0.5 transition-all">
                      <Link href={`/counsel/cases/${c.id}`} className="block">
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
                        {c.hearingAt && (
                          <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-1.5 font-mono tabular-nums">
                            Hearing:{' '}
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
