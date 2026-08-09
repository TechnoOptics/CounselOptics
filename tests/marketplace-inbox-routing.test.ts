import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The firm-side inbox must decide who sees a lead by calling the shared
 * predicate, not by carrying its own copy of the rule.
 *
 * This guard exists because of a merge. `leadIsRoutedToFirm` was extracted so
 * the read path and the write path could never disagree about which consumers
 * a firm may reach; separately, and without knowledge of that extraction,
 * listFirmLeadsForFirm was restructured to also read back the leads a firm was
 * accepted on. The restructure carried the matching rule along inline, which
 * would have restored the duplication the extraction removed.
 *
 * The assertions below go through listFirmLeadsForFirm rather than calling the
 * predicate directly, which is the whole point: a test that calls
 * leadIsRoutedToFirm passes no matter what the inbox does. Only a test that
 * runs the inbox can notice the inbox growing its own rule.
 *
 * Mutations these are meant to catch:
 *   - reinstate the inline match without the `US-` strip -> "routes a lead to a
 *     firm whose jurisdiction carries the US- prefix" goes red.
 *   - reinstate the inline match without the lowercase fold on practice areas
 *     -> "matches a practice area case insensitively" goes red.
 *   - make the inline match unconditional -> "still withholds a lead from a
 *     firm in another state" goes red.
 */

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  reset() {
    this.tables = { firms: [], firm_leads: [], firm_lead_responses: [] };
  },
}));

/** A postgrest-js shaped fake, only as wide as listFirmLeadsForFirm needs. */
class Q {
  private filters: Array<(r: Row) => boolean> = [];
  constructor(private table: string) {}
  private matched(): Row[] {
    return (db.tables[this.table] ?? []).filter((r) =>
      this.filters.every((f) => f(r)),
    );
  }
  select() {
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  order() {
    return this;
  }
  maybeSingle() {
    return Promise.resolve({ data: this.matched()[0] ?? null, error: null });
  }
  then<T>(resolve: (v: { data: unknown; error: unknown }) => T) {
    return Promise.resolve({ data: this.matched(), error: null }).then(resolve);
  }
}

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => ({ from: (table: string) => new Q(table) }),
}));

let storage: typeof import('../lib/marketplace-storage');

beforeEach(async () => {
  db.reset();
  vi.resetModules();
  storage = await import('../lib/marketplace-storage');
});

/** One open lead, on offer to whichever firm the routing rule admits. */
function seedOpenLead(lead: Partial<Row> = {}) {
  db.tables.firm_leads.push({
    id: 'lead-1',
    contact_name: 'Dana Reyes',
    contact_email: 'dana@example.com',
    contact_phone: '555-0100',
    jurisdiction_state: 'CO',
    practice_areas: ['employment'],
    summary: 'Dismissed a week after raising a safety complaint.',
    budget: null,
    urgency: 'normal',
    status: 'open',
    created_at: '2026-08-01T00:00:00Z',
    case_id: null,
    ...lead,
  });
}

function seedFirm(firm: Partial<Row> = {}) {
  db.tables.firms.push({
    id: 'firm-1',
    jurisdictions: ['US-CO'],
    practice_areas: ['employment'],
    ...firm,
  });
}

describe('the firm inbox routes on the shared predicate', () => {
  it('routes a lead to a firm whose jurisdiction carries the US- prefix', async () => {
    // Firms store jurisdictions as ISO-3166-2 ("US-CO"); leads carry the bare
    // state ("CO"). The shared predicate strips the prefix. An inline copy that
    // forgets to would hide every lead from every firm onboarded that way.
    seedFirm({ jurisdictions: ['US-CO'] });
    seedOpenLead({ jurisdiction_state: 'CO' });
    const leads = await storage.listFirmLeadsForFirm('firm-1');
    expect(leads.map((l) => l.id)).toEqual(['lead-1']);
  });

  it('matches a practice area case insensitively', async () => {
    seedFirm({ practice_areas: ['Employment'] });
    seedOpenLead({ practice_areas: ['EMPLOYMENT'] });
    const leads = await storage.listFirmLeadsForFirm('firm-1');
    expect(leads.map((l) => l.id)).toEqual(['lead-1']);
  });

  it('still withholds a lead from a firm in another state', async () => {
    // Proves the two tests above are not passing because everything matches.
    seedFirm({ jurisdictions: ['US-CO'] });
    seedOpenLead({ jurisdiction_state: 'TX' });
    expect(await storage.listFirmLeadsForFirm('firm-1')).toEqual([]);
  });

  it('still withholds a lead outside the firm practice areas', async () => {
    seedFirm({ practice_areas: ['Employment'] });
    seedOpenLead({ practice_areas: ['patent'] });
    expect(await storage.listFirmLeadsForFirm('firm-1')).toEqual([]);
  });

  it('masks the contact channels until the consumer accepts', async () => {
    // The reason the routing rule matters: what it admits is unmasked by
    // acceptance, so a rule that is too generous leaks a stranger's details.
    seedFirm();
    seedOpenLead();
    const leads = await storage.listFirmLeadsForFirm('firm-1');
    expect(leads[0]!.acceptedByConsumer).toBe(false);
    expect(leads[0]!.contactEmail).toBeNull();
    expect(leads[0]!.contactPhone).toBeNull();
    expect(leads[0]!.contactNameMasked).toBe('Dana (masked)');
  });
});
