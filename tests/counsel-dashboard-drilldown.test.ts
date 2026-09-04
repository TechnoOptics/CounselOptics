import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  PAGE_SIZE,
  filterMatters,
  parseMatterListParams,
  type MatterRow,
} from '../lib/matter-list';
import {
  MATTER_METRIC_SPECS,
  buildCounselMetricBands,
  clientsHref,
  fmtCents,
  matterCountFor,
  matterMetrics,
  type CounselMetric,
  type CounselMetricInput,
} from '../lib/counsel-metrics';

/**
 * The dashboard's metric board makes every number a link into the list that
 * holds the rows behind it. Two things have to hold for that to be worth
 * anything, and each of them has failed on this dashboard before:
 *
 *   1. THE NUMBER IS THE WHOLE SET. Every figure on this board is a count,
 *      and a count taken over a page of rows is a floor wearing a total's
 *      label. The intake lanes shipped that way (a tally over 200 rows), the
 *      signing chase-ups shipped that way (the length of a list sliced to
 *      ten), and both were read as totals by the card that adds them up.
 *
 *   2. THE NUMBER AND ITS DESTINATION AGREE. A tile that says 14 and opens a
 *      page showing 9 is a tile that lies, and the lie is invisible until
 *      somebody counts the rows by hand.
 *
 * For the matter metrics, (2) is held STRUCTURALLY rather than by assertion:
 * the count is produced by running the caseload page's own
 * `parseMatterListParams` + `filterMatters` over the query string the tile
 * links at. The test below re-derives that independently from the href, so a
 * change that makes the count and the link disagree cannot pass.
 *
 * For the metrics whose destination lives in a page this module cannot
 * import a predicate from, the predicate is restated here and PINNED to the
 * destination's source text, so the restatement cannot drift silently.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p: string) => readFileSync(`${root}${p}`, 'utf8');

const ME = 'user-me';
const NOW = Date.parse('2026-08-10T12:00:00.000Z');
const DAY = 86_400_000;

function row(over: Partial<MatterRow> & { id: string }): MatterRow {
  return {
    matterNumber: null,
    title: 'A matter',
    subjectName: 'A client',
    caseType: 'general',
    status: 'open',
    statusLabel: 'Open',
    statusColor: '',
    assignedTo: ME,
    assigneeLabel: 'Me',
    hearingAt: null,
    updatedAt: new Date(NOW - DAY).toISOString(),
    ...over,
  };
}

/**
 * A fixture built out of the cases that separate one metric from another.
 * Every row here exists to be counted by exactly one metric and skipped by
 * the rest, so a predicate that widens or narrows moves a number.
 */
const FIXTURE: MatterRow[] = [
  // Unassigned and live. The one row "Unassigned matters" is about.
  row({ id: 'unassigned-open', assignedTo: null, assigneeLabel: null }),
  // Unassigned but finished: a closed matter with no assignee is not work.
  row({ id: 'unassigned-closed', assignedTo: null, status: 'closed' }),
  // A hearing inside the 30-day window.
  row({ id: 'hearing-soon', hearingAt: new Date(NOW + 10 * DAY).toISOString() }),
  // A hearing outside it.
  row({ id: 'hearing-far', hearingAt: new Date(NOW + 90 * DAY).toISOString() }),
  // Live and untouched for well over a month.
  row({ id: 'stale-open', updatedAt: new Date(NOW - 45 * DAY).toISOString() }),
  // Untouched for just as long, but archived, so nobody owes it anything.
  row({
    id: 'stale-archived',
    status: 'archived',
    updatedAt: new Date(NOW - 45 * DAY).toISOString(),
  }),
  // A draft. The caseload page's default view counts it as live, so this
  // dashboard has to as well or the two screens disagree on day one.
  row({ id: 'draft-live', status: 'draft' }),
];

const MONEY: NonNullable<CounselMetricInput['money']> = {
  outstandingCents: 1_248_000,
  unbilledCents: 96_500,
};

function input(over: Partial<CounselMetricInput> = {}): CounselMetricInput {
  return {
    matters: FIXTURE,
    mattersVisible: true,
    meId: ME,
    approvals: { waiting: 3, aging: 1 },
    signing: { out: 4, attention: 2 },
    documents: { overdue: 1, unfiled: 6 },
    people: { invitationsPending: 2, clientsInvited: 1 },
    money: MONEY,
    now: NOW,
    ...over,
  };
}

