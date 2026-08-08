'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { assignTo } from './assign-to';
import { setStatus } from './set-status';
import { T, useT } from '@/components/i18n/LocaleProvider';
import {
  MonoRef,
  Toolbar,
  ViewStrip,
  relativeTime,
  shortRef,
  type ViewOption,
} from '@/components/counsel/patterns';
import {
  PAGE_SIZE,
  VIEW_KEYS,
  filterMatters,
  hasActiveFilters,
  matterListHref,
  nextSort,
  paginateMatters,
  sortMatters,
  viewTest,
  type MatterListParams,
  type MatterPage,
  type MatterRow,
  type SortKey,
  type ViewKey,
} from '@/lib/matter-list';

export type { MatterRow };

/**
 * The matter list: views, per-column filters, sorting, pagination, and
 * the reassignment the rows can perform.
 *
 * The list pattern in PARITY-SPEC.md section 3. What the URL says is
 * what the list shows: the view, every filter, the sort and the page
 * all live in the query string, parsed by the page and handed down as
 * `params`. That is what makes a narrowed queue something a colleague
 * can be sent, makes the back button step back through views rather
 * than out of the page, and makes a refresh keep your place. The only
 * state this component owns is the text a person is mid-way through
 * typing and which rows they have ticked, neither of which survives a
 * reload anywhere.
 *
 * Departures from what the spec's section describes, each because
 * Advottic does not have the thing the reference is showing:
 *
 *   - The mono reference is the matter's id, shortened, because a
 *     matter has no number. See shortRef.
 *   - "Unassigned" is quiet rather than red. An unstaffed matter is a
 *     gap for the firm to close, not a failure to alarm them about.
 *   - The assignee and the status are editable in the row, and nothing
 *     else is. Both have a firm-gated mutation behind them that
 *     re-reads the matter's firm and checks the CALLER's role in it, so
 *     a call from a row is gated exactly as a call from the detail page
 *     is, and both confirm the row was written before reporting
 *     success. The status one had to be built for this: the consumer
 *     mutation writes through the user-scoped client, where a firm
 *     attorney who is not the case row's owner updated zero rows, was
 *     told it worked, and had the transition written into the audit
 *     chain. Nothing on this surface may reach for it, which
 *     tests/matter-list.test.ts pins.
 *
 * The checkbox column exists because there is a real thing to do with
 * a set of matters: reassign them, one call to setCaseAssigneeAction
 * per matter, which is what redistributing a departing attorney's
 * caseload is. It is deliberately the only bulk action, and it is the
 * same mutation the single-row picker uses, so it opens no new
 * authorization surface. If that action is ever removed, remove the
 * checkbox column with it.
 *
 * Filtering and sorting stay client-side over the whole set, which is
 * what keeps the view strip's counts honest: each count is the length
 * of the array that view would render. Pagination slices last, so the
 * counts still describe the view rather than the page.
 */

export type AssigneeOption = { value: string; label: string };

/** The member picker's options: every firm member, no pseudo-values. */
export type MemberOption = { userId: string; label: string };

// assignTo now lives in ./assign-to so the matter detail page's picker uses
// the same one. See that file for why the catch exists.

