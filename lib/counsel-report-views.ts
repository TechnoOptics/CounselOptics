import type { Figure } from './counsel-reports';

/**
 * The four views the Reports page is read through.
 *
 * WHY FOUR, AND WHY THESE FOUR. The reference product groups its reporting
 * into Adoption, Usage, Service and Outcomes. Those are a delivery business's
 * words, and two of them have nothing behind them here: Advottic records no
 * sign-in or seat-activity figures, so an "Adoption" tab would have rendered an
 * empty panel with a confident name on it. That is worse than no tab.
 *
 * So the grouping is taken from the sentence the Reports page already tells
 * about itself - "what came in, what went out, and what is still waiting" -
 * plus the money, which is its own question and its own audience. Every view
 * below is backed by figures that already exist and already have call sites.
 *
 * ONE FIGURE, ONE VIEW. A figure that appears twice is read twice and reconciled
 * never, and a figure in no view silently disappears from the page the moment
 * the flat list stops being rendered. assignFigures below enforces both, and
 * the test asserts it against the REAL builder output rather than a copy of
 * this table, so adding a figure to lib/counsel-reports.ts without placing it
 * here fails rather than vanishing.
 *
 * Pure and I/O-free: the page resolves the figures, this decides where each one
 * is drawn, and the dashboard customizer reads the same ids back.
 */

export type ReportViewKey = 'incoming' | 'waiting' | 'outgoing' | 'money';

export type ReportView = {
  key: ReportViewKey;
  /** The tab. Advottic's own plain nouns, not the reference product's. */
  label: string;
  /** One line under the tab saying what the view answers. */
  blurb: string;
};

export const REPORT_VIEWS: readonly ReportView[] = [
  {
    key: 'incoming',
    label: 'Coming in',
    blurb: 'What was filed with the legal team, and how it split across the weeks.',
  },
  {
    key: 'waiting',
    label: 'Waiting',
    blurb: 'What is sitting with somebody, and what has gone past its date.',
  },
  {
    key: 'outgoing',
    label: 'Going out',
    blurb: 'What was sent for signature or decided, and how much of it landed.',
  },
  {
    key: 'money',
    label: 'Money',
    blurb: 'Invoices raised and settled.',
  },
];

/**
 * Which view each figure belongs to.
 *
 * Keyed by the figure id from lib/counsel-reports.ts. The `my-*` ids are
 * deliberately absent: those are /counsel/my, a different page with a different
 * audience, and folding one person's queue into a firm-wide report is how a
 * partner ends up reading their own caseload as the firm's.
 */
const VIEW_OF_FIGURE: Record<string, ReportViewKey> = {
  'requests-received': 'incoming',
  'matters-opened': 'incoming',
  'requests-attention': 'waiting',
  'approvals-waiting': 'waiting',
  'documents-overdue': 'waiting',
  'signing-completion': 'outgoing',
};

/** A figure whose id this table does not know. Named so the caller can say so. */
export type FigureAssignment = {
  views: Record<ReportViewKey, Figure[]>;
  /** Figures with no view. Empty in a healthy build; the guard asserts it. */
  unplaced: Figure[];
};

/**
 * Split the page's figures across the four views, in the order the builder
 * produced them so a view's figures read in the same order they always did.
 *
 * An unknown id is RETURNED rather than dropped or guessed into a default
 * view. Silently dropping it would remove a real number from the page, and
 * defaulting it would put a number under a heading that does not describe it.
 * The caller decides, and the test refuses to let one exist.
 */
export function assignFigures(figures: readonly Figure[]): FigureAssignment {
  const views = {
    incoming: [] as Figure[],
    waiting: [] as Figure[],
    outgoing: [] as Figure[],
    money: [] as Figure[],
  };
  const unplaced: Figure[] = [];
  for (const figure of figures) {
    const key = VIEW_OF_FIGURE[figure.id];
    if (key) views[key].push(figure);
    else unplaced.push(figure);
  }
  return { views, unplaced };
}

/**
 * The views a firm actually sees.
 *
 * Money goes when the firm's workspace hides time and billing, which is the
 * same switch that removes Time, Billing and Trust from the rail. An in-house
 * team does not invoice anyone, so a tab reading "Money" over two dashes is a
 * question it was never going to ask. Resolved through the surface setting the
 * rest of the workspace already uses rather than through the firm type, so an
 * override still wins. See lib/firm-workspace.ts.
 */
export function visibleReportViews(opts: {
  hideTimeBilling: boolean;
}): readonly ReportView[] {
  if (!opts.hideTimeBilling) return REPORT_VIEWS;
  return REPORT_VIEWS.filter((v) => v.key !== 'money');
}

/** Every figure id this table places, for the dashboard customizer to offer. */
export function placeableFigureIds(): readonly string[] {
  return Object.keys(VIEW_OF_FIGURE);
}
