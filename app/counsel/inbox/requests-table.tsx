'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { assignIntakeAction } from '@/lib/intake-conversation';
import { T, useT } from '@/components/i18n/LocaleProvider';
import {
  Chip,
  MonoRef,
  Toolbar,
  ViewStrip,
  relativeTime,
  type ViewOption,
} from '@/components/counsel/patterns';
import { StatusPill } from '@/components/counsel/StatusPill';
import {
  INTAKE_LIST_VIEW_KEYS,
  INTAKE_LIST_VIEW_LABEL,
  INTAKE_PAGE_SIZE,
  filterIntakes,
  hasActiveIntakeFilters,
  intakeListHref,
  intakeViewCounts,
  nextIntakeSort,
  paginateIntakes,
  sortIntakes,
  type IntakeListParams,
  type IntakeListRow,
  type IntakeListViewKey,
  type IntakePage,
  type IntakeSortKey,
} from '@/lib/intake-list';
import {
  INTAKE_PRIORITIES,
  INTAKE_WORKFLOW_STATES,
  WORKFLOW_LABEL,
  workflowColor,
  type IntakePriority,
} from '@/lib/intake-workflow';
import { signatureDirectionLabel } from '@/lib/intake-signature-direction';

export type { IntakeListRow };

/**
 * The request queue: views, per-column filters, sorting, pagination, and the
 * one thing a selection of requests can be used for.
 *
 * The list pattern this repo already ships at /counsel/cases, applied to the
 * work landing on the legal team. What the URL says is what the list shows -
 * the view, every filter, the sort and the page - so a narrowed queue is a
 * link a colleague can be sent, the back button steps between views, and a
 * refresh keeps your place. The only state this component owns is the text
 * somebody is mid-way through typing and which rows they have ticked, neither
 * of which survives a reload anywhere.
 *
 * WHAT THIS REPLACED. Four lane groups of cards over a read capped at 200
 * rows, each heading stating the length of the slice it had been handed. The
 * cards also spent gold three times on one screen - a "Reply" badge, an
 * "In-house" badge and an "awaiting your reply" pill - which is three claims
 * on the eye in a product whose rule is that the accent is spent once. The
 * accent on this screen is the New request button and nothing else.
 *
 * WHAT IT IS MODELLED ON, and what was deliberately left there. The reference
 * is an IT service desk: it grades priority P1 to P4, stars VIP requesters,
 * and prints a red "Breached" in an SLA column. None of the three exists here.
 * Priority is the product's own four words, the star is replaced by the fact
 * this product does have (whether the request came from one of the client's
 * own people), and where SLA would sit there is Age, which is quiet, because
 * nothing in this product records what a request was promised by and a red
 * word over a column the data cannot fill is the screen lying.
 *
 * The checkbox column exists because there is a real thing to do with a set of
 * requests: give them an owner, one assignIntakeAction call per row. That
 * action re-resolves access and refuses anyone who is not on the legal team,
 * so a call from a row is gated exactly as a call from the record is and
 * nothing new is exposed. If that action ever goes, the checkboxes go with it.
 */

export type OwnerOption = { value: string; label: string };
export type MemberOption = { userId: string; label: string };

/**
 * The priority chip.
 *
 * Only the top two carry a fill. Scanning a column of twenty-five rows, the
 * only ink is on the requests that are actually urgent, and Normal - which is
 * most of them, and is the value a request gets when nobody chose one - stays
 * quiet rather than adding a badge that says nothing. `rose-600` and
 * `amber-500` are the semantic hues, never the accent: an alert that borrowed
 * the gold would stop reading as an alert.
 */
const PRIORITY_TONE: Record<IntakePriority, string> = {
  Urgent: 'bg-rose-600 text-white',
  High: 'bg-amber-500 text-forest-950',
  Normal: 'border border-edge text-muted',
  Low: 'border border-edge text-muted opacity-70',
};