export function MattersTable({
  rows,
  params,
  assigneeOptions,
  members,
  statusOptions,
  meId,
  pathname = '/counsel/cases',
}: {
  rows: MatterRow[];
  /** The list's state, parsed from the query string by the page. */
  params: MatterListParams;
  /** Every firm member, plus the "me" and "unassigned" pseudo-values. */
  assigneeOptions: AssigneeOption[];
  /** Every firm member, for the pickers that WRITE an assignee. */
  members: MemberOption[];
  statusOptions: { value: string; label: string }[];
  /** The signed-in member, or null when the session has no user id. */
  meId: string | null;
  /**
   * The route this list lives at, which every link it writes points
   * back to. A prop rather than a constant so the table can be mounted
   * and driven somewhere other than the matters page.
   */
  pathname?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const href = (patch: Partial<MatterListParams>) =>
    matterListHref(params, patch, pathname);

  const go = (patch: Partial<MatterListParams>) =>
    router.push(href(patch), { scroll: false });

  // Text filters land in the URL too, but only once typing pauses: a
  // navigation per keystroke would be a history entry per keystroke and
  // a server render per keystroke. The input keeps its own value in the
  // meantime so it never lags behind the person using it.
  //
  // Patches accumulate rather than replace each other. Typing in the
  // matter box and then in the id box inside one debounce window is two
  // patches and one navigation, and dropping the first would silently
  // undo a filter the person had just set.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queued = useRef<Partial<MatterListParams>>({});
  const goSoon = (patch: Partial<MatterListParams>) => {
    queued.current = { ...queued.current, ...patch };
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      const next = queued.current;
      queued.current = {};
      router.replace(href(next), { scroll: false });
    }, 350);
  };

  const views: ViewKey[] = useMemo(
    () => VIEW_KEYS.filter((k) => k !== 'mine' || meId),
    [meId],
  );

  const viewLabel: Record<ViewKey, JSX.Element> = {
    open: <T>Open work</T>,
    mine: <T>Mine</T>,
    unassigned: <T>Unassigned</T>,
    hearing: <T>Hearing within 30 days</T>,
    all: <T>Everything</T>,
  };

  const options: ViewOption[] = views.map((key) => ({
    key,
    label: viewLabel[key],
    count: rows.filter(viewTest(key, meId)).length,
  }));

  const matched = useMemo(
    () => sortMatters(filterMatters(rows, params, meId), params),
    [rows, params, meId],
  );
  const page = useMemo(
    () => paginateMatters(matched, params.page),
    [matched, params.page],
  );

  // Only rows a person can see count as selected. A tick left behind by
  // a filter change cannot be acted on, and is not counted either.
  const selectedIds = page.rows.filter((r) => selected.has(r.id)).map((r) => r.id);
  const allOnPage = page.rows.length > 0 && selectedIds.length === page.rows.length;

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const head = (key: SortKey, label: JSX.Element) => {
    const on = params.sort === key;
    return (
      <th
        scope="col"
        aria-sort={
          on ? (params.dir === 'asc' ? 'ascending' : 'descending') : 'none'
        }
        className="px-3 py-2 text-left"
      >
        <Link
          href={href(nextSort(params, key))}
          scroll={false}
          className={`inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] transition-colors ${
            on ? 'text-foreground' : 'text-muted hover:text-foreground'
          }`}
        >
          {label}
          <span aria-hidden className="text-[9px] leading-none">
            {on ? (params.dir === 'asc' ? '▲' : '▼') : '↕'}
          </span>
        </Link>
      </th>
    );
  };

  return (
    <div className="space-y-3">
      <ViewStrip
        options={options}
        active={params.view}
        href={(key) => href({ view: key as ViewKey })}
        label={t('Matter views')}
      />

      <Toolbar
        note={
          <>
            {page.total}/{rows.length} <T>matters match</T>
          </>
        }
      >
        <input
          type="search"
          defaultValue={params.q}
          onChange={(e) => goSoon({ q: e.target.value })}
          placeholder={t('Search title, client, matter type, assignee')}
          aria-label={t('Search matters')}
          className="input h-9 w-full max-w-xs py-1"
        />
        {hasActiveFilters(params) && (
          <Link
            href={href({
              q: '',
              matter: '',
              ref: '',
              status: '',
              assignee: '',
              hearing: '',
              updated: '',
            })}
            scroll={false}
            className="btn-ghost h-9 px-3 text-[12.5px]"
          >
            <T>Clear filters</T>
          </Link>
        )}
      </Toolbar>

      {selectedIds.length > 0 && (
        <BulkAssign
          ids={selectedIds}
          members={members}
          onDone={() => {
            setSelected(new Set());
            router.refresh();
          }}
          onClear={() => setSelected(new Set())}
        />
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[62rem] border-collapse text-left">
            <thead className="border-b border-edge">
              <tr>
                <th scope="col" className="w-9 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allOnPage}
                    // Some but not all: the box says "there is a
                    // selection" without claiming it covers the page.
                    ref={(el) => {
                      if (el) {
                        el.indeterminate =
                          selectedIds.length > 0 && !allOnPage;
                      }
                    }}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? new Set(page.rows.map((r) => r.id))
                          : new Set(),
                      )
                    }
                    aria-label={t('Select every matter on this page')}
                    className="h-3.5 w-3.5 align-middle accent-[var(--accent)]"
                  />
                </th>
                {head('title', <T>Matter</T>)}
                <th
                  scope="col"
                  className="px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted"
                >
                  <T>Matter id</T>
                </th>
                {head('status', <T>Status</T>)}
                {head('assignee', <T>Assignee</T>)}
                {head('hearing', <T>Hearing</T>)}
                {head('updated', <T>Updated</T>)}
              </tr>
              <tr className="border-t border-edge bg-surface-2">
                <td className="px-3 py-1.5" />
                <td className="px-3 py-1.5">
                  <input
                    type="search"
                    defaultValue={params.matter}
                    onChange={(e) => goSoon({ matter: e.target.value })}
                    placeholder={t('Title or client')}
                    aria-label={t('Filter by matter')}
                    className="input h-7 w-full min-w-[9rem] px-2 py-0"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="search"
                    defaultValue={params.ref}
                    onChange={(e) => goSoon({ ref: e.target.value })}
                    placeholder={t('Id')}
                    aria-label={t('Filter by matter id')}
                    className="input h-7 w-full min-w-[6rem] px-2 py-0"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <select
                    value={params.status}
                    onChange={(e) => go({ status: e.target.value })}
                    aria-label={t('Filter by status')}
                    className="input h-7 w-full min-w-[8rem] px-2 py-0"
                  >
                    <option value="">{t('Any status')}</option>
                    {statusOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {t(o.label)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-1.5">
                  <select
                    value={params.assignee}
                    onChange={(e) => go({ assignee: e.target.value })}
                    aria-label={t('Filter by assignee')}
                    // Member-name options are user data.
                    data-no-translate
                    className="input h-7 w-full min-w-[9rem] px-2 py-0"
                  >
                    {assigneeOptions.map((o) => (
                      <option key={o.value || 'all'} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-1.5">
                  <select
                    value={params.hearing}
                    onChange={(e) => go({ hearing: e.target.value as MatterListParams['hearing'] })}
                    aria-label={t('Filter by hearing')}
                    className="input h-7 w-full min-w-[8rem] px-2 py-0"
                  >
                    <option value="">{t('Any hearing')}</option>
                    <option value="soon">{t('Within 30 days')}</option>
                    <option value="set">{t('Date set')}</option>
                    <option value="past">{t('Already past')}</option>
                    <option value="none">{t('Not set')}</option>
                  </select>
                </td>
                <td className="px-3 py-1.5">
                  <select
                    value={params.updated}
                    onChange={(e) => go({ updated: e.target.value as MatterListParams['updated'] })}
                    aria-label={t('Filter by last updated')}
                    className="input h-7 w-full min-w-[8rem] px-2 py-0"
                  >
                    <option value="">{t('Any time')}</option>
                    <option value="24h">{t('Last 24 hours')}</option>
                    <option value="7d">{t('Last 7 days')}</option>
                    <option value="30d">{t('Last 30 days')}</option>
                    <option value="older">{t('Over 30 days ago')}</option>
                  </select>
                </td>
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-[13px] text-muted">
                    <T>No matters match this view and these filters.</T>
                  </td>
                </tr>
              ) : (
                page.rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-edge last:border-0 transition-colors hover:bg-surface-2"
                  >
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={(e) => toggle(r.id, e.target.checked)}
                        aria-label={t('Select this matter')}
                        className="h-3.5 w-3.5 align-middle accent-[var(--accent)]"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/counsel/cases/${r.id}`}
                        prefetch={false}
                        className="block min-w-0"
                      >
                        <span
                          className="block truncate text-[13.5px] font-semibold text-foreground"
                          data-no-translate
                        >
                          {r.title}
                        </span>
                        <span
                          className="block truncate text-[11.5px] text-muted"
                          data-no-translate
                        >
                          {r.subjectName} &middot; {r.caseType}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <MonoRef title={r.id}>{shortRef(r.id)}</MonoRef>
                    </td>
                    <td className="px-3 py-2.5">
                      <RowStatus
                        caseId={r.id}
                        current={r.status}
                        color={r.statusColor}
                        options={statusOptions}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-[12.5px]">
                      <RowAssignee
                        caseId={r.id}
                        current={r.assignedTo}
                        members={members}
                      />
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11.5px] tabular-nums text-muted">
                      {r.hearingAt ? (
                        new Date(r.hearingAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      ) : (
                        <T>Not set</T>
                      )}
                    </td>
                    <td
                      className="px-3 py-2.5 text-[12px] text-muted"
                      suppressHydrationWarning
                    >
                      {relativeTime(r.updatedAt) ?? ''}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pager page={page} href={href} />
    </div>
  );
}

/**
 * Prev and Next, with the range they are stepping through.
 *
 * Links rather than buttons, for the same reason the views are links:
 * page 3 of a queue is a place, and the back button should return from
 * it. Both ends render at every page count so the row does not change
 * height as you walk it; the one you cannot use is a plain span.
 */
function Pager({
  page,
  href,
}: {
  page: MatterPage;
  href: (patch: Partial<MatterListParams>) => string;
}) {
  const t = useT();
  if (page.total <= PAGE_SIZE) return null;
  const step = (to: number, label: string, enabled: boolean) =>
    enabled ? (
      <Link
        href={href({ page: to })}
        scroll={false}
        className="btn-secondary h-8 px-3 text-[12.5px]"
      >
        {label}
      </Link>
    ) : (
      <span
        aria-disabled
        className="btn-secondary pointer-events-none h-8 px-3 text-[12.5px] opacity-40"
      >
        {label}
      </span>
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {step(page.page - 1, t('Previous'), page.page > 1)}
      {step(page.page + 1, t('Next'), page.page < page.pageCount)}
      <p className="text-[12px] tabular-nums text-muted">
        {page.from}
        {'–'}
        {page.to} <T>of</T> {page.total}
      </p>
    </div>
  );
}

/**
 * The assignee cell, which is also the control that sets it.
 *
 * Reverts to the previous value and says why when the write is
 * refused, because a select that snaps back with no explanation is how
 * a person concludes the product is broken.
 */
function RowAssignee({
  caseId,
  current,
  members,
}: {
  caseId: string;
  current: string | null;
  members: MemberOption[];
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(current ?? '');
  const [error, setError] = useState<string | null>(null);

  function onChange(next: string) {
    const prev = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const res = await assignTo(caseId, next);
      if (res.ok) {
        router.refresh();
      } else {
        setValue(prev);
        setError(res.error ?? t('Could not update the assignee.'));
      }
    });
  }

  return (
    <div className="flex flex-col gap-0.5">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.currentTarget.value)}
        aria-label={t('Assigned to')}
        // Member-name options are user data.
        data-no-translate
        className="input h-7 w-full min-w-[9rem] px-2 py-0 disabled:opacity-60"
      >
        <option value="">{t('Unassigned')}</option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.label}
          </option>
        ))}
      </select>
      {error && (
        <p className="text-[11px] text-rose-700 dark:text-rose-300">{error}</p>
      )}
    </div>
  );
}

/**
 * The status cell, which is also the control that sets it.
 *
 * Keeps the state's colour as a dot beside the select. The pill this
 * replaced carried that colour, and it is what lets a person read a
 * column of thirty matters without reading thirty words; a bare select
 * would have traded that away for the control.
 *
 * Reverts and says why on refusal, exactly as RowAssignee does. The
 * refusals a firm member will actually meet here are a role that may
 * not post (staff are sold read-only) and an organization whose access
 * has ended, and both deserve a sentence rather than a silent snap-back.
 */
function RowStatus({
  caseId,
  current,
  color,
  options,
}: {
  caseId: string;
  current: string;
  color: string;
  options: { value: string; label: string }[];
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);

  function onChange(next: string) {
    const prev = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const res = await setStatus(caseId, next);
      if (res.ok) {
        router.refresh();
      } else {
        setValue(prev);
        setError(res.error ?? t('Could not change the matter status.'));
      }
    });
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-1.5 w-1.5 flex-none rounded-full"
          style={{ background: color }}
        />
        <select
          value={value}
          disabled={pending}
          onChange={(e) => onChange(e.currentTarget.value)}
          aria-label={t('Matter status')}
          className="input h-7 w-full min-w-[8rem] px-2 py-0 disabled:opacity-60"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.label)}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p className="text-[11px] text-rose-700 dark:text-rose-300">{error}</p>
      )}
    </div>
  );
}

/**
 * The one thing a selection of matters can be used for: reassigning
 * them together.
 *
 * One setCaseAssigneeAction per matter rather than a new bulk endpoint,
 * so each matter is gated on its own firm exactly as it is from the
 * detail page and nothing new is exposed. Sequential, because the set
 * is at most one page. A partial failure is reported as a partial
 * failure: the matters that did move stay moved, and the count that
 * did not is shown rather than swallowed.
 */
function BulkAssign({
  ids,
  members,
  onDone,
  onClear,
}: {
  ids: string[];
  members: MemberOption[];
  onDone: () => void;
  onClear: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState('');
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<{ bad: number; total: number } | null>(
    null,
  );

  function run() {
    setFailed(null);
    startTransition(async () => {
      let bad = 0;
      for (const id of ids) {
        const res = await assignTo(id, value);
        if (!res.ok) bad += 1;
      }
      if (bad > 0) setFailed({ bad, total: ids.length });
      else onDone();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-edge bg-surface p-2">
      <p className="pl-1 text-[12.5px] tabular-nums text-foreground">
        {ids.length} <T>selected</T>
      </p>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={t('Reassign the selected matters to')}
        // Member-name options are user data.
        data-no-translate
        className="input h-8 w-auto px-2 py-0"
      >
        <option value="">{t('Unassigned')}</option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="btn-primary h-8 px-3 text-[12.5px] disabled:opacity-60"
      >
        {pending ? t('Reassigning') : t('Reassign')}
      </button>
      <button
        type="button"
        onClick={onClear}
        className="btn-ghost h-8 px-3 text-[12.5px]"
      >
        <T>Clear selection</T>
      </button>
      {failed != null && (
        // Says which of the two happened. "The rest were reassigned"
        // when every one of them failed would be the list telling a
        // person work landed that did not.
        <p className="text-[11.5px] text-rose-700 dark:text-rose-300">
          {failed.bad}{' '}
          {failed.bad === failed.total
            ? t('could not be reassigned.')
            : t('could not be reassigned. The rest were.')}
        </p>
      )}
    </div>
  );
}
