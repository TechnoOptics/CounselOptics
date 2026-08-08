'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { StatusPill } from '@/components/counsel/StatusPill';
import {
  MonoRef,
  Toolbar,
  ViewStrip,
  relativeTime,
  shortRef,
  type ViewOption,
} from '@/components/counsel/patterns';

/**
 * The matter list: views, filters, sorting, and the table itself.
 *
 * The list pattern in PARITY-SPEC.md section 3. Three deliberate
 * departures from what that section describes, each because Advottic
 * does not have the thing Techottic is showing:
 *
 *   - No checkbox column. Nothing in the product performs an action
 *     over a set of matters, so a checkbox would select rows that
 *     nothing could then be done to. The page header's subtitle
 *     promises what is here and not that.
 *   - The mono reference is the matter's id, shortened, because a
 *     matter has no number. See shortRef.
 *   - "Unassigned" is quiet rather than red. An unstaffed matter is a
 *     gap for the firm to close, not a failure to alarm them about.
 *
 * Filtering and sorting are client-side over the whole set, which is
 * what makes the counts on the view strip honest: each one is the
 * length of the array that view would render. The page ships every
 * matter the firm has, so there is no page-2 of anything to be wrong
 * about either.
 */

export type MatterRow = {
  id: string;
  title: string;
  subjectName: string;
  caseType: string;
  status: string;
  statusLabel: string;
  statusColor: string;
  assignedTo: string | null;
  assigneeLabel: string | null;
  hearingAt: string | null;
  updatedAt: string;
};

export type AssigneeOption = { value: string; label: string };

/** Workflow order, so sorting by status walks the pipeline. */
const STATUS_ORDER = [
  'draft',
  'open',
  'under_review',
  'needs_evidence',
  'export_ready',
  'closed',
  'archived',
];

const CLOSED = new Set(['closed', 'archived']);

/** A hearing this close is the one the list should surface. */
const HEARING_SOON_DAYS = 30;

function hearingSoon(iso: string | null): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return false;
  const delta = at - Date.now();
  return delta >= 0 && delta <= HEARING_SOON_DAYS * 86400 * 1000;
}

type SortKey = 'title' | 'status' | 'assignee' | 'hearing' | 'updated';

const SORT_DEFAULT_DIR: Record<SortKey, 'asc' | 'desc'> = {
  title: 'asc',
  status: 'asc',
  assignee: 'asc',
  hearing: 'asc',
  updated: 'desc',
};

