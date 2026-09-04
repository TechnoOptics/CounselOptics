import {
  COUNSEL_METRIC_GROUPS,
  metricLabel,
  type CounselMetricGroupId,
} from './counsel-dashboard';
import {
  filterMatters,
  parseMatterListParams,
  type MatterRow,
} from './matter-list';

/**
 * The counsel dashboard's metric board: what a partner wants to know on a
 * Monday morning, and the one click that takes them to the rows behind it.
 *
 * TWO RULES, BOTH LEARNED THE HARD WAY ON THIS PAGE.
 *
 * A NUMBER IS THE WHOLE SET. Everything here is a count. A count taken over
 * a page of rows is a floor wearing a total's label, and this dashboard has
 * shipped that twice: the intake lanes were tallied over a 200-row read, and
 * the signing chase-ups were the length of a list sliced to ten. So nothing
 * on this board may be `.slice().length` or the length of a capped read. The
 * page hands this module figures that came from `count: 'exact'` queries or
 * from lists that carry no `.limit()`, and this module does arithmetic on
 * none of them.
 *
 * A NUMBER AND ITS DESTINATION AGREE. A tile reading 14 that opens a page
 * showing 9 is worse than a tile that does not open anything, because the
 * disagreement is invisible until somebody counts by hand. For the matter
 * figures that agreement is STRUCTURAL rather than promised: the count is
 * produced by running the caseload page's own `parseMatterListParams` and
 * `filterMatters` over the very query string the tile links at, so the two
 * cannot come apart. For the rest, the destination's predicate is restated
 * in app/counsel/page.tsx and pinned to that page's source text by
 * tests/counsel-dashboard-drilldown.test.ts.
 *
 * A FIGURE IS NAMED ONCE. Labels and band names are not written here; they
 * are looked up from the catalog in lib/counsel-dashboard.ts, which is also
 * what the dashboard's picker offers. A figure whose switch says one thing
 * and whose card says another is the drift this repo has already shipped
 * with three hand-written copies of one rectangle, so there is exactly one
 * declaration and this module reads it.
 *
 * SEMANTIC COLOUR IS NOT THE FIRM ACCENT. `tone` is state - clear, waiting,
 * urgent - and the renderer paints it from the fixed `--warn-text` and
 * `--danger-text` tokens, never from `firms.accent_color`. Every tone also
 * carries a `state` word, so state never reads as colour alone.
 */

/** How a figure reads: nothing owed, somebody else's move, or ours. */
export type MetricTone = 'clear' | 'waiting' | 'urgent';

export type CounselMetric = {
  /** Stable, unique across the whole board. A catalog id. */
  id: string;
  /** A static UI label, from the catalog. Never firm data. */
  label: string;
  /** The figure itself, so a test can assert on it without parsing. */
  count: number;
  /** The figure as drawn: an integer, or a currency amount. */
  value: string;
  /**
   * One plain line saying what the figure counts. A NOUN PHRASE, always:
   * the hint stays put while the figure moves, so "Past their due date and
   * still unsigned" sat under a zero and read as a contradiction. "Documents
   * past their due date and still unsigned" is true at every count.
   */
  hint: string;
  /** The state, in words, so the tone is never colour alone. Static copy. */
  state: string;
  tone: MetricTone;
  /** The list that holds these rows, filtered to them. */
  href: string;
};

export type MetricBand = {
  id: CounselMetricGroupId;
  /** Whose move it is. The band names a fact, not a category. */
  label: string;
  blurb: string;
  metrics: CounselMetric[];
};

/**
 * A matter figure, expressed as the caseload page's own query string.
 *
 * The query is the whole definition: the count is what that query selects,
 * and the link is that query. There is deliberately no second place where a
 * status set or a staleness window is written down.
 */
export type MatterMetricSpec = {
  id: string;
  /** A caseload-page query string. Empty means its default view. */
  query: string;
  hint: string;
  /** The state word when the figure is above zero, and when it is zero. */
  activeState: string;
  clearState: string;
  /** Which tone a non-zero figure reads as. */
  activeTone: Exclude<MetricTone, 'clear'>;
};

const CASES = '/counsel/cases';

export const MATTER_METRIC_SPECS: readonly MatterMetricSpec[] = [
  {
    id: 'matters-unassigned',
    // The caseload page's Assignee column filter, NOT its `view=unassigned`
    // tab. The tab is unassigned-in-any-state, so it counts closed matters
    // that were never given an owner, and nobody owes those anything. The
    // column filter runs under the page's default view, which is live
    // matters, so this is "live and unowned" without a second definition of
    // either half.
    query: 'assignee=unassigned',
    hint: 'Live matters with nobody named on them.',
    activeState: 'Needs an owner',
    clearState: 'All owned',
    activeTone: 'urgent',
  },
  {
    id: 'matters-hearing',
    // Same reasoning as the assignee filter above: the `view=hearing` tab
    // does not exclude closed matters, and a hearing on a closed matter is
    // not something to prepare for.
    query: 'hearing=soon',
    hint: 'Live matters with a court date close enough to prepare for.',
    activeState: 'On the calendar',
    clearState: 'None listed',
    activeTone: 'waiting',
  },
  {
    id: 'matters-stale',
    // The caseload page's default view is live matters, and `updated=older`
    // is its own "more than 30 days" step, so this is "live and untouched
    // for a month" without a second definition of either half.
    query: 'updated=older',
    hint: 'Live matters nobody has touched in a month.',
    activeState: 'Going quiet',
    clearState: 'All current',
    activeTone: 'waiting',
  },
];

