/**
 * The figures /counsel/reports and /counsel/my draw, and the three rules
 * that decide how each one is allowed to be drawn.
 *
 * Pure on purpose. Every read lives in lib/counsel-reports-data.ts, which
 * carries `server-only`; this half does the shaping, so the whole of it is
 * exercisable with no database and no DOM.
 *
 * A NUMBER IS THE WHOLE SET. Everything here is handed a figure that came
 * from a `count: 'exact', head: true` query. Nothing in this file adds two
 * counts together, takes a length, or estimates. lib/counsel-metrics.ts
 * says the same thing for the dashboard and says why: this product has
 * shipped a floor wearing a total's label three times, and every one of
 * them was a `.length` over a read that was capped somewhere else.
 *
 * A FIGURE THAT DOES NOT EXIST IS A DASH, NOT A ZERO. There are two ways a
 * figure can fail to exist, and both of them read as the same dash because
 * both of them mean "there is no number to state here":
 *
 *   - a rate over an empty denominator. A firm that sent no signature
 *     requests this month has no completion rate; "0%" would tell its
 *     partners that its signing collapsed.
 *   - a count that could not be read. A zero would be a fabricated figure,
 *     and it would fabricate the reassuring one.
 *
 * The caption stays either way, so the tile still says what it measures,
 * and the tone stays too, so a rate with no value this month is still drawn
 * as a rate. Nothing is hidden.
 *
 * A TILE ONLY EXISTS FOR A READER WHO CAN READ IT. `cases` and
 * `firm_documents` refuse a `staff` member under the applied
 * supabase/migrations/20260731_staff_role_read_scope.sql, and a refused
 * select returns an empty set with no error. So a matter figure is OMITTED
 * for a reader whose role cannot reach matter material rather than shown as
 * a zero (fabricated) or as a dash (which would claim the firm opened no
 * matters). The caller decides; see canReadMatterMaterial in the data
 * module, which reads the role set out of lib/firm-authz.ts rather than
 * keeping a second copy of it.
 */

/** The window every "recently" figure on these pages is taken over. */
export const REPORT_WINDOW_DAYS = 30;

/** How many weeks the demand chart covers. One exact count per week. */
export const REPORT_WEEKS = 12;

/**
 * What stands in for a figure that does not exist.
 *
 * A hyphen, not a dash character: no em dashes anywhere in this product,
 * and an en dash beside a row of tabular figures reads as a minus sign.
 */
export const DASH = '-';

/**
 * A figure that may not be there. `null` is "no number to state", never
 * zero: see the file header for the two ways that happens.
 */
export type Count = number | null;

/**
 * How a figure is coloured, and it is the only colour decision on a tile.
 *
 *   urgent  somebody has to act on this now
 *   rate    a share, which is a brand-positive reading rather than a load
 *   plain   a count with no judgement attached
 *
 * `urgent` is a property of the figure AND its value: a cleared queue is
 * the good state and must not be painted as a warning. The dashboard's
 * StatCard call sites already work this way and say so.
 */
export type FigureTone = 'urgent' | 'rate' | 'plain';

export type Figure = {
  /** Stable, and unique across both pages. */
  id: string;
  /**
   * A static UI label. It carries its own qualifier after a middle dot
   * when the figure is taken over a window, so the number can never be
   * read over the wrong one.
   */
  label: string;
  /** The figure itself, so a test can assert on it without parsing. */
  value: Count;
  /** The figure as drawn: an integer, a percentage, or the dash. */
  display: string;
  /**
   * One plain line saying what the figure counts. A NOUN PHRASE, always,
   * so it stays true while the figure moves and while the figure is
   * missing. lib/counsel-metrics.ts learned this the hard way: "Past
   * their due date and still unsigned" sat under a zero and read as a
   * contradiction.
   */
  caption: string;
  tone: FigureTone;
  /** The list that holds these rows. */
  href: string;
};

const WINDOW = `${REPORT_WINDOW_DAYS} days`;