export function MattersTable({
  rows,
  assigneeOptions,
  statusOptions,
  meId,
  initialAssignee,
}: {
  rows: MatterRow[];
  /** Every firm member, plus the "me" and "unassigned" pseudo-values. */
  assigneeOptions: AssigneeOption[];
  statusOptions: { value: string; label: string }[];
  /** The signed-in member, or null when the session has no user id. */
  meId: string | null;
  /** `?assignee=` from the URL, so existing links still land filtered. */
  initialAssignee: string;
}) {
  const t = useT();
  const [view, setView] = useState('open');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [assignee, setAssignee] = useState(initialAssignee);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'updated',
    dir: 'desc',
  });

  // Each view is a predicate over the same array, so the strip's counts
  // and the rows it then shows come from one definition.
  const views = useMemo(() => {
    const defs: { key: string; test: (r: MatterRow) => boolean }[] = [
      { key: 'open', test: (r) => !CLOSED.has(r.status) },
    ];
    if (meId) defs.push({ key: 'mine', test: (r) => r.assignedTo === meId });
    defs.push(
      { key: 'unassigned', test: (r) => !r.assignedTo },
      { key: 'hearing', test: (r) => hearingSoon(r.hearingAt) },
      { key: 'all', test: () => true },
    );
    return defs;
  }, [meId]);

  const viewLabel: Record<string, JSX.Element> = {
    open: <T>Open work</T>,
    mine: <T>Mine</T>,
    unassigned: <T>Unassigned</T>,
    hearing: <T>Hearing within 30 days</T>,
    all: <T>Everything</T>,
  };

  const options: ViewOption[] = views.map((v) => ({
    key: v.key,
    label: viewLabel[v.key],
    count: rows.filter(v.test).length,
  }));

  const shown = useMemo(() => {
    const test = views.find((v) => v.key === view)?.test ?? (() => true);
    const q = query.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (!test(r)) return false;
      if (status && r.status !== status) return false;
      if (assignee === 'unassigned' && r.assignedTo) return false;
      if (assignee === 'me' && r.assignedTo !== meId) return false;
      if (
        assignee &&
        assignee !== 'me' &&
        assignee !== 'unassigned' &&
        r.assignedTo !== assignee
      ) {
        return false;
      }
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.subjectName.toLowerCase().includes(q) ||
        r.caseType.toLowerCase().includes(q) ||
        (r.assigneeLabel ?? '').toLowerCase().includes(q)
      );
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    // A row with no hearing sorts last in both directions: an absent
    // date is not an early one, and flipping the column should not
    // parade the matters that have no hearing at all.
    const rank = (r: MatterRow): [number, string | number] => {
      switch (sort.key) {
        case 'title':
          return [0, r.title.toLowerCase()];
        case 'status':
          return [0, STATUS_ORDER.indexOf(r.status)];
        case 'assignee':
          return [r.assigneeLabel ? 0 : 1, (r.assigneeLabel ?? '').toLowerCase()];
        case 'hearing':
          return [r.hearingAt ? 0 : 1, r.hearingAt ? Date.parse(r.hearingAt) : 0];
        default:
          return [0, Date.parse(r.updatedAt) || 0];
      }
    };
    return [...filtered].sort((a, b) => {
      const [aNull, aVal] = rank(a);
      const [bNull, bVal] = rank(b);
      if (aNull !== bNull) return aNull - bNull;
      if (aVal < bVal) return -1 * dir;
      if (aVal > bVal) return 1 * dir;
      return 0;
    });
  }, [rows, views, view, query, status, assignee, meId, sort]);

  const head = (key: SortKey, label: JSX.Element) => {
    const on = sort.key === key;
    return (
      <th
        scope="col"
        aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className="px-3 py-2 text-left"
      >
        <button
          type="button"
          onClick={() =>
            setSort((s) =>
              s.key === key
                ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
                : { key, dir: SORT_DEFAULT_DIR[key] },
            )
          }
          className={`inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] transition-colors ${
            on ? 'text-foreground' : 'text-muted hover:text-foreground'
          }`}
        >
          {label}
          <span aria-hidden className="text-[9px] leading-none">
            {on ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
          </span>
        </button>
      </th>
    );
  };

  return (
    <div className="space-y-3">
      <ViewStrip
        options={options}
        active={view}
        onSelect={setView}
        label={t('Matter views')}
      />

      <Toolbar
        note={
          <>
            {shown.length}/{rows.length} <T>matters shown</T>
          </>
        }
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Search title, client, matter type, assignee')}
          aria-label={t('Search matters')}
          className="input h-9 w-full max-w-xs py-1"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label={t('Filter by status')}
          className="input h-9 w-auto py-1"
        >
          <option value="">{t('All statuses')}</option>
          {statusOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.label)}
            </option>
          ))}
        </select>
        <select
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          aria-label={t('Filter by assignee')}
          // Member-name options are user data.
          data-no-translate
          className="input h-9 w-auto py-1"
        >
          {assigneeOptions.map((o) => (
            <option key={o.value || 'all'} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Toolbar>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[54rem] border-collapse text-left">
            <thead className="border-b border-edge">
              <tr>
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
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-[13px] text-muted">
                    <T>No matters match this view and these filters.</T>
                  </td>
                </tr>
              ) : (
                shown.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-edge last:border-0 transition-colors hover:bg-surface-2"
                  >
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
                      <StatusPill size="sm" dot color={r.statusColor}>
                        {r.statusLabel}
                      </StatusPill>
                    </td>
                    <td className="px-3 py-2.5 text-[12.5px]">
                      {r.assigneeLabel ? (
                        <span className="text-foreground" data-no-translate>
                          {r.assigneeLabel}
                        </span>
                      ) : (
                        <span className="text-muted">
                          <T>Unassigned</T>
                        </span>
                      )}
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
    </div>
  );
}
