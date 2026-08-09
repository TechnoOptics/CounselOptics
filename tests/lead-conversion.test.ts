import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * An accepted lead must have an exit into a matter, and the exit must be safe
 * to press twice.
 *
 * Two defects are pinned here, and they compound.
 *
 * 1. acceptFirmAction writes `firm_leads.status = 'closed'` at the moment it
 *    writes the `accepted` response, and listFirmLeadsForFirm read only
 *    `open` and `matched`. So the firm-side page 404'd on exactly the leads
 *    the firm had won, while the same action was sending its members a
 *    notification linking to it.
 *
 * 2. There was no conversion at all: a mailto: and a tel: link, and the client,
 *    summary and jurisdiction re-keyed by hand.
 *
 * Mutations these are meant to catch, each applied and watched go red:
 *   - narrow the accepted read back to open/matched -> "reads back a lead this
 *     firm was accepted on" goes red.
 *   - delete the `response_type !== 'accepted'` refusal -> "refuses a firm the
 *     consumer did not choose" goes red.
 *   - delete the `if (link.caseId) return` early exit -> "opens one matter, not
 *     one per press" goes red.
 *   - delete the `!link.supported` refusal -> "refuses when the lead cannot be
 *     linked" goes red.
 *   - delete the zero-row check after the link update -> "reports a link that
 *     wrote nothing" goes red.
 *
 * Every neighbouring gate is held OPEN in the fakes (membership, active firm,
 * session), so the only thing that can refuse is the thing under test.
 */

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  /** Simulates the pre-migration deployment: firm_leads has no case_id. */
  missingCaseIdColumn: false,
  /** Simulates an UPDATE whose filter matched no row at all. */
  updateMatchesNothing: false,
  /** Every row the code inserted, so a duplicate matter is visible. */
  inserted: [] as Array<{ table: string; row: Row }>,
  seq: 0,
  reset() {
    this.tables = { firm_leads: [], firm_lead_responses: [], firms: [], cases: [] };
    this.missingCaseIdColumn = false;
    this.updateMatchesNothing = false;
    this.inserted = [];
    this.seq = 0;
  },
}));

/**
 * A postgrest-js shaped fake. Faithful on the two points the code depends on:
 * a select naming a column the table does not have fails with an error and no
 * data, and an update that matches nothing resolves clean with an empty array.
 */