function allMetrics(inp: CounselMetricInput): CounselMetric[] {
  return buildCounselMetricBands(inp).flatMap((b) => b.metrics);
}

/* ------------------------------------------------------------------ */
/* 1. The number is the whole set, never a page of it.                 */
/* ------------------------------------------------------------------ */

describe('a metric states a count, not the first page of one', () => {
  it('reports every unassigned matter past the caseload page size', () => {
    // The failure this pins is the one the caseload page invites: it renders
    // 25 rows at a time, so a metric fed from what that page DRAWS would top
    // out at 25 no matter how many matters were waiting for an owner.
    const many = Array.from({ length: PAGE_SIZE * 2 + 7 }, (_, i) =>
      row({ id: `u${i}`, assignedTo: null, assigneeLabel: null }),
    );
    const m = matterMetrics(many, ME, NOW).find(
      (x) => x.id === 'matters-unassigned',
    );
    expect(m).toBeDefined();
    expect(m?.count).toBe(PAGE_SIZE * 2 + 7);
    expect(m?.count).not.toBe(PAGE_SIZE);
    // And the rendered value is the count, not a truncated or "25+" form.
    expect(m?.value).toBe(String(PAGE_SIZE * 2 + 7));
  });

  it('renders a large count in full rather than abbreviating it', () => {
    const metrics = allMetrics(
      input({ approvals: { waiting: 1234, aging: 0 } }),
    );
    const waiting = metrics.find((m) => m.id === 'approvals-waiting');
    expect(waiting?.count).toBe(1234);
    expect(waiting?.value).toBe('1234');
  });
});

/* ------------------------------------------------------------------ */
/* 2. The number and its destination agree.                            */
/* ------------------------------------------------------------------ */

