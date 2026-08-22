import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  AGING_DAYS,
  QUEUE_VIEW_KEYS,
  SETTLED_STATUSES,
  UNSETTLED_STATUSES,
  parseApprovalQueueParams,
  queueFilterTest,
  queueViewFilter,
  queueViewTest,
  searchedViewTally,
  selectHistory,
  selectQueue,
  settledTally,
  viewTally,
  type ApprovalRow,
  type QueueCounts,
  type QueueViewKey,
} from '../lib/approval-queue';
import {
  buildCounselMetricBands,
  type CounselMetric,
  type CounselMetricInput,
} from '../lib/counsel-metrics';
import {
  ALL_SUBMISSION_STATUSES,
  isTerminal,
  type SubmissionStatus,
} from '../lib/template-submission-types';

/**
 * The approvals queue states four view figures and a history figure, and every
 * one of them is a COUNT of a set.
 *
 * Until this test existed they were all taken from `rows`, which is what
 * `listFirmTemplateSubmissionsAction` returned: the 200 most recent
 * submissions of EVERY status. So a firm past its 200th document read a FLOOR
 * under a total's label on the one screen whose job is to say what the legal
 * team owes, and pending submissions older than the cap appeared in no view
 * and were announced nowhere. The dashboard's "Awaiting approval" tile counts
 * the same set exactly, in the database, and links straight here, so the tile
 * could legitimately read a larger number than the page it opened.
 *
 * app/counsel/billing/page.tsx had already been fixed this way: it draws
 * Outstanding from its own uncapped query and tells the reader the invoice
 * table under it is the 100 most recent.
 *
 * FOUR THINGS ARE HELD HERE, because any one alone passes while the number on
 * the page is still wrong:
 *
 *   1. The queries behind the figures are exact counts with no `.limit()`, and
 *      the queries behind the LISTS are the only ones that carry a cap.
 *   2. The set a count query selects is the set the rendered predicate selects,
 *      for every status the schema allows and for ones it does not.
 *   3. The component reaches a stated figure only through viewTally /
 *      settledTally, so it cannot go back to measuring a list.
 *   4. A bounded list SAYS it is bounded, rather than presenting its own length
 *      as the answer.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p: string) => readFileSync(`${root}${p}`, 'utf8');

const action = read('lib/template-submissions.ts');
const queueComponent = read('components/counsel/ApprovalsQueue.tsx');
const page = read('app/counsel/forms/approvals/page.tsx');

/* ------------------------------------------------------------------ */
/* 1. Totals come from count queries; only the lists are capped.       */
/* ------------------------------------------------------------------ */

/**
 * The body of a named top-level function in the action module.
 *
 * lib/template-submissions.ts writes to `firm_template_submissions` from a
 * dozen places, so splitting the whole file on the table name the way
 * tests/dashboard-counts-are-counts.test.ts does would sweep up every
 * compare-and-swap in the approval path. The two functions that READ the queue
 * are the subject, so they are extracted by name and a missing one is a
 * failure rather than an empty sweep.
 */
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  expect(start, `${name} is gone from lib/template-submissions.ts`).toBeGreaterThan(-1);
  // Top-level functions in this file close on a `}` in the first column.
  const end = src.indexOf('\n}\n', start);
  expect(end, `${name} does not close at the top level`).toBeGreaterThan(start);
  return src.slice(start, end);
}

/** Each `.from('firm_template_submissions')` in `src` and the chain hung off it. */
function queries(src: string): string[] {
  return src
    .split("from('firm_template_submissions')")
    .slice(1)
    // A chain ends at the first blank line after it; a fixed window would run
    // one query's text into the next one's.
    .map((part) => part.split(/\n\s*\n/)[0]);
}

