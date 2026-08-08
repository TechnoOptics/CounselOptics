import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  getActiveFirmContext,
  listFirmSigningRequestsWithSummary,
  type FirmSigningRequestSummary,
} from '@/lib/firm-storage';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { submissionCategoriesForRequests } from '@/lib/submission-completion';
import { normalizeCategory, UNFILED_CATEGORY } from '@/lib/document-category';
import {
  FIRM_SIGNING_STATUS_COLOR,
  FIRM_SIGNING_STATUS_LABEL,
  type FirmSigningStatus,
} from '@/lib/firm-types';
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
import { listHref, oneParam, sortRows, type SortDir } from '@/lib/counsel-list';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Signing · Counsel' };

const PATH = '/counsel/signing';

type ViewKey =
  | 'all'
  | 'draft'
  | 'out'
  | 'attention'
  | 'executed'
  | 'recalled';

/**
 * The views, as predicates over the whole set.
 *
 * Every one of them is a partition of the request's own status column,
 * so a view cannot disagree with the pill on the row it shows. The six
 * between them cover all seven statuses, which is why "Everything" is
 * the default: this page is a record of what has been sent, and the
 * first question asked of it is usually about a request somebody
 * remembers rather than about a queue.
 */
const VIEWS: Record<ViewKey, (r: FirmSigningRequestSummary) => boolean> = {
  all: () => true,
  draft: (r) => r.status === 'draft',
  out: (r) => r.status === 'sent' || r.status === 'partial',
  attention: (r) =>
    r.status === 'rejected' || r.status === 'changes_requested',
  executed: (r) => r.status === 'completed',
  recalled: (r) => r.status === 'canceled',
};

const VIEW_LABEL: Record<ViewKey, JSX.Element> = {
  all: <T>Everything</T>,
  draft: <T>Draft</T>,
  out: <T>Out for signature</T>,
  attention: <T>Needs attention</T>,
  executed: <T>Fully executed</T>,
  recalled: <T>Recalled</T>,
};

const SORTS = ['recipients', 'status', 'progress', 'filed', 'updated'] as const;
type SortKey = (typeof SORTS)[number];

const SORT_DEFAULT_DIR: Record<SortKey, SortDir> = {
  recipients: 'asc',
  status: 'asc',
  progress: 'desc',
  filed: 'asc',
  updated: 'desc',
};

/** What this request is called in a list: who it went to. */
function recipientLabel(r: FirmSigningRequestSummary): string {
  return r.recipients.length > 0
    ? r.recipients.join(', ')
    : `Request ${shortRef(r.id)}`;
}

/** The last thing that happened to this request, as a timestamp. */
function movedAt(r: FirmSigningRequestSummary): string {
  return r.completedAt ?? r.sentAt ?? r.createdAt;
}

/**
 * The firm's e-signature requests, as the list pattern in
 * docs/TECHOTTIC-PARITY-SPEC.md section 3.
 *
 * This replaces two stacked sections (fully executed, grouped under
 * category headings, then everything else) with one table. Nothing is
 * lost: the executed set is a view, and the category the signed copy
 * was filed under is a column and a filter rather than a heading, so it
 * can now be read and sorted for every request rather than only for the
 * completed ones.
 *
 * Left out of the pattern, each because the data is not there. No
 * document-name column: the list query returns a documentId and no
 * name, and joining one document per row for a name is a query this
 * page has never made. No checkbox column: there is no bulk action over
 * signing requests, and recall and resend are both per-signer decisions
 * that belong on the request. No action buttons beside the title:
 * a signing request starts from a document, which the subtitle says.
 */
