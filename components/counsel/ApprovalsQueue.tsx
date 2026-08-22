'use client';

import { useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  DIRECTION_FACET_LABEL,
  QUEUE_DIRECTION_FACETS,
  QUEUE_VIEW_KEYS,
  approvalQueueHref,
  confirmationLines,
  directionFacetCounts,
  type BulkSendBackResult,
  isBulkSelectable,
  queueFraming,
  searchedViewTally,
  selectHistory,
  selectQueue,
  settledTally,
  viewTally,
  type ApprovalQueueParams,
  type ApprovalRow,
  type QueueCounts,
  type QueueDirectionFacet,
  type QueueTally,
  type QueueViewKey,
} from '@/lib/approval-queue';
import { sendBackTemplateSubmissionsAction } from '@/lib/template-submissions';
import {
  SectionLabel,
  Toolbar,
  ViewStrip,
  type ViewOption,
} from '@/components/counsel/patterns';
import { SubmissionList } from '@/components/counsel/SubmissionList';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * The approvals queue: views, search, ordering, and the one bulk action this
 * screen is allowed to have.
 *
 * The whole of the queue's state is the query string, parsed by the page and
 * handed down as `params`, so a narrowed queue is a link a reviewer can send a
 * colleague, the back button steps between views, and a refresh keeps their
 * place. The only state this component owns is the text somebody is mid-way
 * through typing, which rows they have ticked, and the note attached to a
 * send-back, none of which should survive a reload.
 *
 * Searching and ordering happen on the client, over the rows the server sent.
 * THE NUMBERS DO NOT. Every figure stated as a total here comes from `counts`,
 * which the server took as its own uncapped count query per view; this
 * component never filters a list and calls the length a total, because the
 * list is a bounded read and that number would be a floor. viewTally and
 * settledTally are the only route from rows to a stated figure, and they say
 * when the list under a heading is shorter than the heading's number. See
 * QueueTally in lib/approval-queue.ts for the failure this replaces.
 *
 * THE ONE BULK ACTION IS SEND BACK, AND THERE IS NO BULK APPROVE. Approving
 * here releases a finished document to a named party outside the company, so a
 * bulk approve would be a bulk send to third parties taken from a list that
 * does not show the documents. Sending back releases nothing: it returns each
 * one to the colleague who wrote it. The reasoning in full, and the guards
 * that make it hold on the server, are on sendBackTemplateSubmissionsAction in
 * lib/template-submissions.ts.
 */

const VIEW_LABEL: Record<QueueViewKey, JSX.Element> = {
  waiting: <T>Awaiting decision</T>,
  aging: <T>Waiting over 3 days</T>,
  failed: <T>Delivery failed</T>,
  open: <T>Everything open</T>,
};

