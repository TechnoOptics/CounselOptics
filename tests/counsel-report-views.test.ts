import { describe, expect, it } from 'vitest';

import { buildReportTiles } from '../lib/counsel-reports';
import {
  REPORT_VIEWS,
  assignFigures,
  placeableFigureIds,
  visibleReportViews,
} from '../lib/counsel-report-views';

/**
 * The Reports page is being read through four views instead of one flat list.
 *
 * The failure that matters is not a mislabelled tab. It is a figure that ends
 * up in NO view: the flat list stops being rendered, the number stops being
 * drawn, and nothing anywhere says so. A firm reads a Reports page that is
 * quietly missing "Documents overdue" and concludes there are none.
 *
 * So the central test does not compare the table against a copy of itself. It
 * drives the REAL builder, with the real option combinations, and asserts that
 * every figure it produces lands in exactly one view. Adding a figure to
 * lib/counsel-reports.ts without placing it turns this red rather than
 * removing it from the page.
 */

/** Every figure the builder can emit is a Count; these stand in for real ones. */
const INPUT = {
  requestsReceivedInWindow: 12,
  requestsNeedingAttention: 3,
  approvalsWaiting: 5,
  signingSentInWindow: 20,
  signingCompletedInWindow: 14,
  documentsOverdue: 2,
  mattersOpenedInWindow: 7,
};

/** Both roles, because canReadMatterMaterial adds two figures. */
const OPTION_SETS = [
  { canReadMatterMaterial: true },
  { canReadMatterMaterial: false },
];

describe('every figure the page draws has exactly one view', () => {
  for (const opts of OPTION_SETS) {
    it(`places every figure (canReadMatterMaterial: ${opts.canReadMatterMaterial})`, () => {
      const figures = buildReportTiles(INPUT, opts);
      expect(figures.length).toBeGreaterThan(0);
      const { views, unplaced } = assignFigures(figures);

      // The one that matters. A figure here is a number that would vanish.
      expect(
        unplaced.map((f) => f.id),
        'figure(s) with no view: add them to VIEW_OF_FIGURE in lib/counsel-report-views.ts',
      ).toEqual([]);

      // And exactly one, not two: a figure drawn twice is reconciled never.
      const placed = Object.values(views).flat().map((f) => f.id);
      expect(placed.slice().sort()).toEqual(figures.map((f) => f.id).sort());
      expect(new Set(placed).size).toBe(placed.length);
    });
  }

  it('keeps each view in the builder order', () => {
    const figures = buildReportTiles(INPUT, { canReadMatterMaterial: true });
    const { views } = assignFigures(figures);
    const order = figures.map((f) => f.id);
    for (const list of Object.values(views)) {
      const idx = list.map((f) => order.indexOf(f.id));
      expect(idx.slice().sort((a, b) => a - b)).toEqual(idx);
    }
  });

  it('does not claim the /counsel/my figures', () => {
    // Those belong to one person's queue. Folding them into a firm-wide report
    // is how somebody reads their own caseload as the firm's.
    for (const id of placeableFigureIds()) {
      expect(id.startsWith('my-')).toBe(false);
    }
  });
});

describe('the money view follows the workspace, not the firm type', () => {
  it('is offered when time and billing are shown', () => {
    const keys = visibleReportViews({ hideTimeBilling: false }).map((v) => v.key);
    expect(keys).toContain('money');
    expect(keys).toHaveLength(REPORT_VIEWS.length);
  });

  it('is withdrawn when the workspace hides time and billing', () => {
    // An in-house team invoices nobody, so the tab would head two dashes.
    const keys = visibleReportViews({ hideTimeBilling: true }).map((v) => v.key);
    expect(keys).not.toContain('money');
    expect(keys).toHaveLength(REPORT_VIEWS.length - 1);
  });

  it('withdraws only money, and keeps the other three in order', () => {
    expect(visibleReportViews({ hideTimeBilling: true }).map((v) => v.key)).toEqual([
      'incoming',
      'waiting',
      'outgoing',
    ]);
  });
});

describe('the views describe themselves', () => {
  it('every view has a label and a blurb, and no em dash', () => {
    for (const v of REPORT_VIEWS) {
      expect(v.label.length).toBeGreaterThan(0);
      expect(v.blurb.length).toBeGreaterThan(0);
      expect(v.label).not.toContain('—');
      expect(v.blurb).not.toContain('—');
    }
  });

  it('keys are unique', () => {
    const keys = REPORT_VIEWS.map((v) => v.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