/** An integer figure, or the dash when there is no figure. */
function draw(value: Count): string {
  return value == null ? DASH : String(value);
}

/**
 * A share of one exact count by another, or null when there is no share.
 *
 * Both guards at the ends are there because rounding can turn a true
 * statement into a false one. One landed in four hundred rounds to 0%,
 * and "0%" beside a caption saying one landed is a contradiction on the
 * page; three hundred and ninety-nine in four hundred rounds to 100%, and
 * "100%" means every single one.
 */
export function formatShare(
  numerator: Count,
  denominator: Count,
): string | null {
  if (numerator == null || denominator == null) return null;
  if (denominator <= 0) return null;
  const pct = Math.round((numerator / denominator) * 100);
  if (pct === 0 && numerator > 0) return '<1%';
  if (pct === 100 && numerator < denominator) return '>99%';
  return `${pct}%`;
}

function share(
  id: string,
  label: string,
  caption: string,
  href: string,
  numerator: Count,
  denominator: Count,
): Figure {
  const display = formatShare(numerator, denominator);
  return {
    id,
    label,
    // The VALUE of a share is the percentage it states, so a test can
    // assert the tile is empty without parsing the string.
    value:
      display == null || numerator == null || denominator == null || denominator <= 0
        ? null
        : Math.round((numerator / denominator) * 100),
    display: display ?? DASH,
    caption,
    tone: 'rate',
    href,
  };
}

function count(
  id: string,
  label: string,
  caption: string,
  href: string,
  value: Count,
  urgent = false,
): Figure {
  return {
    id,
    label,
    value,
    display: draw(value),
    caption,
    // Red only when something is actually waiting. A zero here is the
    // cleared queue, and an unreadable figure is not a warning either.
    tone: urgent && value != null && value > 0 ? 'urgent' : 'plain',
    href,
  };
}

// ---------------------------------------------------------------------------
// /counsel/reports
// ---------------------------------------------------------------------------

/** Every figure the firm-wide tile row is built from. */
export type ReportTileInput = {
  requestsReceivedInWindow: Count;
  requestsNeedingAttention: Count;
  approvalsWaiting: Count;
  signingSentInWindow: Count;
  signingCompletedInWindow: Count;
  /** Read only when the reader's role reaches matter material. */
  documentsOverdue: Count;
  mattersOpenedInWindow: Count;
};

export type ReportTileOptions = {
  /** False for `staff`, whose role is refused `cases` and `firm_documents`. */
  canReadMatterMaterial: boolean;
};

export function buildReportTiles(
  input: ReportTileInput,
  opts: ReportTileOptions,
): Figure[] {
  const tiles: Figure[] = [
    count(
      'requests-received',
      `New requests · ${WINDOW}`,
      'Matters and questions filed with the legal team.',
      '/counsel/inbox',
      input.requestsReceivedInWindow,
    ),
    count(
      'requests-attention',
      'Needs attention',
      'Requests nobody has triaged, and requests a conflict check flagged.',
      '/counsel/inbox',
      input.requestsNeedingAttention,
      true,
    ),
    count(
      'approvals-waiting',
      'Approvals waiting',
      'Documents colleagues filed, waiting on a reviewer.',
      '/counsel/forms/approvals?view=waiting',
      input.approvalsWaiting,
      true,
    ),
    share(
      'signing-completion',
      `Signing rate · ${WINDOW}`,
      'Share of the signature requests sent in the window that are fully signed.',
      '/counsel/signing',
      input.signingCompletedInWindow,
      input.signingSentInWindow,
    ),
  ];

  if (opts.canReadMatterMaterial) {
    tiles.push(
      count(
        'documents-overdue',
        'Documents overdue',
        'Documents past their due date and still unsigned.',
        '/counsel/documents?view=overdue',
        input.documentsOverdue,
        true,
      ),
      count(
        'matters-opened',
        `New matters · ${WINDOW}`,
        'New matters on the firm caseload.',
        '/counsel/cases',
        input.mattersOpenedInWindow,
      ),
    );
  }

  return tiles;
}