/**
 * A band's name and one-line blurb, from the same catalog the picker groups
 * its switches by. Throws rather than drawing an unnamed band.
 */
function bandMeta(id: CounselMetricGroupId): { label: string; blurb: string } {
  const g = COUNSEL_METRIC_GROUPS.find((x) => x.id === id);
  if (!g) throw new Error(`unknown metric band: ${id}`);
  return { label: g.label, blurb: g.blurb };
}

function qsRecord(query: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(query).entries());
}

function toneOf(
  count: number,
  active: Exclude<MetricTone, 'clear'>,
): MetricTone {
  return count > 0 ? active : 'clear';
}

/**
 * How many matters a caseload-page query string selects.
 *
 * The one place a matter figure is produced anywhere on the dashboard, and
 * it produces it by running the destination page's own parser and filter.
 * `rows` must be every matter at the firm: it comes from listFirmCases,
 * which carries no `.limit()`, and the caseload page reads the same list,
 * so the two screens count one set with one function.
 *
 * An empty query is the caseload page's default view, which is every matter
 * that is not closed or archived. That is what "open matters" means on the
 * page this dashboard sends people to, and so it is what it means here. It
 * used to mean a hand-written set of four statuses that left `draft` out,
 * which made the strip and the page it opened disagree.
 */
export function matterCountFor(
  rows: MatterRow[],
  query: string,
  meId: string | null,
  now = Date.now(),
): number {
  const params = parseMatterListParams(qsRecord(query), meId);
  return filterMatters(rows, params, meId, now).length;
}

/**
 * The client list, narrowed to a status only when the page will honour it.
 *
 * /counsel/clients builds its view strip from the statuses its clients are
 * actually in and silently drops any other `view`, so a tile reading "0
 * active" that linked at `?view=active` would open the whole client list
 * and disagree with itself. At zero it links at the list it would land on
 * anyway.
 */
export function clientsHref(
  count: number,
  view: 'active' | 'invited',
): string {
  return count > 0 ? `/counsel/clients?view=${view}` : '/counsel/clients';
}

/** The matter figures on the board, counted by the caseload page's filter. */
export function matterMetrics(
  rows: MatterRow[],
  meId: string | null,
  now = Date.now(),
): CounselMetric[] {
  return MATTER_METRIC_SPECS.map((spec) => {
    const count = matterCountFor(rows, spec.query, meId, now);
    return {
      id: spec.id,
      label: metricLabel(spec.id),
      count,
      value: String(count),
      hint: spec.hint,
      state: count > 0 ? spec.activeState : spec.clearState,
      tone: toneOf(count, spec.activeTone),
      href: spec.query ? `${CASES}?${spec.query}` : CASES,
    };
  });
}

/**
 * Money, drawn the way /counsel/billing draws it, so the tile and the stat
 * it opens read character for character alike.
 */
export function fmtCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

export type CounselMetricInput = {
  /** Every matter at the firm, from listFirmCases. */
  matters: MatterRow[];
  /**
   * Whether matter figures may appear at all. Decided by hasCapability
   * ('matters') on the page and passed in, so this module does not grow a
   * second copy of that rule. When false, every matter metric is absent
   * rather than zero, and a band left with no metrics is dropped by the page.
   */
  mattersVisible: boolean;
  meId: string | null;
  /** Exact counts over firm_template_submissions. */
  approvals: { waiting: number; aging: number };
  /** Counted over the unbounded listFirmSigningRequests. */
  signing: { out: number; attention: number };
  /** Counted over the unbounded listFirmDocuments. */
  documents: { overdue: number; unfiled: number };
  people: { invitationsPending: number; clientsInvited: number };
  /**
   * Null when the firm has time and billing switched off, because both
   * figures open pages that redirect away under that setting. A tile that
   * lands on a redirect is a dead click.
   */
  money: { outstandingCents: number; unbilledCents: number } | null;
  now?: number;
};

function metric(
  m: Omit<CounselMetric, 'value' | 'state' | 'tone' | 'label'> & {
    value?: string;
    activeState: string;
    clearState: string;
    activeTone: Exclude<MetricTone, 'clear'>;
  },
): CounselMetric {
  const { activeState, clearState, activeTone, value, ...rest } = m;
  return {
    ...rest,
    label: metricLabel(m.id),
    value: value ?? String(m.count),
    state: m.count > 0 ? activeState : clearState,
    tone: toneOf(m.count, activeTone),
  };
}

