import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * "The consumer was notified. We will let you know if they accept."
 *
 * Both halves of that sentence hang off one nullable column.
 * respondToLeadAction notifies only when `firm_leads.user_id` is set, and
 * acceptFirmAction refuses unless `lead.user_id === user.id`. Anonymous
 * leads are a supported path - lib/marketplace-actions.ts creates them with
 * `user_id: user?.id ?? null` from an unauthenticated form - so for a real
 * share of leads nobody is notified and nobody can accept.
 *
 * The firm-side readout did not select the column at all, so the panel could
 * not tell the two cases apart and said the same thing about both. This is
 * the one finding in this pass where the code was right and the words were
 * wrong: nothing here starts sending mail to an address the lead never
 * carried, it just stops claiming an outcome that did not happen.
 *
 * Mutations these are meant to catch:
 *   - drop `user_id` from LEAD_COLUMNS: the signed-in readout test goes red,
 *     because the fake projects and an unselected column comes back absent.
 *   - hardcode `hasConsumerAccount: true`: the anonymous readout test goes
 *     red.
 *   - remove the `lead.hasConsumerAccount` branch from either firm-facing
 *     screen: the copy tests go red.
 */

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  reset() {
    this.tables = { firms: [], firm_leads: [], firm_lead_responses: [] };
  },
}));

/**
 * A postgrest-js shaped fake, only as wide as listFirmLeadsForFirm needs.
 *
 * It PROJECTS: a column the query did not ask for does not come back, the
 * way PostgREST behaves. Without that a fake hands the caller every column
 * whatever it selected, and dropping `user_id` from the column list stays
 * green while the live readout reads undefined.
 */
class Q {
  private filters: Array<(r: Row) => boolean> = [];
  private cols: string[] | null = null;
  constructor(private table: string) {}
  private matched(): Row[] {
    const hits = (db.tables[this.table] ?? []).filter((r) =>
      this.filters.every((f) => f(r)),
    );
    const cols = this.cols;
    if (!cols) return hits;
    return hits.map((r) => {
      const out: Row = {};
      for (const c of cols) if (c in r) out[c] = r[c];
      return out;
    });
  }
  select(cols?: string) {
    if (cols && cols !== '*') {
      this.cols = cols.split(',').map((c) => c.trim());
    }
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
  db.tables.firms.push({
    id: 'firm-1',
    jurisdictions: ['US-CO'],
    practice_areas: ['employment'],
  });
});

function seedLead(over: Partial<Row> = {}) {
  db.tables.firm_leads.push({
    id: 'lead-1',
    user_id: null,
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
    ...over,
  });
}

const source = (rel: string) =>
  readFileSync(join(process.cwd(), rel), 'utf8');

describe('the firm-side readout carries whether anyone is behind the lead', () => {
  it('reports an anonymous lead as having no consumer account', async () => {
    seedLead({ user_id: null });

    const [lead] = await storage.listFirmLeadsForFirm('firm-1');

    expect(lead.hasConsumerAccount).toBe(false);
  });

  it('reports a signed-in consumer as having one', async () => {
    seedLead({ user_id: 'consumer-1' });

    const [lead] = await storage.listFirmLeadsForFirm('firm-1');

    expect(lead.hasConsumerAccount).toBe(true);
  });
});

describe('the firm-facing copy does not promise a notification nobody got', () => {
  it('guards the notified sentence on the flag', () => {
    const page = source('app/counsel/leads/[id]/page.tsx');

    // The claim is still made, and it is now reachable only through the flag.
    expect(page).toContain('The consumer was notified');
    expect(page).toContain('lead.hasConsumerAccount');
    const claimAt = page.indexOf('The consumer was notified');
    const guardAt = page.indexOf('lead.hasConsumerAccount ?');
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(claimAt);
    // And the anonymous branch says the true thing instead.
    expect(page).toContain('without an account behind it');
  });

  it('guards the inbox promise on the response form too', () => {
    // This one is read BEFORE the firm writes a fee proposal, so it is the
    // more useful of the two places to be honest in.
    const form = source('app/counsel/leads/[id]/lead-response-form.tsx');

    expect(form).toContain('hasConsumerAccount');
    expect(form).toContain('sees your response in their inbox');
    expect(form).toContain('there is no inbox to send');
    const guardAt = form.indexOf('hasConsumerAccount ?');
    const claimAt = form.indexOf('sees your response in their inbox');
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(claimAt);
  });
});