// ---------------------------------------------------------------------------
// /counsel/my
// ---------------------------------------------------------------------------

export type MyTileInput = {
  myOpenMatters: Count;
  myOpenRequests: Count;
  myRequestsNeedingAttention: Count;
  /** The denominator for the share. Exact, over the whole firm. */
  firmOpenRequests: Count;
  mySignaturesOut: Count;
  myApprovalDecisionsInWindow: Count;
  /** Omitted from the row when the firm hides time and billing. */
  myTimeEntriesInWindow: Count;
};

export type MyTileOptions = {
  canReadMatterMaterial: boolean;
  /** True when firm_settings.hide_time_billing is on. */
  hideTimeBilling?: boolean;
};

export function buildMyTiles(
  input: MyTileInput,
  opts: MyTileOptions,
): Figure[] {
  const tiles: Figure[] = [];

  if (opts.canReadMatterMaterial) {
    tiles.push(
      count(
        'my-matters',
        'My open matters',
        'Live matters with my name on them.',
        '/counsel/cases?assignee=me',
        input.myOpenMatters,
      ),
    );
  }

  tiles.push(
    count(
      'my-requests',
      'My open requests',
      'Requests assigned to me that are not yet accepted or closed.',
      '/counsel/inbox',
      input.myOpenRequests,
    ),
    count(
      'my-attention',
      'Mine needing attention',
      'My requests still untriaged, and mine a conflict check flagged.',
      '/counsel/inbox',
      input.myRequestsNeedingAttention,
      true,
    ),
    share(
      'my-queue-share',
      'My share of the queue',
      'My open requests as a share of every open request at the firm.',
      '/counsel/inbox',
      input.myOpenRequests,
      input.firmOpenRequests,
    ),
    count(
      'my-signatures-out',
      'My signatures out',
      'Requests I sent that are partly signed or not yet signed.',
      '/counsel/signing',
      input.mySignaturesOut,
    ),
    count(
      'my-approval-decisions',
      `My decisions · ${WINDOW}`,
      'Colleagues documents I approved, returned or declined.',
      '/counsel/forms/approvals',
      input.myApprovalDecisionsInWindow,
    ),
  );

  if (!opts.hideTimeBilling) {
    tiles.push(
      count(
        'my-time-entries',
        `Time entries · ${WINDOW}`,
        'Entries I started in the window, billable or not.',
        '/counsel/time',
        input.myTimeEntriesInWindow,
      ),
    );
  }

  return tiles;
}

// ---------------------------------------------------------------------------
// The charts
// ---------------------------------------------------------------------------

export type BarInput = { key: string; label: string; count: Count };

export type Bar = BarInput & {
  /** Width as a share of the heaviest bar, 0 to 100. */
  pct: number;
  display: string;
};

/**
 * A ranked bar list: heaviest first, every bar proportioned to the
 * heaviest one rather than to a total.
 *
 * Proportioned to the MAXIMUM because these categories do not partition
 * anything: the signing states overlap nothing but the approval outcomes
 * are a subset of the decisions taken, so a percentage-of-total would be
 * arithmetic the caller never asked for. The bar says "this one against
 * the biggest one", which is what a ranked list is for.
 *
 * A maximum of zero draws NO bar rather than a full one. Dividing by it
 * used to give every empty category a full-width bar, which reads as a
 * firm at capacity when the truth is a firm with nothing on.
 */
export function rankBars(input: BarInput[]): Bar[] {
  const max = input.reduce((m, b) => Math.max(m, b.count ?? 0), 0);
  return [...input]
    .sort((a, b) => (b.count ?? -1) - (a.count ?? -1))
    .map((b) => ({
      ...b,
      pct: max > 0 && b.count != null ? Math.round((b.count / max) * 100) : 0,
      display: draw(b.count),
    }));
}

/** One column of the demand chart: a week, and how many arrived in it. */
export type WeekPoint = {
  /** ISO date of the Monday the week starts on. */
  startIso: string;
  /** A short axis label, e.g. "4 Aug". */
  label: string;
  count: Count;
};