/** Two letters for the requester, so a column of names has a left edge. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** How long the request has been open, in the coarsest unit that says something. */
function ageLabel(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return '<1h';
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function RequestsTable({
  rows,
  params,
  ownerOptions,
  members,
  meId,
  firmTotal,
  loadedAll,
  pathname = '/counsel/inbox',
}: {
  rows: IntakeListRow[];
  /** The list's state, parsed from the query string by the page. */
  params: IntakeListParams;
  /** Every firm member, plus the "me" and "unassigned" pseudo-values. */
  ownerOptions: OwnerOption[];
  /** Every firm member, for the pickers that WRITE an owner. */
  members: MemberOption[];
  meId: string | null;
  /**
   * Every request the firm has, from a separate uncapped count query. Stated
   * only when the bounded read did not reach it, because that is the one case
   * where the figures on this screen describe less than the whole queue.
   */
  firmTotal: number;
  loadedAll: boolean;
  pathname?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const href = (patch: Partial<IntakeListParams>) =>
    intakeListHref(params, patch, pathname);

  const go = (patch: Partial<IntakeListParams>) =>
    router.push(href(patch), { scroll: false });

  // Text filters land in the URL too, but only once typing pauses: a
  // navigation per keystroke would be a history entry per keystroke. Patches
  // accumulate rather than replace, so typing in two boxes inside one window
  // is two filters and one navigation.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queued = useRef<Partial<IntakeListParams>>({});
  const goSoon = (patch: Partial<IntakeListParams>) => {
    queued.current = { ...queued.current, ...patch };
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      const next = queued.current;
      queued.current = {};
      router.replace(href(next), { scroll: false });
    }, 350);
  };

  const views: IntakeListViewKey[] = useMemo(
    () => INTAKE_LIST_VIEW_KEYS.filter((k) => k !== 'mine' || meId),
    [meId],
  );

  // Each tab states the size of the list that tab would render, search and
  // column filters included. Counting the view alone is what left the matters
  // strip claiming twelve over an empty table.
  const { options, matched } = useMemo(() => {
    const counts = intakeViewCounts(rows, params, meId);
    return {
      options: views.map<ViewOption>((key) => ({
        key,
        label: <T>{INTAKE_LIST_VIEW_LABEL[key]}</T>,
        count: counts[key],
      })),
      matched: sortIntakes(filterIntakes(rows, params, meId), params),
    };
  }, [rows, params, meId, views]);

  const page = useMemo(
    () => paginateIntakes(matched, params.page),
    [matched, params.page],
  );

  // Only rows a person can see count as selected. A tick left behind by a
  // filter change cannot be acted on, and is not counted either.
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

  const head = (key: IntakeSortKey, label: JSX.Element) => {
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
          href={href(nextIntakeSort(params, key))}
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
        href={(key) => href({ view: key as IntakeListViewKey })}
        label={t('Request views')}
      />

      <Toolbar
        note={
          page.total === 0 ? (
            <T>No rows</T>
          ) : (
            <>
              <T>Showing</T> {page.from}
              {'–'}
              {page.to} <T>of</T> {page.total}
            </>
          )
        }
      >
        <input
          type="search"
          defaultValue={params.q}
          onChange={(e) => goSoon({ q: e.target.value })}
          placeholder={t('Search subject, reference, requester, owner')}
          aria-label={t('Search requests')}
          className="input h-9 w-full max-w-xs py-1"
        />
        {/* Where the request came from. This is what the two tabs this list
            used to have became: a narrowing of one queue, rather than a split
            that kept half the work on the tab you were not looking at. It sits
            in the toolbar and not in a column header because it scopes the
            whole queue, the way the search box does. */}
        <select
          value={params.source}
          onChange={(e) =>
            go({ source: e.target.value as IntakeListParams['source'] })
          }
          aria-label={t('Filter by source')}
          className="input h-9 w-auto px-2 py-0"
        >
          <option value="">{t('Any source')}</option>
          <option value="inhouse">{t('In-house')}</option>
          <option value="external">{t('External')}</option>
        </select>
        {hasActiveIntakeFilters(params) && (
          <Link
            href={href({
              q: '',
              ref: '',
              subject: '',
              requester: '',
              state: '',
              owner: '',
              source: '',
              priority: '',
            })}
            scroll={false}
            className="btn-ghost h-9 px-3 text-[12.5px]"
          >
            <T>Clear filters</T>
          </Link>
        )}
      </Toolbar>

      {/* The boundary of the read, stated rather than left to be inferred. A
          tally over a page of rows is a floor, and a floor with a tab label
          over it is the defect this repo has shipped four times. */}
      {!loadedAll && (
        <p className="text-[12px] text-muted">
          <T>
            Sorting, filtering and the figures on the tabs cover the requests
            loaded here, which are the most recent
          </T>{' '}
          <span className="tabular-nums">{rows.length}</span>{' '}
          <T>of this organization&rsquo;s</T>{' '}
          <span className="tabular-nums">{firmTotal}</span>.
        </p>
      )}

      {selectedIds.length > 0 && (
        <BulkOwner
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
        {/* Wide content scrolls inside its own container. The page body never
            scrolls sideways. */}
        <div className="overflow-x-auto">
          {/* Nine columns will not fit beside an open rail at 1280, so they scroll
              in this container and the page never does. That pairing is also
              why the two halves of this branch belong together: the queue is
              wide, so the rail now gets out of its way once it is left alone,
              and with the rail hidden the whole table fits at 1280. */}
          <table className="w-full min-w-[61rem] table-fixed border-collapse text-left">
            {/* FIXED LAYOUT, and the widths are the point rather than a
                tidying-up. Left to size itself a table gives every column the
                width of its longest cell, so one long subject and one long
                requester name pushed Status and Owner off the screen entirely:
                the two columns a person triages by were the two you had to
                scroll for. Fixed widths also make `truncate` mean something in
                a cell, which it does not in an auto table. Subject takes
                whatever is left, because it is the column worth the room. */}
            {/* These are rem, and this repo's root font size is 18px, not 16.
                That is the whole reason the table used to scroll 83px at 1280
                however the columns were shuffled: `min-w-[66rem]` is 1188px
                here, not 1056, and it was the binding constraint the entire
                time. Measured, not reasoned about. */}
            <colgroup>
              <col className="w-9" />
              <col className="w-[5rem]" />
              <col className="w-[6.5rem]" />
              <col />
              <col className="w-[10rem]" />
              <col className="w-[11rem]" />
              <col className="w-[8rem]" />
              <col className="w-[3.25rem]" />
              <col className="w-[4.5rem]" />
            </colgroup>
            <thead className="border-b border-edge">
              <tr>
                <th scope="col" className="w-9 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allOnPage}
                    // Some but not all: the box says "there is a selection"
                    // without claiming it covers the page.
                    ref={(el) => {
                      if (el) {
                        el.indeterminate = selectedIds.length > 0 && !allOnPage;
                      }
                    }}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? new Set(page.rows.map((r) => r.id))
                          : new Set(),
                      )
                    }
                    aria-label={t('Select every request on this page')}
                    className="h-3.5 w-3.5 align-middle accent-[var(--accent)]"
                  />
                </th>
                {head('priority', <T>Priority</T>)}
                <th
                  scope="col"
                  className="px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted"
                >
                  <T>Reference</T>
                </th>
                {head('subject', <T>Subject</T>)}
                {head('requester', <T>Requester</T>)}
                {head('state', <T>Status</T>)}
                {head('owner', <T>Owner</T>)}
                {head('age', <T>Age</T>)}
                {head('updated', <T>Updated</T>)}
              </tr>
              <tr className="border-t border-edge bg-surface-2">
                <td className="px-3 py-1.5" />
                <td className="px-3 py-1.5">
                  <select
                    value={params.priority}
                    onChange={(e) => go({ priority: e.target.value })}
                    aria-label={t('Filter by priority')}
                    className="input h-7 w-full min-w-[5rem] px-2 py-0"
                  >
                    <option value="">{t('Any priority')}</option>
                    {INTAKE_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {t(p)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="search"
                    defaultValue={params.ref}
                    onChange={(e) => goSoon({ ref: e.target.value })}
                    placeholder={t('Reference')}
                    aria-label={t('Filter by reference')}
                    className="input h-7 w-full min-w-[6.5rem] px-2 py-0"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="search"
                    defaultValue={params.subject}
                    onChange={(e) => goSoon({ subject: e.target.value })}
                    placeholder={t('Subject, type, folder')}
                    aria-label={t('Filter by subject')}
                    className="input h-7 w-full min-w-[7.5rem] px-2 py-0"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="search"
                    defaultValue={params.requester}
                    onChange={(e) => goSoon({ requester: e.target.value })}
                    placeholder={t('Requester')}
                    aria-label={t('Filter by requester')}
                    className="input h-7 w-full min-w-[6.5rem] px-2 py-0"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <select
                    value={params.state}
                    onChange={(e) => go({ state: e.target.value })}
                    aria-label={t('Filter by status')}
                    className="input h-7 w-full min-w-[8.5rem] px-2 py-0"
                  >
                    <option value="">{t('Any status')}</option>
                    {INTAKE_WORKFLOW_STATES.map((s) => (
                      <option key={s} value={s}>
                        {t(WORKFLOW_LABEL[s])}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-1.5">
                  <select
                    value={params.owner}
                    onChange={(e) => go({ owner: e.target.value })}
                    aria-label={t('Filter by owner')}
                    // Member-name options are user data.
                    data-no-translate
                    className="input h-7 w-full min-w-[7.5rem] px-2 py-0"
                  >
                    {ownerOptions.map((o) => (
                      <option key={o.value || 'all'} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-1.5" />
                <td className="px-3 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-8 text-center text-[13px] text-muted"
                  >
                    <T>No requests match this view and these filters.</T>
                  </td>
                </tr>
              ) : (
                page.rows.map((r) => {
                  const directionLabel = signatureDirectionLabel(
                    r.signatureDirection,
                  );
                  return (
                  <tr
                    key={r.id}
                    className="border-b border-edge last:border-0 transition-colors hover:bg-surface-2"
                  >
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={(e) => toggle(r.id, e.target.checked)}
                        aria-label={t('Select this request')}
                        className="h-3.5 w-3.5 align-middle accent-[var(--accent)]"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex items-center rounded px-2 py-[2px] text-[10.5px] font-semibold ${PRIORITY_TONE[r.priority]}`}
                      >
                        {t(r.priority)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <MonoRef title={r.id} className="block truncate">
                        {r.reference}
                      </MonoRef>
                    </td>
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/counsel/intake/${r.id}`}
                        prefetch={false}
                        className="block min-w-0"
                      >
                        <span
                          className="block truncate text-[13.5px] font-semibold text-foreground"
                          data-no-translate
                        >
                          {r.subject}
                        </span>
                        <span
                          className="block truncate text-[11.5px] text-muted"
                          data-no-translate
                        >
                          {[r.matterType, r.jurisdiction, r.folder]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </Link>
                      {/* Which way a signature runs, when it runs at all. It
                          sits under the subject rather than in a column of its
                          own because most rows have nothing to say here, and a
                          tenth column that is empty on most rows is a column
                          that costs every row its width. Neutral, never the
                          accent: the accent on this screen is the New request
                          button. */}
                      {directionLabel && (
                        <span className="mt-1 flex">
                          <Chip className="max-w-full truncate">
                            <T>{directionLabel}</T>
                          </Chip>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden
                          className="grid h-6 w-6 flex-none place-items-center rounded-full bg-surface-2 text-[10px] font-semibold text-muted ring-1 ring-edge"
                        >
                          {initials(r.requesterName)}
                        </span>
                        <span
                          className="truncate text-[12.5px] text-foreground"
                          data-no-translate
                        >
                          {r.requesterName}
                        </span>
                        {/* Where the reference puts a VIP star, and used the
                            same way: a mark on the requester who is NOT the
                            usual one. This queue belongs to an in-house legal
                            team, so its own people are the norm and a chip on
                            almost every row would be decoration. What is worth
                            seeing at a glance is the request that came from
                            outside. This product has no client tier, so there
                            is no star. */}
                        {!r.inHouse && (
                          <Chip className="shrink-0">
                            <T>External</T>
                          </Chip>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2.5" title={t(WORKFLOW_LABEL[r.state])}>
                      {/* Clipped to its column, with the whole word on the
                          cell's title so nothing is lost. "Awaiting external
                          the longest of the nine and it ran under the Owner
                          cell; a pill that can outgrow its column is a pill
                          that will, the next time a state is named. */}
                      <StatusPill
                        size="sm"
                        color={workflowColor(r.state)}
                        className="max-w-full truncate"
                      >
                        {t(WORKFLOW_LABEL[r.state])}
                      </StatusPill>
                    </td>
                    <td className="px-3 py-2.5 text-[12.5px]">
                      <RowOwner
                        intakeId={r.id}
                        current={r.assignedTo}
                        members={members}
                      />
                    </td>
                    <td
                      className="px-3 py-2.5 text-[12px] tabular-nums text-muted"
                      suppressHydrationWarning
                    >
                      {ageLabel(r.createdAt)}
                    </td>
                    <td
                      className="px-3 py-2.5 text-[12px] text-muted"
                      suppressHydrationWarning
                    >
                      {relativeTime(r.updatedAt) ?? ''}
                    </td>
                  </tr>
                  );
                })
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
 * Links rather than buttons, for the same reason the views are links: page 3
 * of a queue is a place, and the back button should return from it.
 */
function Pager({
  page,
  href,
}: {
  page: IntakePage;
  href: (patch: Partial<IntakeListParams>) => string;
}) {
  const t = useT();
  if (page.total <= INTAKE_PAGE_SIZE) return null;
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
 * The owner cell, which is also the control that sets it.
 *
 * Reverts to the previous value and says why when the write is refused,
 * because a select that snaps back with no explanation is how a person
 * concludes the product is broken. The refusal a firm member will actually
 * meet here is a role that is not on the legal team.
 */
function RowOwner({
  intakeId,
  current,
  members,
}: {
  intakeId: string;
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
      const res = await assignIntakeAction(intakeId, next || null);
      if (res.ok) {
        router.refresh();
      } else {
        setValue(prev);
        setError(res.error ?? t('Could not change the owner.'));
      }
    });
  }

  return (
    <div className="flex flex-col gap-0.5">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.currentTarget.value)}
        aria-label={t('Owner')}
        // Member-name options are user data.
        data-no-translate
        className="input h-7 w-full min-w-[7.5rem] px-2 py-0 disabled:opacity-60"
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
 * The one thing a selection of requests can be used for: giving them an owner.
 *
 * One assignIntakeAction call per request rather than a new bulk endpoint, so
 * each request is gated on its own firm exactly as it is from the record and
 * nothing new is exposed. Sequential, because the set is at most one page. A
 * partial failure is reported as a partial failure: the requests that did move
 * stay moved, and the count that did not is shown rather than swallowed.
 */
function BulkOwner({
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
        const res = await assignIntakeAction(id, value || null);
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
        aria-label={t('Give the selected requests to')}
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
        className="btn-secondary h-8 px-3 text-[12.5px] disabled:opacity-60"
      >
        {pending ? t('Assigning') : t('Assign owner')}
      </button>
      <button
        type="button"
        onClick={onClear}
        className="btn-ghost h-8 px-3 text-[12.5px]"
      >
        <T>Clear selection</T>
      </button>
      {failed != null && (
        // Says which of the two happened. "The rest were assigned" when every
        // one of them failed would be the list reporting work that never
        // landed.
        <p className="text-[11.5px] text-rose-700 dark:text-rose-300">
          {failed.bad}{' '}
          {failed.bad === failed.total
            ? t('could not be assigned.')
            : t('could not be assigned. The rest were.')}
        </p>
      )}
    </div>
  );
}
