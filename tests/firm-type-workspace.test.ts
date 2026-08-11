import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  GROWTH_HREFS,
  WORKSPACE_SURFACES,
  hiddenSurfacesForType,
  readSurfaceOverrides,
  resolveSurfaceHidden,
  surfaceDecision,
  type WorkspaceSurface,
} from '../lib/firm-workspace';
import {
  FIRM_VOCABULARY,
  firmVocabulary,
  menuLabelsForType,
} from '../lib/firm-vocabulary';
import { FIRM_TYPES, type FirmType } from '../lib/firm-types';
import {
  DEFAULT_MENU,
  TIME_BILLING_HREFS,
  applyMenuConfig,
  readMenuConfig,
  withTypeDefaults,
} from '../lib/menu-config';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/*
 * `firms.firm_type` was collected at onboarding and then never read again.
 * These tests are the claim that it now shapes the workspace, and - just as
 * load-bearing - the claim that it shapes it as a DEFAULT which an owner can
 * always override.
 */

describe('type-derived surface defaults', () => {
  it('hides money and inbound work for the two types that have neither', () => {
    expect(hiddenSurfacesForType('corporate')).toEqual(
      expect.arrayContaining(['timeBilling', 'growth']),
    );
    expect(hiddenSurfacesForType('government')).toEqual(
      expect.arrayContaining(['timeBilling', 'growth']),
    );
  });

  it('changes nothing for a law firm, a solo, or an unclassified workspace', () => {
    expect(hiddenSurfacesForType('firm')).toEqual([]);
    expect(hiddenSurfacesForType('individual')).toEqual([]);
    expect(hiddenSurfacesForType('other')).toEqual([]);
  });

  it('leaves legal aid alone, because a clinic does bill and does take referrals', () => {
    expect(hiddenSurfacesForType('legal_aid')).toEqual([]);
  });

  it('has an entry for every value the production CHECK constraint allows', () => {
    for (const t of FIRM_TYPES) {
      expect(Array.isArray(hiddenSurfacesForType(t))).toBe(true);
    }
  });
});

describe('an explicit override beats the type default, in both directions', () => {
  const corporate: FirmType = 'corporate';
  const lawFirm: FirmType = 'firm';

  it('shows billing to an in-house team that asked for it', () => {
    expect(
      resolveSurfaceHidden('timeBilling', corporate, { timeBilling: 'show' }, false),
    ).toBe(false);
  });

  it('hides billing from a law firm that asked for that', () => {
    expect(
      resolveSurfaceHidden('timeBilling', lawFirm, { timeBilling: 'hide' }, false),
    ).toBe(true);
  });

  it('shows leads to an in-house team that runs a panel of outside counsel', () => {
    expect(
      resolveSurfaceHidden('growth', corporate, { growth: 'show' }, false),
    ).toBe(false);
  });

  it('falls back to the type default when no override is stored', () => {
    expect(resolveSurfaceHidden('timeBilling', corporate, {}, false)).toBe(true);
    expect(resolveSurfaceHidden('timeBilling', lawFirm, {}, false)).toBe(false);
  });
});

describe('the legacy hide_time_billing column keeps every choice already made', () => {
  it('still hides Time and Billing for a law firm that switched it off', () => {
    expect(resolveSurfaceHidden('timeBilling', 'firm', {}, true)).toBe(true);
  });

  it('is a hide-only latch: it can never force a surface back on', () => {
    // `false` is what a firm that never touched the toggle stores, because the
    // column is NOT NULL DEFAULT false. It must not read as "show me billing".
    expect(resolveSurfaceHidden('timeBilling', 'corporate', {}, false)).toBe(true);
  });

  it('yields to an explicit show, which is the newer and more specific answer', () => {
    expect(
      resolveSurfaceHidden('timeBilling', 'firm', { timeBilling: 'show' }, true),
    ).toBe(false);
  });

  it('never reaches the growth surface, which it was never about', () => {
    expect(resolveSurfaceHidden('growth', 'firm', {}, true)).toBe(false);
  });
});

