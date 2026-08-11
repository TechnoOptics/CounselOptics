import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  COUNSEL_METRICS,
  COUNSEL_METRIC_GROUPS,
  COUNSEL_TILES,
  MATTER_READ_ROLES,
  getCounselDashboardConfig,
  getCounselHiddenMetrics,
  isCounselMetricId,
  mergeHiddenMetrics,
  metricLabel,
  offerableMetricIds,
  offerablePanelIds,
  visibleMetricIds,
  type DashboardViewerContext,
} from '@/lib/counsel-dashboard';
import { buildCounselMetricBands } from '@/lib/counsel-metrics';
import { FIRM_ROLES, type FirmRole } from '@/lib/firm-types';

/**
 * The dashboard's METRIC picker.
 *
 * "When you click on configure dashboard, that's supposed to configure the
 * tiles on the dashboard, not the list menu items." The thing the owner
 * calls a tile is a FIGURE - the four headline counts and the twelve on the
 * board - and until now the only thing the control could touch was the
 * panel blocks underneath them. This file holds the two halves of the fix:
 * that every figure on the page is offerable, and that offering one is
 * never allowed to promise a number the viewer cannot actually be shown.
 *
 * THE CATALOG IS THE ONE PLACE A FIGURE IS NAMED. lib/counsel-metrics.ts
 * looks its labels up here rather than spelling them again, so the picker
 * cannot offer "Unbilled time" while the board draws something else. What
 * a second declaration does to this repo is written down in
 * docs/ (signature geometry, three hand-written copies that each claimed
 * to agree and drifted twice). The remaining risk is COVERAGE - a figure
 * on the board with no catalog entry would be unhideable, and a catalog
 * entry with no figure would be a dead switch - so that is what the first
 * describe block holds.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const page = readFileSync(`${root}app/counsel/page.tsx`, 'utf8');

const OWNER: DashboardViewerContext = { role: 'owner', hideTimeBilling: false };

/** Every band on the board, with money present. */
function allBands() {
  return buildCounselMetricBands({
    matters: [],
    meId: 'me',
    approvals: { waiting: 0, aging: 0 },
    signing: { out: 0, attention: 0 },
    documents: { overdue: 0, unfiled: 0 },
    people: { invitationsPending: 0, clientsInvited: 0 },
    money: { outstandingCents: 0, unbilledCents: 0 },
  });
}

describe('every figure on the dashboard is in the catalog, and vice versa', () => {
  it('covers each band on the board, under that band own name', () => {
    const bands = allBands();
    expect(bands.length).toBeGreaterThan(0);
    for (const band of bands) {
      const group = COUNSEL_METRIC_GROUPS.find((g) => g.id === band.id);
      expect(group, `band ${band.id} has no picker group`).toBeTruthy();
      // The picker groups the figures the way the dashboard groups them,
      // under the band names the board itself prints.
      expect(group?.label).toBe(band.label);
      expect(group?.blurb).toBe(band.blurb);
    }
  });

  it('covers each figure on the board, in that band group', () => {
    for (const band of allBands()) {
      for (const m of band.metrics) {
        const meta = COUNSEL_METRICS.find((c) => c.id === m.id);
        expect(meta, `metric ${m.id} is not in the catalog`).toBeTruthy();
        expect(meta?.group).toBe(band.id);
        // Not a second spelling of the label: counsel-metrics reads it
        // from here. Asserted anyway so a future short-circuit is loud.
        expect(m.label).toBe(meta?.label);
      }
    }
  });

  it('has no catalog entry the page never draws', () => {
    const built = new Set(allBands().flatMap((b) => b.metrics.map((m) => m.id)));
    for (const meta of COUNSEL_METRICS) {
      if (meta.group === 'headline') {
        // The headline four are hand-written StatCards on the page, so
        // their guard is the source read below, not the band builder.
        continue;
      }
      expect(built.has(meta.id), `${meta.id} is a switch for nothing`).toBe(
        true,
      );
    }
  });

  it('gives every catalog entry a unique id and a real group', () => {
    const ids = COUNSEL_METRICS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(COUNSEL_METRIC_GROUPS.map((g) => g.id));
    for (const m of COUNSEL_METRICS) expect(groups.has(m.group)).toBe(true);
  });

  it('throws rather than drawing a blank when asked for an unknown label', () => {
    expect(() => metricLabel('no-such-metric')).toThrow();
  });
});