describe('the approvals queue counts in the database, not in a page of rows', () => {
  const counter = functionBody(action, 'countInView');
  const lister = functionBody(action, 'listFirmTemplateSubmissionsAction');

  it('finds both reads at all, so an empty sweep cannot pass', () => {
    // One query site for every figure (the counter, run per view and once for
    // the history), and two for the rows: open work and settled work, read
    // separately so they do not compete for the same slots.
    expect(queries(counter)).toHaveLength(1);
    expect(queries(lister)).toHaveLength(2);
  });

  it('asks the database for every figure it states as a total', () => {
    const q = queries(counter)[0];
    expect(q, `a queue total without an exact count: ${q}`).toContain("count: 'exact'");
    expect(q).toContain('head: true');
    expect(q, `a queue total behind a row cap: ${q}`).not.toContain('.limit(');
  });

  it('caps the two reads that are lists rather than totals', () => {
    const rowReads = queries(lister);
    for (const q of rowReads) {
      expect(q, `an unbounded row read would serialize a firm's whole history: ${q}`)
        .toContain('.limit(');
      // A list read is not allowed to double as a figure.
      expect(q, `a row read carrying a count: ${q}`).not.toContain("count: 'exact'");
    }
    expect(rowReads.some((q) => q.includes('OPEN_ROW_LIMIT'))).toBe(true);
    expect(rowReads.some((q) => q.includes('SETTLED_ROW_LIMIT'))).toBe(true);
  });

  it('separates open work from settled work so they do not share a cap', () => {
    // The defect: ONE capped read across every status, oldest-pending-first
    // out of the window as a firm's history grows. The open read must exclude
    // the settled statuses and the settled read must be confined to them.
    const rowReads = queries(lister);
    expect(rowReads.some((q) => q.includes("not('status', 'in'"))).toBe(true);
    expect(rowReads.some((q) => q.includes("in('status', SETTLED_STATUSES)"))).toBe(true);
    // Both derived from isTerminal, never a second hand-written status list.
    expect(action).toContain('SETTLED_STATUSES');
  });

  it('draws every stated figure through that one counter', () => {
    expect(lister).toContain('countInView(admin, firmId, queueViewFilter(view, now))');
    expect(lister).toContain('countInView(admin, firmId, { statuses: SETTLED_STATUSES })');
    // Every view, not a hand-picked subset of them.
    expect(lister).toContain('QUEUE_VIEW_KEYS.map');
  });

  it('reports a count that did not come back as unknown rather than zero', () => {
    // Reporting a failed count as 0 tells a legal team nothing is waiting.
    expect(lister).toContain('?? null');
    expect(lister).not.toContain('?? 0');
  });

  it('hands the counts to the queue instead of letting it measure the rows', () => {
    expect(page).toContain('counts={res.counts ?? null}');
  });
});

/* ------------------------------------------------------------------ */
/* 2. A count query selects the set the rendered predicate selects.    */
/* ------------------------------------------------------------------ */

/**
 * The filter evaluated the way the count query sends it, so the assertion is
 * about which rows each view returns rather than about how it is spelled.
 *
 * This mirrors `countInView` clause for clause. If the two ever disagree the
 * source assertions below go red, because they pin the query text this
 * function is written against.
 */
function selectedByQuery(view: QueueViewKey, r: ApprovalRow, now: number): boolean {
  const f = queueViewFilter(view, now);
  // .in('status', f.statuses) / .not('status','in','(...)')
  const named = f.statuses.includes(r.status);
  if (f.exclude ? named : !named) return false;
  // .lte('submitted_at', f.filedAtOrBefore)
  if (f.filedAtOrBefore) {
    const at = Date.parse(r.submittedAt);
    if (Number.isNaN(at) || at > Date.parse(f.filedAtOrBefore)) return false;
  }
  // .not('release_error','is',null).neq('release_error','')
  if (f.failedDelivery && (r.releaseError === null || r.releaseError === '')) return false;
  return true;
}

const NOW = Date.parse('2026-08-10T12:00:00.000Z');
const DAY = 86_400_000;

function row(over: Partial<ApprovalRow> & { id: string }): ApprovalRow {
  return {
    ticketNumber: null,
    templateName: 'Mutual NDA',
    category: null,
    submitterName: 'A colleague',
    submitterEmail: 'colleague@firm.test',
    recipientName: null,
    recipientEmail: 'other.side@example.test',
    status: 'pending',
    revision: 1,
    submittedAt: new Date(NOW - DAY).toISOString(),
    decidedAt: null,
    releaseError: null,
    direction: 'outbound',
    href: '/counsel/forms/approvals/sub-1',
    ...over,
  };
}

/**
 * One row per case that separates one view from another, plus the cases the
 * schema permits and the code has never seen.
 */
