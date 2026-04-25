import Link from 'next/link';
import { listCases } from '@/lib/storage';
import { STATUS_LABEL, type CaseStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function CasesPage() {
  const cases = await listCases();

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">Your files</p>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-950">Cases</h1>
          <p className="text-sm text-ink-500 mt-1">
            {cases.length === 0
              ? 'No cases yet. Create your first case file to get started.'
              : `${cases.length} case${cases.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <Link href="/cases/new" className="btn-primary">
          <PlusIcon />
          New case
        </Link>
      </div>

      {cases.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-ink-600 mb-5">Start by creating a case file.</p>
          <Link href="/cases/new" className="btn-primary">
            Create case
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {cases.map((c) => {
            const loc = [c.jurisdiction.city, c.jurisdiction.state, c.jurisdiction.country]
              .filter(Boolean)
              .join(', ');
            return (
              <Link key={c.id} href={`/cases/${c.id}`} className="card-hover p-5 block">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <h2 className="font-semibold text-ink-950 leading-tight tracking-tight">
                    {c.title}
                  </h2>
                  <StatusPill status={c.status} />
                </div>
                <p className="text-sm text-ink-700 mb-4">
                  <span className="text-ink-500">
                    {c.subjectType === 'person'
                      ? 'Person'
                      : c.subjectType === 'business'
                        ? 'Business'
                        : 'Matter'}
                    :{' '}
                  </span>
                  {c.subjectName}
                </p>
                <div className="text-xs text-ink-500 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="inline-flex items-center">{c.caseType}</span>
                  {loc && (
                    <>
                      <Dot />
                      <span>{loc}</span>
                    </>
                  )}
                  <Dot />
                  <span>Updated {new Date(c.updatedAt).toLocaleDateString()}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Dot() {
  return <span aria-hidden className="inline-block h-1 w-1 rounded-full bg-ink-300" />;
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

const STATUS_STYLES: Record<CaseStatus, string> = {
  draft: 'bg-ink-100 text-ink-700',
  open: 'bg-sky-50 text-sky-800 border border-sky-200',
  under_review: 'bg-amber-50 text-amber-900 border border-amber-200',
  needs_evidence: 'bg-rose-50 text-rose-800 border border-rose-200',
  export_ready: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
  closed: 'bg-ink-100 text-ink-600',
  archived: 'bg-ink-100 text-ink-500',
};

function StatusPill({ status }: { status: CaseStatus }) {
  return <span className={`badge ${STATUS_STYLES[status]}`}>{STATUS_LABEL[status]}</span>;
}