describe('the headline strip is wired to the catalog it is listed in', () => {
  const headline = COUNSEL_METRICS.filter((m) => m.group === 'headline');

  it('lists the four figures the strip actually draws', () => {
    expect(headline.length).toBe(4);
  });

  it('guards each headline figure by its own catalog id on the page', () => {
    // A headline entry the page never consults is a switch that does
    // nothing, which is the exact defect this whole change is fixing.
    //
    // "The page mentions the id" is NOT the guard, and proving that took
    // deleting one gate and watching this pass: the id still appeared, in
    // the `headlineOn` expression that decides whether the strip renders at
    // all. So the check is structural - every card in the strip is
    // immediately gated on its own id, and the ids doing the gating are
    // exactly the four the catalog lists.
    const strip = page.slice(
      page.indexOf('{headlineOn'),
      page.indexOf('<CounselMetricBoard'),
    );
    expect(strip.length, 'the headline strip was not found').toBeGreaterThan(0);
    expect(strip.split('<StripLink').length - 1).toBe(headline.length);
    const gated = [
      ...strip.matchAll(/\.has\('(headline-[a-z-]+)'\)\s*&&\s*\(\s*<StripLink/g),
    ].map((m) => m[1]);
    expect(gated.sort()).toEqual(headline.map((m) => m.id).sort());
  });

  it('names each headline figure on the page with the label it offers', () => {
    // The client figure is the one exception: its noun comes off the
    // per-type vocabulary map, so the page prints `vocab.clients` and the
    // catalog carries the default that map holds for a law firm.
    for (const m of headline) {
      if (m.id === 'headline-clients') {
        expect(page).toContain('vocab.clients');
        continue;
      }
      expect(page, `the strip does not say "${m.label}"`).toContain(m.label);
    }
  });
});

describe('the picker never offers a figure the viewer cannot be shown', () => {
  it('mirrors the role list the applied migration actually grants', () => {
    // `staff` is refused cases + firm_documents by
    // supabase/migrations/20260731_staff_role_read_scope.sql, and a
    // refused select comes back as an empty set with no error, so those
    // figures are ABSENT for that role rather than zero. Read the
    // migration rather than trusting this constant: the two drifting
    // apart is what would put a permanent zero on a staff dashboard.
    const sql = readFileSync(
      `${root}supabase/migrations/20260731_staff_role_read_scope.sql`,
      'utf8',
    );
    const bodies = [...sql.matchAll(/me\.role in \(([^)]*)\)/g)].map((m) =>
      m[1]
        .split(',')
        .map((s) => s.trim().replace(/^'|'$/g, ''))
        .sort(),
    );
    expect(bodies.length, 'the migration no longer filters on role').toBe(2);
    for (const roles of bodies) {
      expect(roles).toEqual([...MATTER_READ_ROLES].sort());
    }
  });

  it('withholds matter and document figures from staff', () => {
    const staff: DashboardViewerContext = {
      role: 'staff',
      hideTimeBilling: false,
    };
    const offered = new Set(offerableMetricIds(staff));
    for (const id of [
      'headline-open-matters',
      'headline-documents',
      'matters-unassigned',
      'matters-hearing',
      'matters-stale',
      'documents-overdue',
      'documents-unfiled',
    ]) {
      expect(offered.has(id), `${id} was offered to staff`).toBe(false);
    }
    // And it is not a blanket refusal: what staff can read stays on offer.
    expect(offered.has('signing-out')).toBe(true);
    expect(offered.has('team-invitations')).toBe(true);
  });

  it('offers every figure to each role that can read the rows', () => {
    for (const role of FIRM_ROLES.filter((r) => r !== 'staff')) {
      const offered = offerableMetricIds({ role, hideTimeBilling: false });
      expect(offered.length).toBe(COUNSEL_METRICS.length);
    }
  });

  it('withholds the money figures when the workspace hides billing', () => {
    const offered = new Set(
      offerableMetricIds({ role: 'owner', hideTimeBilling: true }),
    );
    expect(offered.has('billing-outstanding')).toBe(false);
    expect(offered.has('billing-unbilled')).toBe(false);
    expect(offered.has('signing-out')).toBe(true);
  });

  it('withholds matter and document panels from staff too', () => {
    const staff: DashboardViewerContext = {
      role: 'staff',
      hideTimeBilling: false,
    };
    const offered = new Set<string>(offerablePanelIds(staff, true));
    for (const id of [
      'cases-overview',
      'documents-overview',
      'recent-uploads',
      'assigned-to-me',
    ]) {
      expect(offered.has(id), `${id} was offered to staff`).toBe(false);
    }
    expect(offered.has('quick-actions')).toBe(true);
    // The admin-only panel is a separate gate and still applies.
    expect(offerablePanelIds(staff, false)).not.toContain('firm-settings');
    expect(offerablePanelIds(OWNER, true)).toContain('firm-settings');
  });

  it('never resurrects a hidden-by-the-workspace figure from a saved pick', () => {
    // The user wants Outstanding. The firm then switches billing off. The
    // workspace wins: a figure whose page redirects must not be drawn.
    const raw = { counsel: { hiddenMetrics: [] } };
    const on = visibleMetricIds(raw, OWNER);
    expect(on).toContain('billing-outstanding');
    const off = visibleMetricIds(raw, { role: 'owner', hideTimeBilling: true });
    expect(off).not.toContain('billing-outstanding');
  });
});