class Q {
  private mode: 'select' | 'insert' | 'update' = 'select';
  private cols = '*';
  private patch: Row | null = null;
  private pending: Row | null = null;
  private filters: Array<(r: Row) => boolean> = [];
  constructor(private table: string) {}
  private matched(): Row[] {
    return (db.tables[this.table] ?? []).filter((r) =>
      this.filters.every((f) => f(r)),
    );
  }
  select(cols = '*') {
    this.cols = cols;
    return this;
  }
  insert(row: Row) {
    this.mode = 'insert';
    this.pending = row;
    return this;
  }
  update(patch: Row) {
    this.mode = 'update';
    this.patch = patch;
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
  limit(n: number) {
    const keep = this.matched().slice(0, n);
    this.filters.push((r) => keep.includes(r));
    return this;
  }
  private settle(): { data: unknown; error: { message: string } | null } {
    if (this.mode === 'insert') {
      const row = { id: `row-${++db.seq}`, ...(this.pending ?? {}) };
      (db.tables[this.table] ??= []).push(row);
      db.inserted.push({ table: this.table, row });
      return { data: row, error: null };
    }
    if (db.missingCaseIdColumn && this.cols.includes('case_id')) {
      return {
        data: null,
        error: { message: 'column firm_leads.case_id does not exist' },
      };
    }
    const hit = this.matched();
    if (this.mode === 'update') {
      // A zero-row UPDATE: postgrest-js reports no error, only an empty set.
      if (db.updateMatchesNothing) return { data: [], error: null };
      for (const r of hit) Object.assign(r, this.patch);
      return { data: hit, error: null };
    }
    return { data: hit, error: null };
  }
  maybeSingle() {
    const r = this.settle();
    const data = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
    return Promise.resolve({ data, error: r.error });
  }
  single() {
    return this.maybeSingle();
  }
  then<T>(resolve: (v: { data: unknown; error: unknown }) => T) {
    return Promise.resolve(this.settle()).then(resolve);
  }
}

const admin = { from: (table: string) => new Q(table) };

const gates = vi.hoisted(() => ({ hasRole: true }));

vi.mock('../lib/supabase/admin', () => ({ createAdminSupabase: () => admin }));
vi.mock('../lib/supabase/server', () => ({
  getCurrentUser: async () => ({ id: 'member-1', email: 'a@example.com' }),
}));
// Neighbouring gates, held OPEN by default so only the checks under test can
// refuse. `hasRole` is flipped by the one test that is about the role gate.
vi.mock('../lib/firm-authz', () => ({
  FIRM_POSTING_ROLES: ['owner', 'admin', 'attorney', 'paralegal'],
  callerHasFirmRole: async () => gates.hasRole,
  requireActiveFirm: async () => undefined,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

let convert: typeof import('../lib/lead-conversion');
let storage: typeof import('../lib/marketplace-storage');

beforeEach(async () => {
  db.reset();
  gates.hasRole = true;
  vi.resetModules();
  convert = await import('../lib/lead-conversion');
  storage = await import('../lib/marketplace-storage');
});

function seedAcceptedLead() {
  db.tables.firms.push({
    id: 'firm-1',
    jurisdictions: ['TX'],
    practice_areas: ['employment'],
  });
  db.tables.firm_leads.push({
    id: 'lead-1',
    contact_name: 'Dana Reyes',
    contact_email: 'dana@example.com',
    contact_phone: '555-0100',
    jurisdiction_state: 'CA',
    practice_areas: ['landlord'],
    summary: 'Deposit withheld after move-out.',
    budget: null,
    urgency: 'normal',
    // acceptFirmAction closes the lead in the same breath as accepting.
    status: 'closed',
    created_at: '2026-08-01T00:00:00Z',
    case_id: null,
  });
  db.tables.firm_lead_responses.push({
    lead_id: 'lead-1',
    firm_id: 'firm-1',
    response_type: 'accepted',
    proposed_fee: null,
    message: null,
    created_at: '2026-08-02T00:00:00Z',
  });
}

describe('an accepted lead stays reachable', () => {
  it('reads back a lead this firm was accepted on, though it is closed and off-match', async () => {
    // Neither the state (CA vs TX) nor the practice area (landlord vs
    // employment) matches this firm's preferences any more. The acceptance is
    // what makes it readable.
    seedAcceptedLead();
    const leads = await storage.listFirmLeadsForFirm('firm-1');
    expect(leads.map((l) => l.id)).toEqual(['lead-1']);
    expect(leads[0]!.acceptedByConsumer).toBe(true);
    expect(leads[0]!.contactEmail).toBe('dana@example.com');
  });

  it('still hides a closed lead this firm was never accepted on', async () => {
    seedAcceptedLead();
    db.tables.firm_lead_responses[0]!.response_type = 'interested';
    expect(await storage.listFirmLeadsForFirm('firm-1')).toEqual([]);
  });
});

describe('convertLeadToCaseAction', () => {
  it('opens a matter carrying the lead"s facts, and links it back', async () => {
    seedAcceptedLead();
    const res = await convert.convertLeadToCaseAction('firm-1', 'lead-1');
    expect(res.ok).toBe(true);
    const cases = db.tables.cases;
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      firm_id: 'firm-1',
      subject_name: 'Dana Reyes',
      description: 'Deposit withheld after move-out.',
      jurisdiction_state: 'CA',
    });
    expect(db.tables.firm_leads[0]!.case_id).toBe(res.caseId);
  });

  it('opens one matter, not one per press', async () => {
    seedAcceptedLead();
    const first = await convert.convertLeadToCaseAction('firm-1', 'lead-1');
    const second = await convert.convertLeadToCaseAction('firm-1', 'lead-1');
    expect(second.ok).toBe(true);
    expect(second.caseId).toBe(first.caseId);
    expect(db.inserted.filter((i) => i.table === 'cases')).toHaveLength(1);
  });

  it('refuses a firm the consumer did not choose', async () => {
    seedAcceptedLead();
    db.tables.firm_lead_responses[0]!.response_type = 'interested';
    const res = await convert.convertLeadToCaseAction('firm-1', 'lead-1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/chosen your firm/i);
    expect(db.tables.cases).toHaveLength(0);
  });

  it('refuses a caller who holds no posting role', async () => {
    seedAcceptedLead();
    gates.hasRole = false;
    const res = await convert.convertLeadToCaseAction('firm-1', 'lead-1');
    expect(res.ok).toBe(false);
    expect(db.tables.cases).toHaveLength(0);
  });

  it('refuses when the lead cannot be linked to a matter', async () => {
    seedAcceptedLead();
    db.missingCaseIdColumn = true;
    const res = await convert.convertLeadToCaseAction('firm-1', 'lead-1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/database update/i);
    expect(db.tables.cases).toHaveLength(0);
  });

  it('reports a link that wrote nothing, rather than claiming success', async () => {
    seedAcceptedLead();
    // The lead row is gone by the time the link is written, so the update
    // matches zero rows - which postgrest-js reports without an error.
    db.updateMatchesNothing = true;
    const res = await convert.convertLeadToCaseAction('firm-1', 'lead-1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/could not be linked/i);
  });

  it('leaves the control hidden when the link column is not there', async () => {
    seedAcceptedLead();
    db.missingCaseIdColumn = true;
    const leads = await storage.listFirmLeadsForFirm('firm-1');
    expect(leads[0]!.caseLink).toEqual({ supported: false });
  });
});