const FIXTURE: ApprovalRow[] = [
  row({ id: 'fresh-pending' }),
  row({ id: 'aged-pending', submittedAt: new Date(NOW - (AGING_DAYS + 1) * DAY).toISOString() }),
  // Exactly on the boundary: three days is "waiting over three days".
  row({ id: 'boundary-pending', submittedAt: new Date(NOW - AGING_DAYS * DAY).toISOString() }),
  row({ id: 'returned', status: 'changes_requested' }),
  row({ id: 'approved-clean', status: 'approved' }),
  row({ id: 'approved-failed', status: 'approved', releaseError: 'The email bounced.' }),
  // An empty error is not an error. The row predicate has always read it that
  // way, so the query has to as well or the count exceeds the list by one.
  row({ id: 'approved-empty-error', status: 'approved', releaseError: '' }),
  row({ id: 'delivered', status: 'sent' }),
  row({ id: 'pulled-back', status: 'withdrawn' }),
  row({ id: 'refused', status: 'declined' }),
  // A date that will not parse, and an old one that will.
  row({ id: 'undated', submittedAt: 'not a date' }),
];

describe('the set a count query selects is the set the list renders', () => {
  it('agrees with the row predicate on every fixture, in every view', () => {
    for (const view of QUEUE_VIEW_KEYS) {
      const test = queueViewTest(view, NOW);
      for (const r of FIXTURE) {
        expect(
          selectedByQuery(view, r, NOW),
          `${view} disagrees about ${r.id}: the count and the list would differ`,
        ).toBe(test(r));
      }
    }
  });

  it('agrees on every status the schema allows', () => {
    expect(ALL_SUBMISSION_STATUSES.length).toBe(6);
    for (const status of ALL_SUBMISSION_STATUSES) {
      const r = row({ id: `s-${status}`, status, releaseError: 'bounced' });
      for (const view of QUEUE_VIEW_KEYS) {
        expect(selectedByQuery(view, r, NOW), `${view}/${status}`).toBe(
          queueViewTest(view, NOW)(r),
        );
      }
    }
  });

  it('puts a status nobody has heard of in front of a person', () => {
    // A seventh status added to the CHECK constraint ahead of the code, or a
    // row written straight to the database. "Everything open" is the
    // complement of the finished statuses precisely so such a row appears in a
    // view instead of in none, and the count query uses the same complement.
    const alien = row({ id: 'alien', status: 'awaiting_partner' as SubmissionStatus });
    expect(queueViewTest('open', NOW)(alien)).toBe(true);
    expect(selectedByQuery('open', alien, NOW)).toBe(true);
    // And it is NOT in the settled read, so it still reaches the page.
    expect(SETTLED_STATUSES).not.toContain('awaiting_partner');
  });

  it('splits the statuses between the two row reads with nothing lost', () => {
    // The two reads are a partition of the vocabulary. A status in neither
    // would be counted by a view and never fetched for it.
    expect([...SETTLED_STATUSES, ...UNSETTLED_STATUSES].sort()).toEqual(
      [...ALL_SUBMISSION_STATUSES].sort(),
    );
    for (const s of SETTLED_STATUSES) expect(isTerminal(s)).toBe(true);
    for (const s of UNSETTLED_STATUSES) expect(isTerminal(s)).toBe(false);
  });

  it('pins the query text the mirror above is written against', () => {
    const counter = functionBody(action, 'countInView');
    expect(counter).toContain("q.not('status', 'in', `(${filter.statuses.join(',')})`)");
    expect(counter).toContain("q.in('status', filter.statuses)");
    expect(counter).toContain("q.lte('submitted_at', filter.filedAtOrBefore)");
    expect(counter).toContain("q.not('release_error', 'is', null).neq('release_error', '')");
  });

  it('takes one clock for the aging cut-off and the aging rows', () => {
    // Two Date.now() calls either side of a three-day boundary would count a
    // document the list then does not show.
    const lister = functionBody(action, 'listFirmTemplateSubmissionsAction');
    expect(lister).toContain('const now = Date.now();');
    expect(lister).toContain('queueViewFilter(view, now)');
  });
});

/* ------------------------------------------------------------------ */
/* 3. The component cannot go back to measuring its own list.          */
/* ------------------------------------------------------------------ */