describe('a saved choice survives the thing that took its figure away', () => {
  it('keeps a hidden pick the picker could not offer this time', () => {
    // Somebody hid Outstanding while billing was on. Billing goes off, so
    // the picker cannot offer it, and a save that wrote only what it drew
    // would silently un-hide it the day billing came back.
    const stored = ['billing-outstanding', 'signing-out'];
    const offered = offerableMetricIds({ role: 'owner', hideTimeBilling: true });
    const next = mergeHiddenMetrics(stored, offered, []);
    expect(next).toContain('billing-outstanding');
    expect(next).not.toContain('signing-out');
  });

  it('takes the picker answer for every figure it did offer', () => {
    const offered = offerableMetricIds(OWNER);
    const next = mergeHiddenMetrics(['signing-out'], offered, [
      'team-invitations',
    ]);
    expect(next).toEqual(['team-invitations']);
  });

  it('drops an unknown id from either side of the merge', () => {
    const next = mergeHiddenMetrics(
      ['made-up-one'],
      offerableMetricIds(OWNER),
      ['made-up-two', 'signing-out'],
    );
    expect(next).toEqual(['signing-out']);
  });
});

describe('a preferences row written before any of this still works', () => {
  const legacy = { counsel: { enabled: ['quick-actions', 'action-center'] } };

  it('keeps the panels somebody chose last week, in their order', () => {
    expect(getCounselDashboardConfig(legacy)).toEqual([
      'quick-actions',
      'action-center',
    ]);
  });

  it('shows every figure, because they never said to hide one', () => {
    expect(getCounselHiddenMetrics(legacy)).toEqual([]);
    expect(visibleMetricIds(legacy, OWNER).length).toBe(COUNSEL_METRICS.length);
  });

  it('tells a never-configured user apart from one who hid everything', () => {
    expect(visibleMetricIds(null, OWNER).length).toBe(COUNSEL_METRICS.length);
    expect(
      visibleMetricIds(
        { counsel: { hiddenMetrics: COUNSEL_METRICS.map((m) => m.id) } },
        OWNER,
      ),
    ).toEqual([]);
  });

  it('drops an unknown id on read so a stale submission cannot poison it', () => {
    const raw = {
      counsel: { hiddenMetrics: ['signing-out', 'a-metric-we-deleted', 7] },
    };
    expect(getCounselHiddenMetrics(raw)).toEqual(['signing-out']);
  });

  it('ignores a hiddenMetrics that is not a list at all', () => {
    expect(getCounselHiddenMetrics({ counsel: { hiddenMetrics: 'no' } })).toEqual(
      [],
    );
    expect(isCounselMetricId('signing-out')).toBe(true);
    expect(isCounselMetricId('signing-outs')).toBe(false);
  });
});

