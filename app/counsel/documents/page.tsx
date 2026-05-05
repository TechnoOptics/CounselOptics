import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  getActiveFirmContext,
  listFirmCases,
  listFirmDocuments,
} from '@/lib/firm-storage';
import {
  FIRM_DOCUMENT_STATUS_LABEL,
  FIRM_DOCUMENT_STATUS_TONE,
  type FirmDocumentStatus,
} from '@/lib/firm-types';
import { UploadDocumentForm } from './upload-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Documents · Counsel' };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const STATUS_TONE_CLASSES: Record<
  ReturnType<typeof toneOf>,
  string
> = {
  gray:
    'bg-ink-100 dark:bg-forest-800/50 text-ink-700 dark:text-cream-100/80 ring-ink-200 dark:ring-forest-700/40',
  blue:
    'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-200 ring-sky-200 dark:ring-sky-700/40',
  amber:
    'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 ring-amber-200 dark:ring-amber-700/40',
  green:
    'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-700/40',
  rose:
    'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 ring-rose-200 dark:ring-rose-700/40',
};

function toneOf(status: FirmDocumentStatus) {
  return FIRM_DOCUMENT_STATUS_TONE[status];
}

export default async function CounselDocumentsPage({
  searchParams,
}: {
  searchParams?: { status?: string; case?: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const [allDocs, cases] = await Promise.all([
    listFirmDocuments(ctx.firm.id),
    listFirmCases(ctx.firm.id),
  ]);

  const statusFilter = searchParams?.status ?? null;
  const caseFilter = searchParams?.case ?? null;

  const documents = allDocs.filter((d) => {
    if (statusFilter && d.status !== statusFilter) return false;
    if (caseFilter && d.caseId !== caseFilter) return false;
    return true;
  });

  // Bucket counts for the filter pills (always reflect the unfiltered set
  // so the operator can see at a glance where each status sits).
  const statusCounts = new Map<FirmDocumentStatus, number>();
  for (const d of allDocs) {
    statusCounts.set(d.status, (statusCounts.get(d.status) ?? 0) + 1);
  }

  const canUpload = ['owner', 'admin', 'attorney', 'paralegal'].includes(
    ctx.membership.role,
  );

  const caseTitleById = new Map(cases.map((c) => [c.id, c.title]));

  // Order the status filter pills by importance: signed states last,
  // exception states (overdue/on hold/canceled) at the end.
  const STATUS_ORDER: FirmDocumentStatus[] = [
    'received',
    'submitted',
    'ready',
    'sent',
    'pending',
    'signed_internal',
    'signed_employee',
    'signed_client',
    'signed_other',
    'overdue',
    'on_hold',
    'canceled',
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Documents</p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Document vault
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
            Contracts, motions, exhibits, anything the firm needs to keep.
            Every document attaches to a case or matter and moves through a
            lifecycle - received, ready, sent, signed (internal / employee /
            client / other party), or on hold / overdue / canceled.
          </p>
        </div>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 font-mono uppercase tracking-wider">
          {documents.length} of {allDocs.length} document
          {allDocs.length === 1 ? '' : 's'}
        </p>
      </header>

      {canUpload && <UploadDocumentForm firmId={ctx.firm.id} cases={cases} />}

      {/* Status filter pills */}
      <section className="flex flex-wrap gap-2 items-center">
        <FilterPill href="/counsel/documents" active={!statusFilter && !caseFilter}>
          All ({allDocs.length})
        </FilterPill>
        {STATUS_ORDER.filter((s) => (statusCounts.get(s) ?? 0) > 0).map((s) => (
          <FilterPill
            key={s}
            href={`/counsel/documents?status=${s}${caseFilter ? `&case=${caseFilter}` : ''}`}
            active={statusFilter === s}
            tone={toneOf(s)}
          >
            {FIRM_DOCUMENT_STATUS_LABEL[s]} ({statusCounts.get(s)})
          </FilterPill>
        ))}
      </section>

      {/* Case filter dropdown when there are cases */}
      {cases.length > 0 && (
        <section className="flex flex-wrap gap-2 items-center text-[12.5px] text-ink-700 dark:text-cream-100/80">
          <span className="font-medium">Filter by case:</span>
          <Link
            href={`/counsel/documents${statusFilter ? `?status=${statusFilter}` : ''}`}
            className={`px-2.5 py-1 rounded-md ring-1 ${
              !caseFilter
                ? 'bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950 ring-transparent'
                : 'bg-white dark:bg-forest-900/50 text-ink-700 dark:text-cream-100/80 ring-ink-200 dark:ring-forest-700/40'
            }`}
          >
            All cases
          </Link>
          {cases.slice(0, 8).map((c) => (
            <Link
              key={c.id}
              href={`/counsel/documents?case=${c.id}${statusFilter ? `&status=${statusFilter}` : ''}`}
              className={`px-2.5 py-1 rounded-md ring-1 truncate max-w-[16rem] ${
                caseFilter === c.id
                  ? 'bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950 ring-transparent'
                  : 'bg-white dark:bg-forest-900/50 text-ink-700 dark:text-cream-100/80 ring-ink-200 dark:ring-forest-700/40'
              }`}
              title={c.title}
            >
              {c.title}
            </Link>
          ))}
        </section>
      )}

      {documents.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-display text-2xl text-forest-900 dark:text-cream-100">
            {statusFilter || caseFilter
              ? 'No documents match this filter.'
              : 'No documents yet.'}
          </p>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 max-w-md mx-auto leading-relaxed">
            Upload contracts, court filings, or evidence packets above. Files
            up to 50 MB each.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {documents.map((d) => {
            const tone = toneOf(d.status);
            const caseTitle = d.caseId
              ? caseTitleById.get(d.caseId) ?? 'Unknown case'
              : null;
            const isOverdue =
              d.dueAt &&
              new Date(d.dueAt).getTime() < Date.now() &&
              !d.status.startsWith('signed_') &&
              d.status !== 'canceled';
            return (
              <li
                key={d.id}
                className="card p-4 hover:shadow-card-hover hover:-translate-y-0.5 transition-all"
              >
                <Link href={`/counsel/documents/${d.id}`} className="block space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-forest-900 dark:text-cream-100 truncate flex-1 min-w-0">
                      {d.name}
                    </p>
                    <span
                      className={`shrink-0 inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 ${STATUS_TONE_CLASSES[tone]}`}
                    >
                      {FIRM_DOCUMENT_STATUS_LABEL[d.status]}
                    </span>
                  </div>
                  {caseTitle && (
                    <p className="text-[11.5px] text-ink-600 dark:text-cream-100/70 truncate">
                      <span className="font-mono uppercase tracking-wider text-[9.5px] text-ink-500 dark:text-cream-100/50 mr-1.5">
                        case
                      </span>
                      {caseTitle}
                    </p>
                  )}
                  <p className="text-[11px] text-ink-500 dark:text-cream-100/55 font-mono">
                    v{d.version} &middot; {d.mimeType.split('/').pop() ?? 'file'}{' '}
                    &middot; {formatBytes(d.fileSize)}
                  </p>
                  {d.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {d.tags.slice(0, 4).map((t) => (
                        <span
                          key={t}
                          className="badge bg-ink-100 dark:bg-forest-800/60 text-ink-700 dark:text-cream-100/80 text-[10px]"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between text-[11px] text-ink-400 dark:text-cream-100/45 font-mono tabular-nums pt-1 border-t border-ink-100 dark:border-forest-800/40">
                    <span>{new Date(d.uploadedAt).toLocaleDateString()}</span>
                    {d.dueAt && (
                      <span
                        className={
                          isOverdue
                            ? 'text-rose-600 dark:text-rose-300 font-semibold'
                            : ''
                        }
                      >
                        {isOverdue ? 'Overdue ' : 'Due '}
                        {new Date(d.dueAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function FilterPill({
  href,
  active,
  tone = 'gray',
  children,
}: {
  href: string;
  active: boolean;
  tone?: ReturnType<typeof toneOf>;
  children: React.ReactNode;
}) {
  const inactive =
    'bg-white dark:bg-forest-900/50 text-ink-700 dark:text-cream-100/80 ring-ink-200 dark:ring-forest-700/40';
  return (
    <Link
      href={href}
      className={`px-2.5 py-1 rounded-md ring-1 text-[12px] font-medium ${
        active ? STATUS_TONE_CLASSES[tone] : inactive
      }`}
    >
      {children}
    </Link>
  );
}