describe('a matter metric counts exactly the rows its own link selects', () => {
  it('re-derives every count from the href and gets the same number', () => {
    const metrics = matterMetrics(FIXTURE, ME, NOW);
    expect(metrics.length).toBe(MATTER_METRIC_SPECS.length);
    for (const m of metrics) {
      const qs = new URLSearchParams(new URL(m.href, 'https://a.test').search);
      const params = parseMatterListParams(
        Object.fromEntries(qs.entries()),
        ME,
      );
      expect(
        filterMatters(FIXTURE, params, ME, NOW).length,
        `${m.id} says ${m.count} and ${m.href} shows a different set`,
      ).toBe(m.count);
    }
  });

  it('links every matter metric at the caseload page', () => {
    for (const m of matterMetrics(FIXTURE, ME, NOW)) {
      expect(m.href.startsWith('/counsel/cases')).toBe(true);
    }
  });

  it('never links at a query the caseload page would throw away', () => {
    // A misspelled view (`?view=unasigned`) degrades to the default view
    // rather than erroring, so the tile would keep its own number and open
    // the whole caseload. Every param a spec sets has to survive the parse.
    for (const spec of MATTER_METRIC_SPECS) {
      const qs = new URLSearchParams(spec.query);
      const parsed = parseMatterListParams(
        Object.fromEntries(qs.entries()),
        ME,
      ) as unknown as Record<string, string>;
      for (const [key, value] of qs.entries()) {
        expect(
          parsed[key],
          `${spec.id}: ?${key}=${value} is not a filter the caseload page keeps`,
        ).toBe(value);
      }
    }
  });

  it('counts the rows each metric is named for and no others', () => {
    const by = new Map(matterMetrics(FIXTURE, ME, NOW).map((m) => [m.id, m]));
    // Unassigned: the live one only. A closed matter with no assignee is
    // not somebody's missing work.
    expect(by.get('matters-unassigned')?.count).toBe(1);
    // Hearing inside 30 days: one of the two rows carrying a hearing.
    expect(by.get('matters-hearing')?.count).toBe(1);
    // Untouched for 30 days AND still live: the archived twin is excluded.
    expect(by.get('matters-stale')?.count).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* 3. The restated predicates stay tied to the pages they came from.   */
/* ------------------------------------------------------------------ */

describe('the headline strip agrees with the lists it opens', () => {
  it('counts open matters the way the caseload page default view does', () => {
    // The strip headline used to be a hand-written set of four "active"
    // statuses that did NOT include `draft`, while /counsel/cases counts a
    // draft as live. A firm with one draft matter therefore read one number
    // on the dashboard and a larger one on the page the tile opened.
    const open = matterCountFor(FIXTURE, '', ME, NOW);
    expect(open).toBe(
      filterMatters(FIXTURE, parseMatterListParams({}, ME), ME, NOW).length,
    );
    // Everything in the fixture except the closed one and the archived one.
    expect(open).toBe(5);
  });

  it('only pre-filters the client list when that filter exists on it', () => {
    // /counsel/clients drops a `view` no client is currently in, so a tile
    // reading "0 active" would open the whole client list. At zero the tile
    // links at the unfiltered list, which is what it would land on anyway.
    expect(clientsHref(3, 'active')).toBe('/counsel/clients?view=active');
    expect(clientsHref(0, 'active')).toBe('/counsel/clients');
    expect(clientsHref(2, 'invited')).toBe('/counsel/clients?view=invited');
    expect(clientsHref(0, 'invited')).toBe('/counsel/clients');
  });
});

describe('restated destination predicates are pinned to their source', () => {
  it('keeps the signing views this board counts', () => {
    const src = read('app/counsel/signing/page.tsx');
    // "Signatures out" and "Signing needs attention" are counted here from
    // listFirmSigningRequests and opened at ?view=out / ?view=attention.
    expect(src).toContain(
      "out: (r) => r.status === 'sent' || r.status === 'partial',",
    );
    expect(src).toContain("r.status === 'rejected' || r.status === 'changes_requested',");
  });

  it('keeps the document views this board counts', () => {
    const src = read('app/counsel/documents/page.tsx');
    expect(src).toContain("return d.status.startsWith('signed_');");
    expect(src).toContain('overdue: (d, nowMs) => isOverdue(d, nowMs),');
    expect(src).toContain('unfiled: (d) => d.caseId == null,');
    // The exact reading of "overdue", restated in app/counsel/page.tsx.
    expect(src).toContain('d.dueAt &&');
    expect(src).toContain('new Date(d.dueAt).getTime() < nowMs &&');
    expect(src).toContain("d.status !== 'canceled',");
  });

  it('keeps billing summing Outstanding over every invoice', () => {
    const src = read('app/counsel/billing/page.tsx');
    // The tile mirrors this sum and opens this page, so if the page ever
    // narrows it to the 100 it renders, the two would disagree.
    expect(src).toContain("if (i.status === 'sent') acc.outstanding += i.total_cents;");
    expect(src).toContain('and Collected are the firm');
    // The unbilled predicate the "Unbilled time" tile restates.
    expect(src).toContain(".eq('billable', true)");
    expect(src).toContain(".is('invoice_id', null)");
    expect(src).toContain(".not('ended_at', 'is', null)");
    expect(src).toContain(".gt('duration_seconds', 0)");
  });

  it('formats money the way the page it opens formats it', () => {
    // Same call, so the tile and the Outstanding stat read character for
    // character alike rather than one rounding and the other not.
    expect(fmtCents(1_248_000)).toBe(
      (1_248_000 / 100).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
      }),
    );
  });
});

/* ------------------------------------------------------------------ */
/* 4. Reachability: nothing links where the reader cannot go.          */
/* ------------------------------------------------------------------ */

describe('every metric opens somewhere the reader can actually get to', () => {
  it('drops the money band when the firm has time and billing switched off', () => {
    const ids = allMetrics(input({ money: null })).map((m) => m.id);
    expect(ids).not.toContain('billing-outstanding');
    expect(ids).not.toContain('billing-unbilled');
    // Those two are the only ones behind that switch; the rest survive.
    expect(ids).toContain('approvals-waiting');
    expect(ids).toContain('matters-unassigned');
  });

  it('shows the money band when time and billing is on', () => {
    const ids = allMetrics(input()).map((m) => m.id);
    expect(ids).toContain('billing-outstanding');
    expect(ids).toContain('billing-unbilled');
  });

  it('links every metric inside the counsel workspace', () => {
    for (const m of allMetrics(input())) {
      expect(m.href.startsWith('/counsel/'), `${m.id} -> ${m.href}`).toBe(true);
    }
  });

  it('gives every metric a unique id so two cannot collide in a grid', () => {
    const ids = allMetrics(input()).map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* ------------------------------------------------------------------ */
/* 5. State reads without colour.                                      */
/* ------------------------------------------------------------------ */

describe('state is encoded in words and form, not colour alone', () => {
  it('gives every metric a state word', () => {
    for (const m of allMetrics(input())) {
      expect(m.state.length, `${m.id} has no state word`).toBeGreaterThan(0);
      expect(m.hint.length, `${m.id} has no hint`).toBeGreaterThan(0);
    }
  });

  it('calls a zero in the firm-owes band clear rather than urgent', () => {
    const metrics = allMetrics(
      input({
        approvals: { waiting: 0, aging: 0 },
        signing: { out: 0, attention: 0 },
        documents: { overdue: 0, unfiled: 0 },
      }),
    );
    const waiting = metrics.find((m) => m.id === 'approvals-waiting');
    expect(waiting?.tone).toBe('clear');
    const attention = metrics.find((m) => m.id === 'signing-attention');
    expect(attention?.tone).toBe('clear');
  });

  it('marks work the firm owes as urgent and work sitting elsewhere as waiting', () => {
    const metrics = allMetrics(input());
    expect(metrics.find((m) => m.id === 'approvals-waiting')?.tone).toBe(
      'urgent',
    );
    expect(metrics.find((m) => m.id === 'signing-attention')?.tone).toBe(
      'urgent',
    );
    // Out for signature is not the firm's move; it is a chase-up.
    expect(metrics.find((m) => m.id === 'signing-out')?.tone).toBe('waiting');
    expect(metrics.find((m) => m.id === 'team-invitations')?.tone).toBe(
      'waiting',
    );
  });
});

/* ------------------------------------------------------------------ */
/* 6. The page asks the database for the figures it states as totals.  */
/* ------------------------------------------------------------------ */

describe('the dashboard page counts in the database, not in a page of rows', () => {
  const dashboard = read('app/counsel/page.tsx');

  /** Each `.from('<table>')` call on the page and the chain hung off it. */
  function queries(table: string): string[] {
    return dashboard
      .split(`from('${table}')`)
      .slice(1)
      .map((part) => part.split(/\n\s*\n/)[0]);
  }

  it('finds the approvals reads at all, so an empty sweep cannot pass', () => {
    // Two: pending, and pending-for-over-three-days. Both are counts.
    expect(queries('firm_template_submissions')).toHaveLength(2);
  });

  it('takes both approval figures as exact counts with no row cap', () => {
    for (const q of queries('firm_template_submissions')) {
      expect(q, `an approvals total without an exact count: ${q}`).toContain(
        "count: 'exact'",
      );
      expect(q).toContain('head: true');
      expect(q, `an approvals total behind a row cap: ${q}`).not.toContain(
        '.limit(',
      );
    }
  });

  it('sums the two money figures over every row rather than a page', () => {
    const q = queries('firm_invoices');
    expect(q).toHaveLength(1);
    expect(q[0]).not.toContain('.limit(');
    const t = queries('firm_time_entries');
    expect(t).toHaveLength(1);
    expect(t[0]).not.toContain('.limit(');
  });

  it('does not build a board figure out of a slice', () => {
    // `recentUploads` is a labelled preview and keeps its slice; nothing
    // that reaches buildCounselMetricBands may.
    const call = dashboard.slice(
      dashboard.indexOf('buildCounselMetricBands('),
    );
    expect(call.length).toBeGreaterThan(0);
    const args = call.slice(0, call.indexOf('\n  });') + 1);
    expect(args).not.toContain('.slice(');
  });

  it('no longer spells its own set of open-matter statuses', () => {
    // The set that disagreed with /counsel/cases about `draft`.
    expect(dashboard).not.toContain('openCaseStatuses');
  });

  it('opens each headline metric at the list behind it', () => {
    for (const href of [
      // The first figure is open TICKETS now, so it opens the ticket queue.
      // /counsel/inbox's default view is "All open", which is the same set
      // the figure counts; see openIntakeOrFilter in lib/intake-workflow.ts.
      'href="/counsel/inbox"',
      'href="/counsel/signing?view=out"',
      'href="/counsel/documents"',
    ]) {
      expect(dashboard, `no strip link at ${href}`).toContain(href);
    }
    // The client link is conditional, so it arrives through the helper.
    expect(dashboard).toContain('clientsHref(');
  });

  it('routes the matter figures through the caseload page own filter', () => {
    // Not a hand-rolled status set. Two screens that spell "open matters"
    // twice are two screens that will eventually disagree about it.
    expect(dashboard).toContain('matterCountFor(');
    expect(dashboard).toContain('buildCounselMetricBands(');
    expect(dashboard).toContain("from '@/lib/counsel-metrics'");
  });
});