describe('the page and the server action honour the picker', () => {
  const actions = readFileSync(`${root}lib/dashboard-actions.ts`, 'utf8');

  it('drops unknown metric ids on write as it already does for panels', () => {
    // The APPLICATION, not the import. Deleting the filter and leaving the
    // name in the import list passed the first version of this.
    expect(actions).toContain('.filter(isCounselMetricId)');
    expect(actions).toContain('.filter(isCounselTileId)');
  });

  it('leaves the panel selection alone when only figures were saved', () => {
    // Back-compat for any caller that still sends the old payload.
    expect(actions).toContain('input.hiddenMetrics === undefined');
  });

  it('filters the board and the panels through the viewer context', () => {
    expect(page).toContain('visibleMetricIds(');
    expect(page).toContain('offerablePanelIds(');
    // And the list it DRAWS is the filtered one. Calling the helper and
    // then rendering the raw saved list left this green, and would put an
    // always-empty Cases panel on a staff member's dashboard.
    const decl = /const visiblePanels = ([\s\S]*?);/.exec(page)?.[1] ?? '';
    expect(decl, 'visiblePanels was not found').not.toBe('');
    expect(decl, 'visiblePanels is not scoped to what the viewer can read')
      .toContain('offerablePanels');
    expect(page).toContain('{visiblePanels.map((id) => (');
  });

  it('applies the choice to the board before the board is drawn', () => {
    // Resolving the visible set and then handing the board every figure
    // anyway is a switch that moves nothing, and it passed everything else
    // in this file. The band drop is the second half: a band whose every
    // figure is off has to go with its heading, not leave a title over an
    // empty row.
    const build = page.slice(
      page.indexOf('const metricBands ='),
      page.indexOf('const data:'),
    );
    expect(build.length, 'the board build was not found').toBeGreaterThan(0);
    expect(
      /metrics: band\.metrics\.filter\(\(\w+\) => metricsOn\.has\(/.test(build),
      'the board is handed figures the user switched off',
    ).toBe(true);
    expect(
      /\.filter\(\(band\) => band\.metrics\.length > 0\)/.test(build),
      'an emptied band keeps its heading',
    ).toBe(true);
  });

  it('says something rather than nothing when everything is hidden', () => {
    // A dashboard with every figure and every panel off still has to be a
    // page. The empty state is the thing that makes it one, and it only
    // fires when BOTH halves are empty - it used to fire on the panels
    // alone, so a full board could sit above the words "your dashboard is
    // empty".
    const guard = /visibleMetrics\.length === 0 && visiblePanels\.length === 0/;
    expect(guard.test(page)).toBe(true);
    const emptyState = /<EmptyState[\s\S]*?\/>/.exec(page)?.[0] ?? '';
    expect(emptyState).toContain('Choose what you see');
  });
});

describe('every role in the product has an answer here', () => {
  it('decides for each firm role rather than defaulting the unknown', () => {
    for (const role of FIRM_ROLES) {
      const ctx: DashboardViewerContext = { role, hideTimeBilling: false };
      const offered = offerableMetricIds(ctx);
      expect(offered.length).toBeGreaterThan(0);
      const canReadMatters = (MATTER_READ_ROLES as readonly FirmRole[]).includes(
        role,
      );
      expect(offered.includes('matters-stale')).toBe(canReadMatters);
    }
  });

  it('keeps the panel catalog and the metric catalog apart', () => {
    const panelIds = new Set(COUNSEL_TILES.map((t) => t.id as string));
    for (const m of COUNSEL_METRICS) {
      expect(panelIds.has(m.id)).toBe(false);
    }
  });
});