export function ApprovalsQueue({
  rows,
  counts,
  params,
  canApprove,
  middle,
}: {
  /**
   * The submissions the server sent, narrowed to what a row shows. A BOUNDED
   * page of the firm's records, never all of them, so nothing on this screen
   * may state its length as a total.
   */
  rows: ApprovalRow[];
  /**
   * How many records are really in each view. Null when the counts could not
   * be read, which falls back to what is on the page.
   */
  counts: QueueCounts | null;
  params: ApprovalQueueParams;
  /**
   * The section that sits between the queue and the history, rendered
   * verbatim. It is a prop rather than something this component builds
   * because what goes there is a server-rendered card with the firm's own
   * templates and people in it, and this component owns nothing but the
   * queue's own state.
   */
  middle?: ReactNode;
  /**
   * Whether this reviewer's firm role may decide on a document. False hides
   * the checkboxes and the bulk bar; the server refuses every row for such a
   * caller regardless, which is where the rule actually lives.
   */
  canApprove: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const href = (patch: Partial<ApprovalQueueParams>) => approvalQueueHref(params, patch);

  // Typing lands in the URL only once it pauses: a navigation per keystroke is
  // a history entry per keystroke. The input keeps its own value meanwhile so
  // it never lags behind the person using it.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const search = (q: string) => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      router.replace(href({ q }), { scroll: false });
    }, 350);
  };

  // Every count on this screen and the list it labels are one call, on one
  // clock, AND every count is the view's real size rather than the size of
  // this page. Both halves are load-bearing: see searchedViewTally for the two
  // defects that met here.
  const { options, queue, active, settled, facets } = useMemo(() => {
    const now = Date.now();
    return {
      options: QUEUE_VIEW_KEYS.map<ViewOption>((key) => ({
        key,
        label: VIEW_LABEL[key],
        count: searchedViewTally(key, rows, params, counts, now).total,
      })),
      queue: selectQueue(rows, params, now),
      active: searchedViewTally(params.view, rows, params, counts, now),
      settled: settledTally(rows, counts, params.dir),
      // The facet counts come from selectQueue too, on the same clock, so a
      // facet that says 3 cannot sit over a card holding 2. Built here rather
      // than in the strip for the reason every other count on this screen is.
      facets: directionFacetCounts(rows, params, now),
    };
  }, [rows, params, counts]);

  const history = useMemo(() => selectHistory(rows, params), [rows, params]);

  const ticked = queue.filter((r) => selected.has(r.id) && isBulkSelectable(r));

  const toggle = (id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectableOnScreen = queue.filter(isBulkSelectable);
  const allTicked = selectableOnScreen.length > 0 && ticked.length === selectableOnScreen.length;

  return (
    <div className="space-y-3">
      <ViewStrip
        options={options}
        active={params.view}
        href={(key) => href({ view: key as QueueViewKey })}
        label={t('Queue views')}
      />

      {/* THE DIRECTION FACET. One queue, two framings.
          Two things wait on the same decision by the same people: a form a
          colleague filled in for somebody outside, which nothing sends until
          it is approved, and a document somebody outside sent us, which
          nothing signs until it is authorised. They are one job, so they are
          one list, and this narrows it rather than opening a second screen.
          'Everything' is the default because the job is the queue and not
          half of it. */}
      <ViewStrip
        options={QUEUE_DIRECTION_FACETS.map<ViewOption>((key) => ({
          key,
          label: <T>{DIRECTION_FACET_LABEL[key]}</T>,
          count: facets[key],
        }))}
        active={params.dir}
        href={(key) => href({ dir: key as QueueDirectionFacet })}
        label={t('Which way the signature runs')}
      />

      {/* No note on the toolbar. The active tab above already states this
          view's label and its size, and the two came from the same call, so a
          second copy of the number here was one more thing to read and one
          more thing that could drift. */}
      <Toolbar>
        <input
          type="search"
          defaultValue={params.q}
          onChange={(e) => search(e.target.value)}
          placeholder={t('Search reference, form, colleague, recipient')}
          aria-label={t('Search this queue')}
          className="input h-9 w-full max-w-xs py-1"
        />
        <select
          value={params.sort}
          onChange={(e) => router.push(href({ sort: e.target.value === 'newest' ? 'newest' : 'oldest' }), { scroll: false })}
          aria-label={t('Order')}
          className="input h-9 w-auto px-2 py-0"
        >
          <option value="oldest">{t('Waiting longest first')}</option>
          <option value="newest">{t('Newest first')}</option>
        </select>
        {canApprove && selectableOnScreen.length > 0 && (
          <button
            type="button"
            onClick={() =>
              setSelected(allTicked ? new Set() : new Set(selectableOnScreen.map((r) => r.id)))
            }
            className="btn-ghost h-9 px-3 text-[12.5px]"
          >
            {allTicked ? <T>Clear selection</T> : <T>Select all waiting</T>}
          </button>
        )}
        {params.q && (
          <Link href={href({ q: '' })} scroll={false} className="btn-ghost h-9 px-3 text-[12.5px]">
            <T>Clear search</T>
          </Link>
        )}
      </Toolbar>

      {canApprove && ticked.length > 0 && (
        <BulkSendBack
          rows={ticked}
          onDone={() => {
            setSelected(new Set());
            router.refresh();
          }}
          onClear={() => setSelected(new Set())}
        />
      )}

      {/* The queue itself, with no heading over it. The selected tab is the
          heading: it names the view and states its size, and this card is
          what that tab selected. A label repeating both directly underneath
          was the same sentence twice. */}
      <section className="space-y-2">
        {/* The count lives in the label because it is the thing a reviewer
            came to find out. It is the size of the view in the database, so
            it does not shrink to whatever the page happened to fetch, and
            BoundedNote below says plainly when the list is showing less than
            it. A heading that states a number over a list that quietly holds
            fewer is the whole defect this replaced. */}
        <SectionLabel>
          {VIEW_LABEL[params.view]}
          {' · '}
          <span data-no-translate>{active.total}</span>
        </SectionLabel>
        <BoundedNote tally={active} />
        <div className="card overflow-hidden">
          {queue.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-muted">
              {params.q ? (
                <T>Nothing matches that search.</T>
              ) : params.view === 'waiting' ? (
                <T>Nothing waiting on you.</T>
              ) : (
                <T>Nothing in this view.</T>
              )}
            </p>
          ) : (
            <SubmissionList
              items={queue}
              stamp="filed"
              selected={selected}
              onSelect={canApprove ? toggle : undefined}
              selectLabel={t('Select this document')}
            />
          )}
        </div>
      </section>

      {middle}

      <section className="space-y-2 pt-3">
        <SectionLabel>
          <T>Decision history</T>
          {' · '}
          <span data-no-translate>{settled.total}</span>
        </SectionLabel>
        <BoundedNote tally={settled} />
        <div className="card overflow-hidden">
          {history.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-muted">
              {params.q ? <T>Nothing matches that search.</T> : <T>No decisions yet.</T>}
            </p>
          ) : (
            <SubmissionList items={history} stamp="decided" />
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * The one line that keeps a bounded list from reading as a complete one.
 *
 * A reviewer looking at a heading that says 431 over a list of 200 rows has to
 * be told which 200, and told it without having to count them. Rendering
 * nothing at all when the list IS complete matters just as much: a permanent
 * caveat under every queue is read once and then never again, and this needs
 * to be noticed on the day it appears.
 *
 * The wording says "most recent" because that is the order the server read
 * them in, submitted_at descending, on both of its row queries.
 */
function BoundedNote({ tally }: { tally: QueueTally }) {
  if (!tally.bounded) return null;
  return (
    <p className="text-[12px] leading-relaxed text-muted">
      <T>Showing the</T> <span data-no-translate>{tally.loaded}</span>{' '}
      <T>most recent of</T> <span data-no-translate>{tally.total}</span>.{' '}
      <T>
        Older ones are counted above but are not on this page. Search finds
        only what is listed here.
      </T>
    </p>
  );
}

/**
 * Send the ticked documents back to the colleagues who filed them.
 *
 * Two steps on purpose. The first collects the note, which every send-back
 * requires. The second NAMES EVERY DOCUMENT AND EVERY OUTSIDE RECIPIENT the
 * selection covers, one line each, rather than saying "6 selected": a reviewer
 * about to act on a set of agreements has to be able to see the set, and a
 * count is the one thing that cannot be checked against what they meant to
 * tick.
 *
 * The outcome is reported per document. A run where four moved and two did not
 * says which two and why, because a single "done" over a partial failure is a
 * list telling somebody work landed that did not.
 */
function BulkSendBack({
  rows,
  onDone,
  onClear,
}: {
  rows: ApprovalRow[];
  onDone: () => void;
  onClear: () => void;
}) {
  const t = useT();
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BulkSendBackResult[] | null>(null);

  const run = () => {
    setError(null);
    startTransition(async () => {
      const res = await sendBackTemplateSubmissionsAction(
        rows.map((r) => r.id),
        note,
      );
      if (!res.ok || !res.results) {
        setError(res.error ?? t('Could not send those back.'));
        return;
      }
      const failed = res.results.filter((r) => !r.ok);
      setConfirming(false);
      if (failed.length === 0) {
        onDone();
        return;
      }
      // Some of them moved. The list has to be reloaded so the rows that did
      // are gone from it, and the ones that did not are named below.
      setResults(res.results);
    });
  };

  if (results) {
    const failed = results.filter((r) => !r.ok);
    return (
      <div className="space-y-2 rounded-xl border border-edge bg-surface p-3">
        <p className="text-[12.5px] text-foreground">
          {results.length - failed.length} <T>sent back.</T> {failed.length}{' '}
          <T>could not be, and are still waiting:</T>
        </p>
        <ul className="space-y-1">
          {failed.map((r) => (
            <li key={r.id} className="text-[12px] text-rose-700 dark:text-rose-300">
              <span className="font-mono" data-no-translate>
                {r.ref}
              </span>
              {' · '}
              <span data-no-translate>{r.error}</span>
            </li>
          ))}
        </ul>
        <button type="button" onClick={onDone} className="btn-secondary h-8 px-3 text-[12.5px]">
          <T>Reload the queue</T>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-edge bg-surface p-3">
      <p className="text-[12.5px] tabular-nums text-foreground">
        {rows.length} <T>selected</T>
      </p>

      {confirming ? (
        <>
          <p className="text-[12.5px] text-muted">
            <T>
              These go back to the colleagues who filled them in, with your note.
              Nothing is sent to any of the recipients below.
            </T>
          </p>
          {/* One line per document, from confirmationLines, which is the
              tested rule that every selected row and every recipient is
              named. Never a count. */}
          <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-edge bg-surface-2 p-2">
            {confirmationLines(rows).map((line, i) => (
              <li
                key={rows[i].id}
                className="font-mono text-[11.5px] text-muted"
                data-no-translate
              >
                {line}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={run}
              className="btn-primary h-8 px-3 text-[12.5px] disabled:opacity-60"
            >
              {pending ? t('Sending back') : t('Send these back')}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(false)}
              className="btn-ghost h-8 px-3 text-[12.5px]"
            >
              <T>Go back</T>
            </button>
          </div>
        </>
      ) : (
        <>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('What every one of these needs changed')}
            aria-label={t('Note for your colleagues')}
            className="input w-full py-2"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!note.trim()}
              onClick={() => setConfirming(true)}
              className="btn-secondary h-8 px-3 text-[12.5px] disabled:opacity-60"
            >
              <T>Send back with this note</T>
            </button>
            <button type="button" onClick={onClear} className="btn-ghost h-8 px-3 text-[12.5px]">
              <T>Clear selection</T>
            </button>
          </div>
          <p className="text-[12px] text-muted">
            <T>
              A note is required, so each colleague knows what to change. Approving is
              one document at a time, on the document.
            </T>
          </p>
        </>
      )}

      {error && <p className="text-[12px] text-rose-700 dark:text-rose-300">{error}</p>}
    </div>
  );
}