export default async function CounselSigningPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const requests = await listFirmSigningRequestsWithSummary(ctx.firm.id);

  // Where each signed document was filed. The category comes from the
  // submission that produced the request, which is where it was copied
  // at filing time. The submissions table is behind RLS with no
  // policies, so this reads through the service-role client, scoped to
  // the firm getActiveFirmContext has already established the caller
  // belongs to.
  const admin = createAdminSupabase();
  const categories =
    admin && requests.length > 0
      ? await submissionCategoriesForRequests(
          admin,
          ctx.firm.id,
          requests.map((r) => r.id),
        )
      : new Map<string, string>();
  const filedUnder = (r: FirmSigningRequestSummary) =>
    normalizeCategory(categories.get(r.id) ?? null);
  // Before 20260807_flow_join.sql is applied no request has a category
  // to read, and a column of "Unfiled" says nothing. The column and its
  // filter appear once there is something to put in them.
  const showFiled = requests.some(
    (r) => filedUnder(r) !== UNFILED_CATEGORY,
  );

  const rawView = oneParam(searchParams?.view);
  const view: ViewKey = rawView in VIEWS ? (rawView as ViewKey) : 'all';
  const rawSort = oneParam(searchParams?.sort);
  const sort: SortKey = (SORTS as readonly string[]).includes(rawSort)
    ? (rawSort as SortKey)
    : 'updated';
  const dir: SortDir = oneParam(searchParams?.dir) === 'asc' ? 'asc' : 'desc';
  const statusFilter = oneParam(searchParams?.status);
  const filedFilter = showFiled ? oneParam(searchParams?.filed) : '';
  const query = oneParam(searchParams?.q).toLowerCase();

  const params: Record<string, string> = {
    view: view === 'all' ? '' : view,
    q: oneParam(searchParams?.q),
    status: statusFilter,
    filed: filedFilter,
    sort: sort === 'updated' ? '' : sort,
    dir: dir === SORT_DEFAULT_DIR[sort] ? '' : dir,
  };

  const matched = requests
    .filter((r) => VIEWS[view](r))
    .filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (filedFilter && filedUnder(r) !== filedFilter) return false;
      if (query && !recipientLabel(r).toLowerCase().includes(query)) return false;
      return true;
    });

  const sortKey: Record<
    SortKey,
    (r: FirmSigningRequestSummary) => string | number | null
  > = {
    recipients: (r) => recipientLabel(r),
    status: (r) => FIRM_SIGNING_STATUS_LABEL[r.status] ?? r.status,
    progress: (r) => (r.totalSigners > 0 ? r.signedCount / r.totalSigners : null),
    filed: (r) => filedUnder(r),
    updated: (r) => movedAt(r),
  };
  const rows = sortRows(matched, sortKey[sort], dir);

  const viewOptions: ViewOption[] = (Object.keys(VIEWS) as ViewKey[]).map(
    (key) => ({
      key,
      label: VIEW_LABEL[key],
      count: requests.filter(VIEWS[key]).length,
    }),
  );

  const presentStatuses = [
    ...new Set(requests.map((r) => r.status)),
  ].sort((a, b) =>
    FIRM_SIGNING_STATUS_LABEL[a].localeCompare(FIRM_SIGNING_STATUS_LABEL[b]),
  ) as FirmSigningStatus[];
  const filedOptions = showFiled
    ? [...new Set(requests.map(filedUnder))]
        .sort((a, b) => a.localeCompare(b))
        .map((c) => ({ value: c, label: c }))
    : [];

  const filtered = Boolean(statusFilter || filedFilter || query);
  const columns = showFiled ? 6 : 5;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>Counsel · signing</T>}
        title={<T>E-signature requests</T>}
        subtitle={
          <>
            {requests.length} <T>requests at</T>{' '}
            <span data-no-translate>{ctx.firm.name}</span>.{' '}
            <T>Search by signer, filter by state, and sort any column. Open a document from</T>{' '}
            <Link href="/counsel/documents" className="underline">
              <T>Documents</T>
            </Link>{' '}
            <T>to send a new request.</T>
          </>
        }
      />

      <section className="card p-5 sm:p-6">
        <p className="text-sm leading-relaxed text-foreground">
          <strong>
            <T>UETA-aligned signing.</T>
          </strong>{' '}
          <T>
            Each request hashes the document at creation, captures intent
            through a two-step disclosure flow, and appends every event (sent,
            viewed, signed, completed) to a tamper-evident audit chain you can
            inspect from each request below. Jurisdictional fit for specific
            document classes (real-estate conveyances, wills, certain UCC
            instruments) stays a question for your counsel.
          </T>
        </p>
      </section>

      {requests.length === 0 ? (
        <EmptyState
          title={<T>No signing requests yet.</T>}
          sub={<T>Open a document and use &ldquo;Send for signature&rdquo;.</T>}
        />
      ) : (
        <div className="space-y-3">
          <ViewStrip
            options={viewOptions}
            active={view}
            href={(key) =>
              listHref(PATH, params, { view: key === 'all' ? '' : key })
            }
            label="Signing request views"
          />

          <Toolbar
            note={
              <>
                {rows.length}/{requests.length} <T>requests match</T>
              </>
            }
          >
            <SearchFilter
              pathname={PATH}
              params={params}
              label="Search signing requests"
              placeholder="Search by signer name or email"
            />
            {filtered && (
              <ClearFilters
                pathname={PATH}
                params={params}
                keys={['q', 'status', 'filed']}
              />
            )}
          </Toolbar>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[54rem] border-collapse text-left">
                <thead className="border-b border-edge">
                  <tr>
                    <SortHeader
                      pathname={PATH}
                      params={params}
                      sortKey="recipients"
                      defaultDir="asc"
                    >
                      <T>Signers</T>
                    </SortHeader>
                    <PlainHeader>
                      <T>Request id</T>
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
                      sortKey="progress"
                    >
                      <T>Signed</T>
                    </SortHeader>
                    {showFiled && (
                      <SortHeader
                        pathname={PATH}
                        params={params}
                        sortKey="filed"
                        defaultDir="asc"
                      >
                        <T>Filed under</T>
                      </SortHeader>
                    )}
                    <SortHeader
                      pathname={PATH}
                      params={params}
                      sortKey="updated"
                    >
                      <T>Last moved</T>
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
                        className="min-w-[10rem]"
                        options={[
                          { value: '', label: 'Any status' },
                          ...presentStatuses.map((s) => ({
                            value: s,
                            label: FIRM_SIGNING_STATUS_LABEL[s],
                          })),
                        ]}
                      />
                    </td>
                    <td className="px-3 py-1.5" />
                    {showFiled && (
                      <td className="px-3 py-1.5">
                        <FilterSelect
                          pathname={PATH}
                          params={params}
                          name="filed"
                          label="Filter by what it was filed under"
                          className="min-w-[9rem]"
                          options={[
                            { value: '', label: 'Anywhere' },
                            ...filedOptions,
                          ]}
                        />
                      </td>
                    )}
                    <td className="px-3 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={columns}
                        className="px-3 py-8 text-center text-[13px] text-muted"
                      >
                        <T>No requests match this view and these filters.</T>
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b border-edge last:border-0 transition-colors hover:bg-surface-2"
                      >
                        <td className="px-3 py-2.5">
                          <Link
                            href={`/counsel/signing/${r.id}`}
                            prefetch={false}
                            className="block min-w-0"
                          >
                            <span
                              className="block truncate text-[13.5px] font-semibold text-foreground"
                              data-no-translate
                            >
                              {recipientLabel(r)}
                            </span>
                            <span className="block truncate text-[11.5px] text-muted">
                              {r.completedAt ? (
                                <T>signed</T>
                              ) : r.sentAt ? (
                                <T>sent</T>
                              ) : (
                                <T>created</T>
                              )}{' '}
                              {new Date(movedAt(r)).toLocaleDateString()}
                            </span>
                          </Link>
                        </td>
                        <td className="px-3 py-2.5">
                          <MonoRef title={r.id}>{shortRef(r.id)}</MonoRef>
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusPill
                            dot
                            size="sm"
                            color={FIRM_SIGNING_STATUS_COLOR[r.status]}
                          >
                            {FIRM_SIGNING_STATUS_LABEL[r.status]}
                          </StatusPill>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11.5px] tabular-nums text-muted">
                          {r.totalSigners > 0 ? (
                            <>
                              {r.signedCount}/{r.totalSigners}
                            </>
                          ) : (
                            <T>No signers</T>
                          )}
                        </td>
                        {showFiled && (
                          <td
                            className="px-3 py-2.5 text-[12.5px] text-muted"
                            data-no-translate
                          >
                            {filedUnder(r)}
                          </td>
                        )}
                        <td className="px-3 py-2.5 text-[12px] text-muted">
                          {relativeTime(movedAt(r)) ?? ''}
                        </td>
                      </tr>
                    ))
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
