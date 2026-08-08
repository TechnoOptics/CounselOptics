import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';
import { getContractType } from '@/lib/contract-types';
import { PageHeader, EmptyState } from '@/components/counsel/ui';
import { StatusPill, PILL_COLORS } from '@/components/counsel/StatusPill';
import {
  Chip,
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
export const metadata = { title: 'Contracts · Counsel' };

const PATH = '/counsel/contracts';

/** How many rows one page of this list reads. */
const LIMIT = 200;

/** Inside this many days of its expiry date, a contract is expiring. */
const EXPIRING_DAYS = 90;

// One hex per status; StatusPill derives the fill and the border from
// it. An unlisted status falls back to the stored neutral.
const STATUS_COLOR: Record<string, string> = {
  stored: PILL_COLORS.neutral,
  reviewed: PILL_COLORS.good,
  expired: PILL_COLORS.flagged,
};

type ContractRow = {
  id: string;
  name: string;
  contract_type: string;
  custom_type: string | null;
  status: string;
  signed_at: string | null;
  expiry_at: string | null;
  review_confidence: number | null;
  reviewed_at: string | null;
  parties: string[];
  created_at: string;
};

type ViewKey = 'all' | 'unreviewed' | 'reviewed' | 'expiring' | 'expired';

/**
 * The views, as predicates over the whole set.
 *
 * Each one is a state a contract is genuinely in, read from its own
 * columns: whether a review has ever run on it, and where its expiry
 * date sits relative to today. Nothing here is a status the firm has to
 * set by hand, so no view can go stale against the row it describes.
 */
const VIEWS: Record<ViewKey, (r: ContractRow, nowMs: number) => boolean> = {
  all: () => true,
  unreviewed: (r) => r.reviewed_at == null,
  reviewed: (r) => r.reviewed_at != null,
  expiring: (r, nowMs) => {
    if (!r.expiry_at) return false;
    const at = Date.parse(r.expiry_at);
    return at >= nowMs && at <= nowMs + EXPIRING_DAYS * 86400_000;
  },
  expired: (r, nowMs) => Boolean(r.expiry_at && Date.parse(r.expiry_at) < nowMs),
};

const VIEW_LABEL: Record<ViewKey, JSX.Element> = {
  all: <T>Everything</T>,
  unreviewed: <T>Not reviewed</T>,
  reviewed: <T>Reviewed</T>,
  expiring: <T>Expiring within 90 days</T>,
  expired: <T>Expired</T>,
};

const SORTS = ['name', 'type', 'status', 'review', 'expiry', 'added'] as const;
type SortKey = (typeof SORTS)[number];

const SORT_DEFAULT_DIR: Record<SortKey, SortDir> = {
  name: 'asc',
  type: 'asc',
  status: 'asc',
  review: 'desc',
  expiry: 'asc',
  added: 'desc',
};

/** What the firm calls this contract's type, in one place. */
function typeLabel(r: ContractRow): string {
  return r.custom_type ?? getContractType(r.contract_type)?.label ?? r.contract_type;
}

/**
 * The firm's standalone contracts, as the list pattern in
 * docs/TECHOTTIC-PARITY-SPEC.md section 3.
 *
 * Left out of the pattern, each because the data is not there. No
 * checkbox column: nothing in this product acts on a set of contracts
 * at once, so a selection would have had no action behind it. No
 * secondary action beside the primary one: adding a contract is the
 * only thing this page starts. The mono reference is the contract's id,
 * shortened, because a contract carries no reference number.
 */
export default async function CounselContractsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const supabase = createServerSupabase();
  const { data, count } = await supabase
    .from('user_contracts')
    .select(
      'id, name, contract_type, custom_type, status, signed_at, expiry_at, review_confidence, reviewed_at, parties, created_at',
      { count: 'exact' },
    )
    .eq('firm_id', ctx.firm.id)
    .order('created_at', { ascending: false })
    .limit(LIMIT);
  const rows = (data ?? []) as ContractRow[];
  // The true number of contracts the firm holds, which is not the same
  // as the number this page read. Saying "200 contracts" over a repository
  // of 500 is the kind of claim this surface is not allowed to make.
  const total = count ?? rows.length;

  const rawView = oneParam(searchParams?.view);
  const view: ViewKey = rawView in VIEWS ? (rawView as ViewKey) : 'all';
  const rawSort = oneParam(searchParams?.sort);
  const sort: SortKey = (SORTS as readonly string[]).includes(rawSort)
    ? (rawSort as SortKey)
    : 'added';
  const dir: SortDir = oneParam(searchParams?.dir) === 'asc' ? 'asc' : 'desc';
  const typeFilter = oneParam(searchParams?.type);
  const statusFilter = oneParam(searchParams?.status);
  const query = oneParam(searchParams?.q).toLowerCase();

  const params: Record<string, string> = {
    view: view === 'all' ? '' : view,
    q: oneParam(searchParams?.q),
    type: typeFilter,
    status: statusFilter,
    sort: sort === 'added' ? '' : sort,
    dir: dir === SORT_DEFAULT_DIR[sort] ? '' : dir,
  };

  const nowMs = Date.now();
  const matched = rows
    .filter((r) => VIEWS[view](r, nowMs))
    .filter((r) => {
      if (typeFilter && typeLabel(r) !== typeFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (query) {
        const hay = [r.name, typeLabel(r), ...(r.parties ?? [])]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

  const sortKey: Record<SortKey, (r: ContractRow) => string | number | null> = {
    name: (r) => r.name,
    type: (r) => typeLabel(r),
    status: (r) => r.status,
    review: (r) => r.review_confidence,
    expiry: (r) => r.expiry_at,
    added: (r) => r.created_at,
  };
  const contracts = sortRows(matched, sortKey[sort], dir);

  const viewOptions: ViewOption[] = (Object.keys(VIEWS) as ViewKey[]).map(
    (key) => ({
      key,
      label: VIEW_LABEL[key],
      count: rows.filter((r) => VIEWS[key](r, nowMs)).length,
    }),
  );

  // Only the types and statuses these rows actually carry, so no option
  // in either select can select nothing.
  const typeOptions = [...new Set(rows.map(typeLabel))]
    .sort((a, b) => a.localeCompare(b))
    .map((label) => ({ value: label, label }));
  const statusOptions = [...new Set(rows.map((r) => r.status))]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, label: value.replace(/_/g, ' ') }));

  const filtered = Boolean(typeFilter || statusFilter || query);

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>Counsel · contracts</T>}
        title={<T>Contract repository</T>}
        subtitle={
          <>
            {total} <T>contracts at</T>{' '}
            <span data-no-translate>{ctx.firm.name}</span>
            {total > rows.length && (
              <>
                {', '}
                <T>of which this page reads the</T> {rows.length}{' '}
                <T>most recently added</T>
              </>
            )}
            .{' '}
            <T>
              Standalone agreements that sit outside a matter: firm operating
              documents, vendor agreements, employment offers. Search a name,
              a party or a type; filter by type and status; sort any column.
            </T>
          </>
        }
        action={
          <Link href="/counsel/contracts/new" className="btn-primary text-sm">
            <T>Add a contract</T>
          </Link>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title={<T>No contracts stored yet.</T>}
          sub={
            <T>
              Upload an NDA, MSA, lease, or anything else not yet associated
              with a matter.
            </T>
          }
          action={
            <Link href="/counsel/contracts/new" className="btn-primary">
              <T>Upload your first contract</T>
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          <ViewStrip
            options={viewOptions}
            active={view}
            href={(key) =>
              listHref(PATH, params, { view: key === 'all' ? '' : key })
            }
            label="Contract views"
          />

          <Toolbar
            note={
              <>
                {contracts.length}/{rows.length} <T>contracts match</T>
              </>
            }
          >
            <SearchFilter
              pathname={PATH}
              params={params}
              label="Search contracts"
              placeholder="Search a name, a party, a type"
            />
            {filtered && (
              <ClearFilters
                pathname={PATH}
                params={params}
                keys={['q', 'type', 'status']}
              />
            )}
          </Toolbar>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[64rem] border-collapse text-left">
                <thead className="border-b border-edge">
                  <tr>
                    <SortHeader
                      pathname={PATH}
                      params={params}
                      sortKey="name"
                      defaultDir="asc"
                    >
                      <T>Contract</T>
                    </SortHeader>
                    <PlainHeader>
                      <T>Contract id</T>
                    </PlainHeader>
                    <SortHeader
                      pathname={PATH}
                      params={params}
                      sortKey="type"
                      defaultDir="asc"
                    >
                      <T>Type</T>
                    </SortHeader>
                    <SortHeader
                      pathname={PATH}
                      params={params}
                      sortKey="status"
                      defaultDir="asc"
                    >
                      <T>Status</T>
                    </SortHeader>
                    <SortHeader pathname={PATH} params={params} sortKey="review">
                      <T>Advottic Review</T>
                    </SortHeader>
                    <SortHeader
                      pathname={PATH}
                      params={params}
                      sortKey="expiry"
                      defaultDir="asc"
                    >
                      <T>Expires</T>
                    </SortHeader>
                    <SortHeader pathname={PATH} params={params} sortKey="added">
                      <T>Added</T>
                    </SortHeader>
                  </tr>
                  <tr className="border-t border-edge bg-surface-2">
                    <td className="px-3 py-1.5" />
                    <td className="px-3 py-1.5" />
                    <td className="px-3 py-1.5">
                      <FilterSelect
                        pathname={PATH}
                        params={params}
                        name="type"
                        label="Filter by contract type"
                        className="min-w-[9rem]"
                        options={[
                          { value: '', label: 'Any type' },
                          ...typeOptions,
                        ]}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <FilterSelect
                        pathname={PATH}
                        params={params}
                        name="status"
                        label="Filter by status"
                        className="min-w-[8rem]"
                        options={[
                          { value: '', label: 'Any status' },
                          ...statusOptions,
                        ]}
                      />
                    </td>
                    <td className="px-3 py-1.5" />
                    <td className="px-3 py-1.5" />
                    <td className="px-3 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {contracts.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-3 py-8 text-center text-[13px] text-muted"
                      >
                        <T>No contracts match this view and these filters.</T>
                      </td>
                    </tr>
                  ) : (
                    contracts.map((r) => {
                      const expired = Boolean(
                        r.expiry_at && Date.parse(r.expiry_at) < nowMs,
                      );
                      return (
                        <tr
                          key={r.id}
                          className="border-b border-edge last:border-0 transition-colors hover:bg-surface-2"
                        >
                          <td className="px-3 py-2.5">
                            <Link
                              href={`/counsel/contracts/${r.id}`}
                              prefetch={false}
                              className="block min-w-0"
                            >
                              <span
                                className="block truncate text-[13.5px] font-semibold text-foreground"
                                data-no-translate
                              >
                                {r.name}
                              </span>
                              {r.parties.length > 0 && (
                                <span
                                  className="block truncate text-[11.5px] text-muted"
                                  data-no-translate
                                >
                                  {r.parties.slice(0, 3).join(', ')}
                                </span>
                              )}
                            </Link>
                          </td>
                          <td className="px-3 py-2.5">
                            <MonoRef title={r.id}>{shortRef(r.id)}</MonoRef>
                          </td>
                          <td className="px-3 py-2.5">
                            <Chip>
                              <span data-no-translate>{typeLabel(r)}</span>
                            </Chip>
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusPill
                              dot
                              size="sm"
                              color={STATUS_COLOR[r.status] ?? STATUS_COLOR.stored}
                            >
                              {r.status.replace(/_/g, ' ')}
                            </StatusPill>
                          </td>
                          <td className="px-3 py-2.5 text-[12.5px]">
                            {r.review_confidence != null ? (
                              <span className="font-mono tabular-nums text-foreground">
                                {r.review_confidence}/100
                              </span>
                            ) : (
                              <span className="text-muted">
                                <T>Not reviewed</T>
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[11.5px] tabular-nums">
                            {r.expiry_at ? (
                              <span
                                className={
                                  expired
                                    ? 'font-semibold text-danger-text'
                                    : 'text-muted'
                                }
                              >
                                {new Date(r.expiry_at).toLocaleDateString(
                                  undefined,
                                  { month: 'short', day: 'numeric', year: 'numeric' },
                                )}
                              </span>
                            ) : (
                              <span className="text-muted">
                                <T>Not set</T>
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-[12px] text-muted">
                            {relativeTime(r.created_at) ?? ''}
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