/**
 * The board, in bands.
 *
 * The bands say WHOSE MOVE IT IS, which is the question a partner is
 * actually asking when they scan this. That is a real property of each
 * figure rather than a filing category: "out for signature" and "awaiting
 * approval" are both documents in flight, and they belong in different
 * bands because only one of them is waiting on this firm.
 */
export function buildCounselMetricBands(
  input: CounselMetricInput,
): MetricBand[] {
  const matters = new Map(
    matterMetrics(input.matters, input.meId, input.now).map((m) => [m.id, m]),
  );
  // Absence is an outcome, not an exception. When matters are not visible
  // for this viewer, a matter metric is simply not on the board; throwing
  // here used to take the whole dashboard down for a workspace that had
  // nothing to show, which is the opposite of calm.
  const need = (id: string): CounselMetric | null => {
    if (!input.mattersVisible) return null;
    const m = matters.get(id);
    if (!m) throw new Error(`unknown matter metric: ${id}`);
    return m;
  };
  const present = (ms: Array<CounselMetric | null>): CounselMetric[] =>
    ms.filter((m): m is CounselMetric => m !== null);

  const bands: MetricBand[] = [
    {
      id: 'firm-owes',
      ...bandMeta('firm-owes'),
      metrics: present([
        metric({
          id: 'approvals-waiting',
          count: input.approvals.waiting,
          hint:
            input.approvals.aging > 0
              ? `${input.approvals.aging} of them have been waiting over three days.`
              : 'Documents colleagues filed, waiting on a reviewer.',
          href: '/counsel/forms/approvals?view=waiting',
          activeState: 'Needs a decision',
          clearState: 'Queue clear',
          activeTone: 'urgent',
        }),
        metric({
          id: 'signing-attention',
          count: input.signing.attention,
          hint: 'Requests where a signer declined or asked for changes.',
          href: '/counsel/signing?view=attention',
          activeState: 'Needs a decision',
          clearState: 'Nothing rejected',
          activeTone: 'urgent',
        }),
        metric({
          id: 'documents-overdue',
          count: input.documents.overdue,
          hint: 'Documents past their due date and still unsigned.',
          href: '/counsel/documents?view=overdue',
          activeState: 'Past due',
          clearState: 'All on time',
          activeTone: 'urgent',
        }),
        need('matters-unassigned'),
      ]),
    },
    {
      id: 'out-with-others',
      ...bandMeta('out-with-others'),
      metrics: [
        metric({
          id: 'signing-out',
          count: input.signing.out,
          hint: 'Requests sent, partly signed, or not yet opened.',
          href: '/counsel/signing?view=out',
          activeState: 'Awaiting signers',
          clearState: 'Nothing out',
          activeTone: 'waiting',
        }),
        metric({
          id: 'clients-invited',
          count: input.people.clientsInvited,
          hint: 'Clients invited to the portal who have not joined.',
          href: clientsHref(input.people.clientsInvited, 'invited'),
          activeState: 'Awaiting the client',
          clearState: 'None pending',
          activeTone: 'waiting',
        }),
        metric({
          id: 'team-invitations',
          count: input.people.invitationsPending,
          hint: 'Colleagues invited to the firm who have not joined.',
          href: '/counsel/team',
          activeState: 'Awaiting the colleague',
          clearState: 'None pending',
          activeTone: 'waiting',
        }),
      ],
    },
    {
      id: 'matter-health',
      ...bandMeta('matter-health'),
      metrics: present([
        need('matters-hearing'),
        need('matters-stale'),
        metric({
          id: 'documents-unfiled',
          count: input.documents.unfiled,
          hint: 'Documents held for the firm but not attached to a case.',
          href: '/counsel/documents?view=unfiled',
          activeState: 'To file',
          clearState: 'All filed',
          activeTone: 'waiting',
        }),
      ]),
    },
  ];

  if (input.money) {
    bands.push({
      id: 'money',
      ...bandMeta('money'),
      metrics: [
        metric({
          id: 'billing-outstanding',
          count: input.money.outstandingCents,
          value: fmtCents(input.money.outstandingCents),
          hint: 'Invoiced and not yet paid, across every invoice.',
          href: '/counsel/billing',
          activeState: 'Owed to the firm',
          clearState: 'Nothing owed',
          activeTone: 'waiting',
        }),
        metric({
          id: 'billing-unbilled',
          count: input.money.unbilledCents,
          value: fmtCents(input.money.unbilledCents),
          hint: 'Billable time logged and not yet on an invoice.',
          href: '/counsel/billing',
          activeState: 'Ready to bill',
          clearState: 'Nothing to bill',
          activeTone: 'waiting',
        }),
      ],
    });
  }

  return bands;
}
