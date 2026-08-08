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
  type FirmDocument,
  type FirmDocumentStatus,
} from '@/lib/firm-types';
import { UploadDocumentForm } from './upload-form';
import { PageHeader, EmptyState } from '@/components/counsel/ui';
import { StatusPill } from '@/components/counsel/StatusPill';
import {
  MonoRef,
  Toolbar,
  ViewStrip,
  relativeTime,
  shortRef,
  type ViewOption,
} from '@/components/counsel/patterns';
import {
  ClearFilters,
  FilterSelect,
  PlainHeader,
  SearchFilter,
  SortHeader,
} from '@/components/counsel/list-table';
import {
  listHref,
  oneParam,
  sortRows,
  type SortDir,
} from '@/lib/counsel-list';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Documents · Counsel' };

const PATH = '/counsel/documents';

// A row whose status is outside the union (an older write, a hand-edited
// value) still gets a readable chip rather than a blank one.
function colorOf(status: FirmDocumentStatus) {
  return FIRM_TONE_COLOR[FIRM_DOCUMENT_STATUS_TONE[status]] ?? FIRM_TONE_COLOR.gray;
}

/** Signed, in any of the four ways a document can be signed. */
function isSigned(d: FirmDocument): boolean {
  return d.status.startsWith('signed_');
}

/**
 * Past its due date and still owed.
 *
 * The same reading the detail page makes, so a document cannot be
 * overdue in the list and on time on its own page.
 */
function isOverdue(d: FirmDocument, nowMs: number): boolean {
  return Boolean(
    d.dueAt &&
      new Date(d.dueAt).getTime() < nowMs &&
      !isSigned(d) &&
      d.status !== 'canceled',
  );
}

/**
 * The views, as predicates over the whole set.
 *
 * Each one is a state a document is genuinely in, computed from its own
 * columns, and each count below is the length of the array that view
 * would render. `all` is the default because this page is a vault
 * rather than a queue: the first thing a firm wants from it is
 * everything it has.
 */
type ViewKey = 'all' | 'inflight' | 'overdue' | 'signed' | 'unfiled';

const VIEWS: Record<ViewKey, (d: FirmDocument, nowMs: number) => boolean> = {
  all: () => true,
  inflight: (d) => !isSigned(d) && d.status !== 'canceled',
  overdue: (d, nowMs) => isOverdue(d, nowMs),
  signed: (d) => isSigned(d),
  unfiled: (d) => d.caseId == null,
};

const VIEW_LABEL: Record<ViewKey, JSX.Element> = {
  all: <T>Everything</T>,
  inflight: <T>In flight</T>,
  overdue: <T>Overdue</T>,
  signed: <T>Signed</T>,
  unfiled: <T>Not on a matter</T>,
};

const SORTS = ['name', 'status', 'matter', 'due', 'uploaded'] as const;
type SortKey = (typeof SORTS)[number];