describe('the queue reaches a stated figure only through the tally helpers', () => {
  it('never filters rows and calls the length a total', () => {
    // The exact shape this replaced, and the shape any regression would take.
    expect(queueComponent).not.toContain('rows.filter(queueViewTest(');
    expect(queueComponent).not.toContain('queueViewTest');
    // A section heading may not state the length of the array under it.
    expect(queueComponent).not.toContain('{queue.length}</span>');
    expect(queueComponent).not.toContain('{history.length}</span>');
  });

  it('states each view figure and the history figure from a tally', () => {
    expect(queueComponent).toContain(
      'searchedViewTally(key, rows, params, counts, now).total',
    );
    expect(queueComponent).toContain(
      'searchedViewTally(params.view, rows, params, counts, now)',
    );
    // The facet is passed because the server's settled count is over the
    // outbound table only, so once a reviewer narrows the direction that
    // count is describing a different set. settledTally is still the only way
    // this component reaches the figure, which is what this case is for.
    expect(queueComponent).toContain('settledTally(rows, counts, params.dir)');
    expect(queueComponent).toContain('{active.total}');
    expect(queueComponent).toContain('{settled.total}');
  });

  it('goes through the SEARCH-AWARE tally, not the bare one', () => {
    // The regression this exists for. viewTally states the view's size in the
    // database and knows nothing about the search box, so a component calling
    // it directly puts a number beside a tab that disagrees with the card
    // underneath the moment a reviewer types. That is the "3 items waiting"
    // over an empty card reported from the live app. searchedViewTally is the
    // only correct caller of viewTally.
    expect(queueComponent).not.toMatch(/[^d]viewTally\(/);
  });

  it('renders the bounded notice against both lists', () => {
    expect(queueComponent).toContain('<BoundedNote tally={active} />');
    expect(queueComponent).toContain('<BoundedNote tally={settled} />');
  });
});

/* ------------------------------------------------------------------ */
/* 4. The tally itself: the number is the count, and it says when the  */
/*    list is short of it.                                             */
/* ------------------------------------------------------------------ */

function counts(over: Partial<QueueCounts> = {}): QueueCounts {
  return { waiting: null, aging: null, failed: null, open: null, settled: null, ...over };
}

describe('a view states its count and admits when the list is a page of it', () => {
  /** More pending documents than one read returns, all of them waiting. */
  const CAP = 200;
  const loaded = Array.from({ length: CAP }, (_, i) =>
    row({ id: `p${i}`, submittedAt: new Date(NOW - i * 1000).toISOString() }),
  );

  it('states the firm figure, not the number of rows it was handed', () => {
    const t = viewTally('waiting', loaded, counts({ waiting: 431 }), NOW);
    expect(t.total).toBe(431);
    expect(t.loaded).toBe(CAP);
    expect(t.bounded).toBe(true);
    // The failure in one line: the page must not answer 200 when 431 are
    // waiting, because the dashboard tile that links here answers 431.
    expect(t.total).not.toBe(CAP);
  });

  it('says nothing when the list really is the whole of the view', () => {
    const t = viewTally('waiting', loaded, counts({ waiting: CAP }), NOW);
    expect(t.bounded).toBe(false);
    expect(t.total).toBe(CAP);
  });

  it('falls back to the rows when the count did not come back', () => {
    // Short, but never invented, and never claimed to be complete either.
    const t = viewTally('waiting', loaded, counts(), NOW);
    expect(t.total).toBe(CAP);
    expect(t.bounded).toBe(false);
    expect(viewTally('waiting', loaded, null, NOW).total).toBe(CAP);
  });

  it('never states a number smaller than the rows on the page', () => {
    // The count and the rows are separate round trips and a colleague can
    // decide something in between, so a count below the list is possible and
    // honest. Reporting it would put a heading of 3 over a list of 200.
    const t = viewTally('waiting', loaded, counts({ waiting: 3 }), NOW);
    expect(t.total).toBe(CAP);
    expect(t.bounded).toBe(false);
  });

  it('tallies each view against its own count and no other', () => {
    const c = counts({ waiting: 40, aging: 12, failed: 2, open: 55, settled: 900 });
    for (const view of QUEUE_VIEW_KEYS) {
      expect(viewTally(view, FIXTURE, c, NOW).total).toBe(c[view]);
    }
    expect(settledTally(FIXTURE, c).total).toBe(900);
  });

  it('keeps the history figure off the history list, which is capped too', () => {
    const settledRows = Array.from({ length: 100 }, (_, i) =>
      row({ id: `s${i}`, status: 'sent' }),
    );
    const t = settledTally(settledRows, counts({ settled: 2_412 }));
    expect(t.total).toBe(2_412);
    expect(t.loaded).toBe(100);
    expect(t.bounded).toBe(true);
  });

  it('leaves the rendered lists exactly as bounded as they were', () => {
    // The tally changes what is STATED, never what is shown: the rows on the
    // page are still the rows the server sent.
    const c = counts({ waiting: 431, settled: 2_412 });
    const params = { view: 'waiting' as const, q: '', sort: 'oldest' as const, dir: 'all' as const };
    expect(selectQueue(loaded, params, NOW)).toHaveLength(CAP);
    expect(viewTally('waiting', loaded, c, NOW).total).toBe(431);
    expect(selectHistory(FIXTURE, params)).toHaveLength(
      FIXTURE.filter((r) => isTerminal(r.status)).length,
    );
  });
});

/* ------------------------------------------------------------------ */
/* 5. The tile the page opens from is untouched and still agrees.      */
/* ------------------------------------------------------------------ */

/** The dashboard board's metrics, over a shape that exercises every band. */
function allCounselMetrics(): CounselMetric[] {
  const input: CounselMetricInput = {
    matters: [],
    meId: 'user-me',
    approvals: { waiting: 431, aging: 12 },
    signing: { out: 0, attention: 0 },
    documents: { overdue: 0, unfiled: 0 },
    people: { invitationsPending: 0, clientsInvited: 0 },
    money: { outstandingCents: 0, unbilledCents: 0 },
    now: NOW,
  };
  return buildCounselMetricBands(input).flatMap((b) => b.metrics);
}

describe('the dashboard tile and this page count the same set', () => {
  const dashboard = read('app/counsel/page.tsx');

  it('leaves the tile counting pending in the database', () => {
    // The tile's number was always right. This test exists so a later change
    // to the queue cannot be made by weakening the tile instead.
    const tileQueries = queries(dashboard);
    expect(tileQueries).toHaveLength(2);
    for (const q of tileQueries) {
      expect(q).toContain("count: 'exact'");
      expect(q).toContain('head: true');
      expect(q).not.toContain('.limit(');
    }
  });

  it('opens the queue at a view the queue actually keeps', () => {
    // A misspelled view degrades to the default rather than erroring, so the
    // tile would keep its own number and open something else.
    const spec = allCounselMetrics().find((m) => m.id === 'approvals-waiting');
    expect(spec, 'the approvals tile is gone from the dashboard board').toBeDefined();
    const url = new URL(spec!.href, 'https://a.test');
    expect(url.pathname).toBe('/counsel/forms/approvals');
    const parsed = parseApprovalQueueParams(
      Object.fromEntries(new URLSearchParams(url.search).entries()),
    );
    expect(parsed.view).toBe('waiting');
  });

  it('counts the tile set with the queue own waiting filter', () => {
    // The tile spells `.eq('status','pending')` and `.lte('submitted_at', ...)`
    // directly. Those are the waiting and aging views, so the definitions here
    // have to keep matching them.
    expect(queueViewFilter('waiting').statuses).toEqual(['pending']);
    expect(queueViewFilter('waiting').exclude).toBeUndefined();
    const aging = queueViewFilter('aging', NOW);
    expect(aging.statuses).toEqual(['pending']);
    expect(aging.filedAtOrBefore).toBe(new Date(NOW - AGING_DAYS * DAY).toISOString());
    expect(dashboard).toContain("AGING_DAYS * 24 * 60 * 60 * 1000");
    expect(dashboard).toContain(".lte('submitted_at', agingBefore)");
  });

  it('reads a pending row into the same view on both surfaces', () => {
    const waiting = FIXTURE.filter(queueFilterTest(queueViewFilter('waiting', NOW)));
    // Every pending row, whatever its age, exactly as `.eq('status','pending')`
    // on the tile counts them.
    expect(waiting.map((r) => r.id).sort()).toEqual(
      FIXTURE.filter((r) => r.status === 'pending')
        .map((r) => r.id)
        .sort(),
    );
  });
});


/* ------------------------------------------------------------------ */

describe('the tally beside a tab agrees with the list under it', () => {
  /**
   * The fifth thing, added when the uncapped-count fix met the phantom-count
   * fix in a merge and each would have undone the other.
   *
   * viewTally answers "how big is this view in the database", which is what
   * stops a heading reporting the size of its own page. It knows nothing about
   * the search box. A component that called it directly put "3 items waiting"
   * beside a tab whose card was empty, because the reviewer had typed and the
   * card obeyed the search while the tab did not. That was reported from the
   * live app.
   *
   * searchedViewTally is the union: the database count while nobody is
   * searching, the list's own length the moment somebody is, and `bounded`
   * telling the truth either way.
   *
   * Behavioural, driving the real helper against real rows. No source text.
   */
  const NOW_MS = Date.UTC(2026, 7, 15, 12, 0, 0);
  const day = 24 * 60 * 60 * 1000;

  function pending(id: string, title: string, ageDays: number): ApprovalRow {
    return {
      id,
      ref: id.toUpperCase(),
      title,
      status: 'submitted',
      submittedAt: new Date(NOW_MS - ageDays * day).toISOString(),
      decidedAt: null,
    } as unknown as ApprovalRow;
  }

  const rows: ApprovalRow[] = [
    pending('r1', 'Vendor NDA', 1),
    pending('r2', 'Vendor MSA', 1),
    pending('r3', 'Office lease', 1),
  ];

  /** The firm has 40 in this view; the page was handed 3 of them. */
  const counts = Object.fromEntries(
    QUEUE_VIEW_KEYS.map((k) => [k, 40]),
  ) as QueueCounts;
  counts.settled = 0;

  const view: QueueViewKey = QUEUE_VIEW_KEYS[0];

  it('states the database total while nobody is searching', () => {
    const params = parseApprovalQueueParams({ view });
    const t = searchedViewTally(view, rows, params, counts, NOW_MS);
    expect(t.total).toBe(40);
    expect(t.bounded).toBe(true);
  });

  it('states the list it is labelling the moment somebody searches', () => {
    const params = parseApprovalQueueParams({ view, q: 'vendor' });
    const t = searchedViewTally(view, rows, params, counts, NOW_MS);
    const listed = selectQueue(rows, params, NOW_MS).length;
    // The defect in one line: the tab must not say 40 over a card showing 2.
    expect(t.total).toBe(listed);
    expect(t.total).not.toBe(40);
  });

  it('a search that matches nothing states zero, not the database total', () => {
    const params = parseApprovalQueueParams({ view, q: 'zzzz-no-such-thing' });
    const t = searchedViewTally(view, rows, params, counts, NOW_MS);
    expect(t.total).toBe(0);
    expect(selectQueue(rows, params, NOW_MS)).toHaveLength(0);
  });

  it('still admits the page was capped while searching', () => {
    // "No results" and "no results in what we loaded" are different sentences,
    // and only one of them is true here.
    const params = parseApprovalQueueParams({ view, q: 'zzzz-no-such-thing' });
    expect(searchedViewTally(view, rows, params, counts, NOW_MS).bounded).toBe(true);
  });

  it('does not claim bounded when the page holds the whole view', () => {
    // The count is what the view actually holds ON THIS PAGE, not rows.length:
    // not every fixture row falls into every view, and a count taken over the
    // wrong set would make this assert the opposite of what it says.
    const inView = rows.filter(queueViewTest(view, NOW_MS)).length;
    const whole = Object.fromEntries(
      QUEUE_VIEW_KEYS.map((k) => [k, inView]),
    ) as QueueCounts;
    whole.settled = 0;
    const params = parseApprovalQueueParams({ view, q: 'vendor' });
    expect(searchedViewTally(view, rows, params, whole, NOW_MS).bounded).toBe(false);
  });

  it('falls back to the page when the database did not answer', () => {
    const params = parseApprovalQueueParams({ view });
    const t = searchedViewTally(view, rows, params, null, NOW_MS);
    expect(t.total).toBe(selectQueue(rows, params, NOW_MS).length);
    expect(t.bounded).toBe(false);
  });
});
