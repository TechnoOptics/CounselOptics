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
  FIRM_TONE_COLOR,
  type FirmDocumentStatus,
} from '@/lib/firm-types';
import { UploadDocumentForm } from './upload-form';
import { PageHeader, EmptyState } from '@/components/counsel/ui';
import { StatusPill, pillSurface } from '@/components/counsel/StatusPill';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Documents · Counsel' };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// A row whose status is outside the union (an older write, a hand-edited
// value) still gets a readable chip rather than a blank one.
function colorOf(status: FirmDocumentStatus) {
  return FIRM_TONE_COLOR[FIRM_DOCUMENT_STATUS_TONE[status]] ?? FIRM_TONE_COLOR.gray;
}

export default async function CounselDocumentsPage({
  searchParams,
}: {
  searchParams?: { status?: string; case?: string; q?: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const [allDocs, cases] = await Promise.all([
    listFirmDocuments(ctx.firm.id),
    listFirmCases(ctx.firm.id),
  ]);

  const statusFilter = searchParams?.status ?? null;
  const caseFilter = searchParams?.case ?? null;
  const query = (searchParams?.q ?? '').trim().toLowerCase();

  const documents = allDocs.filter((d) => {
    if (statusFilter && d.status !== statusFilter) return false;
    if (caseFilter && d.caseId !== caseFilter) return false;
    if (query) {
      const hay = [d.name, d.description ?? '', ...(d.tags ?? [])].join(' ').toLowerCase();
      if (!hay.includes(query)) return false;
    }
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
      <PageHeader
        eyebrow={<T>Documents</T>}
        title={<T>Document vault</T>}
        subtitle={
          <T>
            Contracts, motions, exhibits, anything the firm needs to keep.
            Every document attaches to a case or matter and moves through a
            lifecycle - received, ready, sent, signed (internal / employee /
            client / other party), or on hold / overdue / canceled.
          </T>
        }
        action={
          <p className="text-[12px] text-ink-500 dark:text-cream-100/55 font-mono uppercase tracking-wider">
            {documents.length} <T>of</T> {allDocs.length}{' '}
            <T>{allDocs.length === 1 ? 'document' : 'documents'}</T>
          </p>
        }
      />

      {canUpload && <UploadDocumentForm firmId={ctx.firm.id} cases={cases} />}

      {/* Search - name, description, or tag (e.g. "NDA", "Templates").
          Plain GET form so the ?q= filter is server-rendered and linkable;
          the pill wears the house animated gold border. */}
      <form action="/counsel/documents" method="get" className="max-w-xl">
        {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
        {caseFilter && <input type="hidden" name="case" value={caseFilter} />}
        <div className="search-pill-gold relative rounded-full transition-shadow focus-within:shadow-lg">
          <span aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-400 dark:text-cream-100/40">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="m20 20-3.6-3.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search documents - a name, a tag, a description…"
            className="w-full rounded-full bg-transparent py-2.5 pl-11 pr-4 text-[14px] text-forest-900 outline-none placeholder:text-ink-400 dark:text-cream-50 dark:placeholder:text-cream-100/40"
            data-no-translate
          />
        </div>
      </form>

      {/* Status filter pills */}
      <section className="flex flex-wrap gap-2 items-center">
        <FilterPill href="/counsel/documents" active={!statusFilter && !caseFilter}>
          <T>All</T> ({allDocs.length})
        </FilterPill>
        {STATUS_ORDER.filter((s) => (statusCounts.get(s) ?? 0) > 0).map((s) => (
          <FilterPill
            key={s}
            href={`/counsel/documents?status=${s}${caseFilter ? `&case=${caseFilter}` : ''}`}
            active={statusFilter === s}
            color={colorOf(s)}
          >
            {FIRM_DOCUMENT_STATUS_LABEL[s]} ({statusCounts.get(s)})
          </FilterPill>
        ))}
      </section>

      {/* Case filter dropdown when there are cases */}
      {cases.length > 0 && (
        <section className="flex flex-wrap gap-2 items-center text-[12.5px] text-ink-700 dark:text-cream-100/80">
          <span className="font-medium"><T>Filter by case:</T></span>
          <Link
            href={`/counsel/documents${statusFilter ? `?status=${statusFilter}` : ''}`}
            className={`px-2.5 py-1 rounded-md ring-1 ${
              !caseFilter
                ? 'bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950 ring-transparent'
                : 'bg-white dark:bg-forest-900/50 text-ink-700 dark:text-cream-100/80 ring-ink-200 dark:ring-forest-700/40'
            }`}
          >
            <T>All cases</T>
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
        <EmptyState
          title={
            statusFilter || caseFilter ? (
              <T>No documents match this filter.</T>
            ) : (
              <T>No documents yet.</T>
            )
          }
          sub={
            <T>
              Upload contracts, court filings, or evidence packets above. Files
              up to 50 MB each.
            </T>
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {documents.map((d) => {
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
                    <StatusPill size="sm" color={colorOf(d.status)}>
                      {FIRM_DOCUMENT_STATUS_LABEL[d.status] ?? d.status}
                    </StatusPill>
                  </div>
                  {caseTitle && (
                    <p className="text-[11.5px] text-ink-600 dark:text-cream-100/70 truncate">
                      <span className="font-mono uppercase tracking-wider text-[9.5px] text-ink-500 dark:text-cream-100/50 mr-1.5">
                        <T>case</T>
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
                  <div className="flex items-center justify-between text-[11px] text-ink-500 dark:text-cream-100/70 font-mono tabular-nums pt-1 border-t border-ink-100 dark:border-forest-800/40">
                    <span>{new Date(d.uploadedAt).toLocaleDateString()}</span>
                    {d.dueAt && (
                      <span
                        className={
                          isOverdue
                            ? 'text-rose-600 dark:text-rose-300 font-semibold'
                            : ''
                        }
                      >
                        {isOverdue ? <T>Overdue</T> : <T>Due</T>}{' '}
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

// The active pill wears the status colour through the same fill/edge
// arithmetic StatusPill uses, so a filter and the chips it selects read
// as the same state. Its label stays bright rather than taking the tone
// hex: at this size the tone reads dimmer than the unselected pills
// beside it, and the selected filter would look like the disabled one.
function FilterPill({
  href,
  active,
  color = FIRM_TONE_COLOR.gray,
  children,
}: {
  href: string;
  active: boolean;
  color?: string;
  children: React.ReactNode;
}) {
  const inactive =
    'ring-1 bg-white dark:bg-forest-900/50 text-ink-700 dark:text-cream-100/80 ring-ink-200 dark:ring-forest-700/40';
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`px-2.5 py-1 rounded-md text-[12px] font-medium ${
        active ? 'text-forest-900 dark:text-cream-100' : inactive
      }`}
      style={active ? pillSurface(color) : undefined}
    >
      {children}
    </Link>
  );
}