/** Which way a first click on each column reads. */
const SORT_DEFAULT_DIR: Record<SortKey, SortDir> = {
  name: 'asc',
  status: 'asc',
  matter: 'asc',
  due: 'asc',
  uploaded: 'desc',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The document vault, as the list pattern in
 * docs/TECHOTTIC-PARITY-SPEC.md section 3.
 *
 * The whole of the list's state is the query string, parsed here, so a
 * narrowed vault is a link somebody can be sent and the back button
 * steps between views. Filtering and sorting run over the whole set
 * before anything is rendered, which is what keeps the view counts
 * honest.
 *
 * Two elements of the pattern are deliberately absent. There is no
 * checkbox column, because nothing in this product acts on a set of
 * documents at once: the only document mutations are per-document
 * (status, signing request), so a selection would have had nothing to
 * do. And there is no primary action button beside the title, because
 * uploading is the inline form below rather than a route to send
 * somebody to.
 */
export default async function CounselDocumentsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const [allDocs, cases] = await Promise.all([
    listFirmDocuments(ctx.firm.id),
    listFirmCases(ctx.firm.id),
  ]);

  const rawView = oneParam(searchParams?.view);
  const view: ViewKey = rawView in VIEWS ? (rawView as ViewKey) : 'all';
  const rawSort = oneParam(searchParams?.sort);
  const sort: SortKey = (SORTS as readonly string[]).includes(rawSort)
    ? (rawSort as SortKey)
    : 'uploaded';
  const dir: SortDir = oneParam(searchParams?.dir) === 'asc' ? 'asc' : 'desc';
  const statusFilter = oneParam(searchParams?.status);
  const caseFilter = oneParam(searchParams?.case);
  const query = oneParam(searchParams?.q).toLowerCase();

  // Everything the list's controls read back, in the one shape the
  // header cells and the filter selects both build their links from.
  const params: Record<string, string> = {
    view: view === 'all' ? '' : view,
    q: oneParam(searchParams?.q),
    status: statusFilter,
    case: caseFilter,
    sort: sort === 'uploaded' ? '' : sort,
    dir: dir === SORT_DEFAULT_DIR[sort] ? '' : dir,
  };

  const nowMs = Date.now();
  const caseTitleById = new Map(cases.map((c) => [c.id, c.title]));
  const titleOf = (d: FirmDocument) =>
    d.caseId ? caseTitleById.get(d.caseId) ?? null : null;

  const inView = allDocs.filter((d) => VIEWS[view](d, nowMs));
  const matched = inView.filter((d) => {
    if (statusFilter && d.status !== statusFilter) return false;
    if (caseFilter && d.caseId !== caseFilter) return false;
    if (query) {
      const hay = [d.name, d.description ?? '', ...(d.tags ?? [])]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  const sortKey: Record<SortKey, (d: FirmDocument) => string | null> = {
    name: (d) => d.name,
    status: (d) => FIRM_DOCUMENT_STATUS_LABEL[d.status] ?? d.status,
    matter: (d) => titleOf(d),
    due: (d) => d.dueAt,
    uploaded: (d) => d.uploadedAt,
  };
  const documents = sortRows(matched, sortKey[sort], dir);

  const viewOptions: ViewOption[] = (Object.keys(VIEWS) as ViewKey[]).map(
    (key) => ({
      key,
      label: VIEW_LABEL[key],
      count: allDocs.filter((d) => VIEWS[key](d, nowMs)).length,
    }),
  );

  // Only statuses and matters that some document actually carries. A
  // filter option that can only ever select nothing is a control that
  // does not work.
  const presentStatuses = [...new Set(allDocs.map((d) => d.status))].sort(
    (a, b) =>
      (FIRM_DOCUMENT_STATUS_LABEL[a] ?? a).localeCompare(
        FIRM_DOCUMENT_STATUS_LABEL[b] ?? b,
      ),
  );
  const presentCaseIds = [
    ...new Set(allDocs.map((d) => d.caseId).filter((id): id is string => !!id)),
  ];
  const caseOptions = presentCaseIds
    .map((id) => ({ value: id, label: caseTitleById.get(id) ?? 'Unknown matter' }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const filtered = Boolean(statusFilter || caseFilter || query);
  const canUpload = ['owner', 'admin', 'attorney', 'paralegal'].includes(
    ctx.membership.role,
  );

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>Counsel · documents</T>}
        title={<T>Document vault</T>}
        subtitle={
          <>
            {allDocs.length} <T>documents at</T>{' '}
            <span data-no-translate>{ctx.firm.name}</span>.{' '}
            <T>
              Search a name, a description or a tag; filter by status and by
              matter; sort the document, status, matter, due and uploaded
              columns. The view, the filters and the sort are in the address
              bar, so a narrowed vault can be sent to a colleague.
            </T>
          </>
        }
      />

      {canUpload && <UploadDocumentForm firmId={ctx.firm.id} cases={cases} />}

      {allDocs.length === 0 ? (
        <EmptyState
          title={<T>No documents yet.</T>}
          sub={
            <T>
              Upload contracts, court filings, or evidence packets above. Files
              up to 50 MB each.
            </T>
          }
        />
      ) : (
        <div className="space-y-3">
          <ViewStrip
            options={viewOptions}
            active={view}
            href={(key) => listHref(PATH, params, { view: key === 'all' ? '' : key })}
            label="Document views"
          />

          <Toolbar
            note={
              <>
                {documents.length}/{allDocs.length} <T>documents match</T>
              </>
            }
          >
            <SearchFilter
              pathname={PATH}
              params={params}
              label="Search documents"
              placeholder="Search a name, a tag, a description"
            />
            {filtered && (
              <ClearFilters
                pathname={PATH}
                params={params}
                keys={['q', 'status', 'case']}
              />
            )}
          </Toolbar>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[58rem] border-collapse text-left">
                <thead className="border-b border-edge">
                  <tr>
                    <SortHeader
                      pathname={PATH}
                      params={params}
                      sortKey="name"
                      defaultDir="asc"
                    >
                      <T>Document</T>
                    </SortHeader>
                    <PlainHeader>
                      <T>Document id</T>
                    </PlainHeader>
                    <SortHeader
                      pathname={PATH}
                      params={params}
                      sortKey="status"
                      defaultDir="asc"
                    >
                      <T>Status</T>
                    </SortHeader>
                    <SortHeader
                      pathname={PATH}
                      params={params}
                      sortKey="matter"
                      defaultDir="asc"
                    >
                      <T>Matter</T>
                    </SortHeader>
                    <SortHeader
                      pathname={PATH}
                      params={params}
                      sortKey="due"
                      defaultDir="asc"
                    >
                      <T>Due</T>
                    </SortHeader>
                    <SortHeader
                      pathname={PATH}
                      params={params}
                      sortKey="uploaded"
                    >
                      <T>Uploaded</T>
                    </SortHeader>
                  </tr>
                  <tr className="border-t border-edge bg-surface-2">
                    <td className="px-3 py-1.5" />
                    <td className="px-3 py-1.5" />
                    <td className="px-3 py-1.5">
                      <FilterSelect
                        pathname={PATH}
                        params={params}
                        name="status"
                        label="Filter by status"
                        className="min-w-[9rem]"
                        options={[
                          { value: '', label: 'Any status' },
                          ...presentStatuses.map((s) => ({
                            value: s,
                            label: FIRM_DOCUMENT_STATUS_LABEL[s] ?? s,
                          })),
                        ]}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <FilterSelect
                        pathname={PATH}
                        params={params}
                        name="case"
                        label="Filter by matter"
                        className="min-w-[10rem]"
                        options={[
                          { value: '', label: 'Any matter' },
                          ...caseOptions,
                        ]}
                      />
                    </td>
                    <td className="px-3 py-1.5" />
                    <td className="px-3 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {documents.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-8 text-center text-[13px] text-muted"
                      >
                        <T>No documents match this view and these filters.</T>
                      </td>
                    </tr>
                  ) : (
                    documents.map((d) => {
                      const overdue = isOverdue(d, nowMs);
                      const matterTitle = titleOf(d);
                      return (
                        <tr
                          key={d.id}
                          className="border-b border-edge last:border-0 transition-colors hover:bg-surface-2"
                        >
                          <td className="px-3 py-2.5">
                            <Link
                              href={`/counsel/documents/${d.id}`}
                              prefetch={false}
                              className="block min-w-0"
                            >
                              <span
                                className="block truncate text-[13.5px] font-semibold text-foreground"
                                data-no-translate
                              >
                                {d.name}
                              </span>
                              <span
                                className="block truncate text-[11.5px] text-muted"
                                data-no-translate
                              >
                                v{d.version} &middot;{' '}
                                {d.mimeType.split('/').pop() ?? 'file'} &middot;{' '}
                                {formatBytes(d.fileSize)}
                                {d.tags.length > 0 &&
                                  ` · ${d.tags.slice(0, 4).join(', ')}`}
                              </span>
                            </Link>
                          </td>
                          <td className="px-3 py-2.5">
                            <MonoRef title={d.id}>{shortRef(d.id)}</MonoRef>
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusPill dot size="sm" color={colorOf(d.status)}>
                              {FIRM_DOCUMENT_STATUS_LABEL[d.status] ?? d.status}
                            </StatusPill>
                          </td>
                          <td className="px-3 py-2.5 text-[12.5px]">
                            {matterTitle && d.caseId ? (
                              <Link
                                href={`/counsel/cases/${d.caseId}`}
                                prefetch={false}
                                className="block max-w-[16rem] truncate text-foreground hover:underline"
                                title={matterTitle}
                                data-no-translate
                              >
                                {matterTitle}
                              </Link>
                            ) : (
                              <span className="text-muted">
                                <T>Not on a matter</T>
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[11.5px] tabular-nums">
                            {d.dueAt ? (
                              <span
                                className={
                                  overdue
                                    ? 'font-semibold text-danger-text'
                                    : 'text-muted'
                                }
                              >
                                {new Date(d.dueAt).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                })}
                              </span>
                            ) : (
                              <span className="text-muted">
                                <T>Not set</T>
                              </span>
                            )}
                          </td>
                          <td
                            className="px-3 py-2.5 text-[12px] text-muted"
                            suppressHydrationWarning
                          >
                            {relativeTime(d.uploadedAt) ?? ''}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