describe('the settings UI can say which answer is in force', () => {
  it('names the default when nothing was overridden', () => {
    expect(surfaceDecision('timeBilling', 'corporate', {}, false)).toEqual({
      hidden: true,
      source: 'type',
    });
  });

  it('names the override when one was stored', () => {
    expect(
      surfaceDecision('timeBilling', 'corporate', { timeBilling: 'show' }, false),
    ).toEqual({ hidden: false, source: 'override' });
  });

  it('names the legacy toggle so an owner can find why billing vanished', () => {
    expect(surfaceDecision('timeBilling', 'firm', {}, true)).toEqual({
      hidden: true,
      source: 'legacy',
    });
  });
});

describe('reading overrides out of firms.metadata is defensive', () => {
  it('ignores null, a string, and an array', () => {
    expect(readSurfaceOverrides(null)).toEqual({});
    expect(readSurfaceOverrides('corporate')).toEqual({});
    expect(readSurfaceOverrides({ surfaceOverrides: ['timeBilling'] })).toEqual({});
  });

  it('ignores a surface it does not know and a value it does not know', () => {
    expect(
      readSurfaceOverrides({
        surfaceOverrides: { timeBilling: 'maybe', invented: 'hide', growth: 'hide' },
      }),
    ).toEqual({ growth: 'hide' });
  });

  it('reads the two real surfaces', () => {
    expect(
      readSurfaceOverrides({
        surfaceOverrides: { timeBilling: 'show', growth: 'hide' },
      }),
    ).toEqual({ timeBilling: 'show', growth: 'hide' });
  });
});

describe('every surface maps onto hrefs that actually exist in the rail', () => {
  const known = new Set(DEFAULT_MENU.flatMap((s) => s.items.map((i) => i.href)));

  it('names only real destinations', () => {
    for (const href of [...TIME_BILLING_HREFS, ...GROWTH_HREFS]) {
      expect(known.has(href)).toBe(true);
    }
  });

  it('covers Leads and Referrals, and nothing else', () => {
    expect([...GROWTH_HREFS].sort()).toEqual([
      '/counsel/leads',
      '/counsel/referrals',
    ]);
  });

  it('lists exactly the surfaces the resolver knows about', () => {
    expect([...WORKSPACE_SURFACES].sort()).toEqual(['growth', 'timeBilling']);
  });
});

describe('the vocabulary layer', () => {
  it('calls the people an in-house team helps employees, not clients', () => {
    expect(firmVocabulary('corporate').client).toBe('Employee');
    expect(firmVocabulary('corporate').clients).toBe('Employees');
  });

  it('leaves every other type on the ordinary words', () => {
    for (const t of FIRM_TYPES.filter((x) => x !== 'corporate')) {
      expect(firmVocabulary(t).client).toBe('Client');
      expect(firmVocabulary(t).clients).toBe('Clients');
    }
  });

  it('says work arrives as a request, not an intake', () => {
    expect(firmVocabulary('corporate').intake).toBe('New request');
    expect(firmVocabulary('firm').intake).toBe('New intake');
  });

  it('says business areas rather than practice areas', () => {
    expect(firmVocabulary('corporate').practiceAreas).toBe('Business areas');
    expect(firmVocabulary('firm').practiceAreas).toBe('Practice areas');
  });

  it('gives every type in the CHECK constraint a complete vocabulary', () => {
    const keys = Object.keys(FIRM_VOCABULARY.firm).sort();
    for (const t of FIRM_TYPES) {
      expect(Object.keys(firmVocabulary(t)).sort()).toEqual(keys);
      for (const v of Object.values(firmVocabulary(t))) {
        expect(typeof v).toBe('string');
        expect(v.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('menu labels come out of the vocabulary, not out of ternaries', () => {
  it('renames Clients and Employees for an in-house team, with no collision', () => {
    const labels = menuLabelsForType('corporate');
    expect(labels['/counsel/clients']).toBe('Employees');
    expect(labels['/counsel/employees']).toBe('Directory');
    const values = Object.values(labels);
    expect(new Set(values).size).toBe(values.length);
  });

  it('renames nothing for a law firm', () => {
    expect(menuLabelsForType('firm')).toEqual({});
    expect(menuLabelsForType('individual')).toEqual({});
    expect(menuLabelsForType('legal_aid')).toEqual({});
  });

  it('only ever names hrefs the rail actually has', () => {
    const known = new Set(DEFAULT_MENU.flatMap((s) => s.items.map((i) => i.href)));
    for (const t of FIRM_TYPES) {
      for (const href of Object.keys(menuLabelsForType(t))) {
        expect(known.has(href)).toBe(true);
      }
    }
  });

  it('stays inside the 40-character cap readMenuConfig enforces on a stored label', () => {
    for (const t of FIRM_TYPES) {
      for (const label of Object.values(menuLabelsForType(t))) {
        expect(label.length).toBeLessThanOrEqual(40);
      }
    }
  });
});

describe('withTypeDefaults folds type into the menu config the rail already reads', () => {
  const base = readMenuConfig(null);

  it('drops Finance and Growth entirely for an in-house team', () => {
    const sections = applyMenuConfig(
      withTypeDefaults(base, 'corporate', { timeBilling: true, growth: true }),
    );
    const hrefs = sections.flatMap((s) => s.items.map((i) => i.href));
    for (const h of [...TIME_BILLING_HREFS, ...GROWTH_HREFS]) {
      expect(hrefs).not.toContain(h);
    }
    // A section whose every item went is dropped, so the labels go too.
    expect(sections.map((s) => s.section)).not.toContain('Finance');
    expect(sections.map((s) => s.section)).not.toContain('Growth');
  });

  it('keeps them when the owner overrode the default back to shown', () => {
    const sections = applyMenuConfig(
      withTypeDefaults(base, 'corporate', { timeBilling: false, growth: false }),
    );
    const hrefs = sections.flatMap((s) => s.items.map((i) => i.href));
    for (const h of [...TIME_BILLING_HREFS, ...GROWTH_HREFS]) {
      expect(hrefs).toContain(h);
    }
  });

  it('applies the vocabulary to the labels the rail renders', () => {
    const sections = applyMenuConfig(
      withTypeDefaults(base, 'corporate', { timeBilling: true, growth: true }),
    );
    const byHref = new Map(
      sections.flatMap((s) => s.items.map((i) => [i.href, i.label] as const)),
    );
    expect(byHref.get('/counsel/clients')).toBe('Employees');
    expect(byHref.get('/counsel/employees')).toBe('Directory');
  });

  it("never overwrites a label the firm chose for itself", () => {
    const own = readMenuConfig({
      menuConfig: { labels: { '/counsel/clients': 'Our people' } },
    });
    const merged = withTypeDefaults(own, 'corporate', {
      timeBilling: true,
      growth: true,
    });
    expect(merged.labels['/counsel/clients']).toBe('Our people');
    // and still applies the derived label where the firm said nothing
    expect(merged.labels['/counsel/employees']).toBe('Directory');
  });

  it('leaves a law firm byte-identical to what it renders today', () => {
    expect(
      withTypeDefaults(base, 'firm', { timeBilling: false, growth: false }),
    ).toEqual(base);
  });
});

describe('hiding is not cosmetic: the server refuses too', () => {
  const growthPages = [
    'app/counsel/leads/page.tsx',
    'app/counsel/leads/[id]/page.tsx',
    'app/counsel/referrals/page.tsx',
    'app/counsel/referrals/[id]/page.tsx',
    'app/counsel/referrals/new/page.tsx',
  ];

  it.each(growthPages)('%s turns a reader away when Growth is hidden', (p) => {
    const src = read(p);
    expect(src).toContain('hideGrowth');
    expect(src).toMatch(/redirect\('\/counsel'\)/);
  });

  const guardedActions: Array<[string, string[]]> = [
    [
      'lib/cocounsel-actions.ts',
      ['proposeReferralAction', 'respondToReferralAction', 'recordReferralPaymentAction'],
    ],
    ['lib/lead-conversion.ts', ['convertLeadToCaseAction']],
    ['lib/marketplace-actions.ts', ['respondToLeadAction']],
    [
      'lib/time-tracking.ts',
      [
        'setFirmMemberRateAction',
        'startTimerAction',
        'stopTimerAction',
        'logManualEntryAction',
        'assignTimeEntryToCaseAction',
      ],
    ],
    [
      'lib/trust-accounting.ts',
      [
        'createTrustAccountAction',
        'recordTrustTransactionAction',
        'createTrustReconciliationAction',
      ],
    ],
    [
      'lib/invoicing.ts',
      [
        'buildDraftInvoiceAction',
        'sendInvoiceAction',
        'voidInvoiceAction',
        'deleteDraftInvoiceAction',
      ],
    ],
  ];

  /*
   * Every 'use server' export is a public HTTP endpoint. A hidden rail item is
   * a display choice; it stops nobody from POSTing to the action behind it.
   * This asserts each mutating action calls the surface guard, by reading the
   * body between its signature and the next top-level export.
   */
  it.each(guardedActions)('%s guards its writes', (file, actions) => {
    const src = read(file);
    expect(src).toContain('firm-surface-guard');
    for (const name of actions) {
      const start = src.indexOf(`export async function ${name}`);
      expect(start, `${name} not found in ${file}`).toBeGreaterThan(-1);
      const rest = src.slice(start + 1);
      const nextExport = rest.indexOf('\nexport ');
      const body = nextExport === -1 ? rest : rest.slice(0, nextExport);
      expect(body, `${name} in ${file} does not call the surface guard`).toMatch(
        /surfaceRefusal|requireFirmSurface/,
      );
    }
  });

  /*
   * The deliberate exceptions, asserted so that "we chose not to" cannot decay
   * into "we forgot to". Money that already moved has to stay recordable, and
   * a member of the public filing a request must not be broken by a firm's
   * display choice.
   */
  it('does not refuse a payment that has already arrived', () => {
    const src = read('lib/invoicing.ts');
    const start = src.indexOf('export async function markInvoicePaidAction');
    const body = src.slice(start).split('\nexport ')[0];
    expect(body).not.toMatch(/surfaceRefusal/);
    expect(src).toMatch(/markInvoicePaidAction is deliberately NOT guarded/);
  });

  it('does not refuse the consumer-side marketplace submission', () => {
    const src = read('lib/marketplace-actions.ts');
    const start = src.indexOf('export async function submitFirmLeadAction');
    const body = src.slice(start).split('\nexport ')[0];
    expect(body).not.toMatch(/surfaceRefusal/);
  });

  it('leaves every READ open, so switching type never puts data out of reach', () => {
    // Hiding is not purging. listTimeEntriesForCase / listOpenTimer are the
    // read pair in the module with the most guards on it; neither may acquire
    // one, or an in-house team's existing ledger becomes unreachable.
    const src = read('lib/time-tracking.ts');
    for (const name of ['listTimeEntriesForCase', 'listOpenTimer']) {
      const start = src.indexOf(`export async function ${name}`);
      const body = src.slice(start).split('\nexport ')[0];
      expect(body, `${name} must not be gated on the surface`).not.toMatch(
        /surfaceRefusal/,
      );
    }
  });
});

describe('the type can be changed after onboarding, by an owner or admin', () => {
  const actions = read('lib/firm-settings-actions.ts');

  it('has a write for it at all, which is the whole defect', () => {
    expect(actions).toContain('export async function updateFirmTypeAction');
  });

  it('is gated on owner/admin, not merely on being signed in', () => {
    const body = actions
      .slice(actions.indexOf('export async function updateFirmTypeAction'))
      .split('\nexport ')[0];
    expect(body).toContain('callerIsFirmAdmin');
    expect(body).toContain('requireUser');
  });

  it('refuses a value the production CHECK constraint would refuse', () => {
    const body = actions
      .slice(actions.indexOf('export async function updateFirmTypeAction'))
      .split('\nexport ')[0];
    expect(body).toContain('FIRM_TYPES.includes');
  });

  it('busts the whole shell, because the type decides the rail and the words', () => {
    const body = actions
      .slice(actions.indexOf('export async function updateFirmTypeAction'))
      .split('\nexport ')[0];
    expect(body).toContain("revalidatePath('/counsel', 'layout')");
  });

  it('never touches a row of firm data: it writes firm_type and nothing else', () => {
    const body = actions
      .slice(actions.indexOf('export async function updateFirmTypeAction'))
      .split('\nexport ')[0];
    expect(body).not.toMatch(/\.delete\(\)/);
    expect(body).toMatch(/from\('firms'\)/);
    for (const table of [
      'firm_invoices',
      'firm_time_entries',
      'firm_trust_transactions',
      'firm_leads',
      'cocounsel_referrals',
    ]) {
      expect(body, `changing type must not touch ${table}`).not.toContain(table);
    }
  });
});

describe('the override write', () => {
  const actions = read('lib/firm-settings-actions.ts');
  const body = actions
    .slice(actions.indexOf('export async function updateFirmSurfaceOverrideAction'))
    .split('\nexport ')[0];

  it('exists and is owner/admin gated', () => {
    expect(body).toContain('callerIsFirmAdmin');
  });

  it('validates the surface name and the choice, both caller-supplied', () => {
    expect(body).toContain('WORKSPACE_SURFACES.includes');
    expect(body).toMatch(/choice !== 'show' && choice !== 'hide' && choice !== 'default'/);
  });

  it('clears the legacy latch when the owner asks for the default back', () => {
    // Otherwise "workspace default" would be selected and the surface would
    // stay hidden, which is the control lying about what it did.
    expect(body).toContain('hide_time_billing: false');
  });

  it('leaves the surface toggle action writing only hide_search', () => {
    const legacy = actions
      .slice(actions.indexOf('export async function updateFirmSurfaceSettingsAction'))
      .split('\nexport ')[0];
    expect(legacy).toContain('hide_search');
    expect(
      legacy,
      'two writers for one column is how the checkbox and the override drift apart',
    ).not.toContain('hide_time_billing:');
  });
});

describe('the settings page shows which answer is in force', () => {
  it('hands the control the type, both surfaces, and where each came from', () => {
    const ui = read('app/counsel/settings/firm-surface-toggles.tsx');
    expect(ui).toContain('firmType');
    expect(ui).toContain('hideGrowth');
    expect(ui).toContain('SurfaceSource');
    // Three states, not a checkbox: "hidden" and "hidden because that is the
    // default for an in-house team" are different facts.
    expect(ui).toMatch(/value="default"/);
    expect(ui).toMatch(/value="show"/);
    expect(ui).toMatch(/value="hide"/);
  });

  it('says out loud that hiding a surface deletes nothing', () => {
    const ui = read('app/counsel/settings/firm-surface-toggles.tsx');
    expect(ui.replace(/\s+/g, ' ')).toMatch(
      /does not delete anything already filed there/,
    );
  });
});

describe('the dashboard and Reports are relevant to the kind of team reading them', () => {
  it('calls the people on the client tile what this kind of team calls them', () => {
    const src = read('app/counsel/page.tsx');
    expect(src).toContain('firmVocabulary');
    expect(src).toContain('<T>{vocab.clients}</T>');
    expect(src, 'the hardcoded noun is the owner’s actual complaint').not.toContain(
      '<T>Active clients</T>',
    );
  });

  /*
   * docs/TECHOTTIC-PARITY-ADDENDUM.md: a metric a firm cannot compute honestly
   * does not get a tile. The money figures on both pages were already gated on
   * hideTimeBilling, which now resolves from the type, so an in-house team gets
   * no invoice tile rather than a tile reading zero. This asserts that gate is
   * still the only thing standing between them.
   */
  it('computes no money figure for a team that has no billing surface', () => {
    const data = read('lib/counsel-reports-data.ts');
    for (const table of ['firm_invoices', 'firm_time_entries']) {
      const at = data.indexOf(`.from('${table}')`);
      expect(at).toBeGreaterThan(-1);
      // The gate sits immediately above each of these reads.
      expect(data.slice(Math.max(0, at - 400), at)).toContain(
        'input.hideTimeBilling',
      );
    }
  });

  it('resolves the surface from the firm it already holds, not a second read', () => {
    for (const p of [
      'app/counsel/page.tsx',
      'app/counsel/reports/page.tsx',
      'app/counsel/my/page.tsx',
      'app/counsel/settings/page.tsx',
    ]) {
      expect(read(p)).toContain('getFirmSurfaceSettings(ctx.firm.id, ctx.firm)');
    }
  });
});

describe('the counsel shell resolves the type once and hands it to both navs', () => {
  const layout = read('app/counsel/layout.tsx');

  it('folds the type into the menu config the rail and the mobile nav read', () => {
    expect(layout).toContain('withTypeDefaults');
    expect(layout).toContain('readMenuConfig');
  });

  it('gives the resolved firm to the header AND the sidebar, not just one', () => {
    // Two navs rendering two different menus is the exact failure this seam
    // exists to prevent.
    expect(layout.match(/shellFirm/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(layout).toMatch(/firm=\{shellFirm\}/);
    expect(layout).toMatch(/firm=\{shellFirm \?\? active\.firm\}/);
  });
});
