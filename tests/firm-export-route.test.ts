import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The organization export, GET /api/firm/export.
 *
 * This route is the whole "you can still get your data" half of the trial
 * design: nothing is deleted when a trial ends, and this is how an
 * organization takes a copy. Three properties are load-bearing and are what
 * these tests hold down.
 *
 *   1. Owner and admin only. The archive holds every matter, document record
 *      and client name the organization has.
 *   2. It works while the organization is export_only. An expired or suspended
 *      organization must still reach its own records, so the route must not
 *      consult access state at all.
 *   3. Every export is audited, once, before the bytes go out.
 *
 * Plus the thing that separates a real export from a demo one: a table with
 * more than one PostgREST page of rows must come back whole.
 *
 * The real lib/firm-authz.ts runs here. Only the two Supabase clients and the
 * audit sink are stood in for, so the role decision under test is the one the
 * product actually makes.
 */

// ── In-memory stand-in for Postgres ────────────────────────────────────────
type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  /** The signed-in user, as lib/supabase/server would report them. */
  user: { id: 'user-owner', email: 'owner@example.com' } as {
    id: string;
    email: string;
  } | null,
  tables: {} as Record<string, Row[]>,
  reset() {
    this.user = { id: 'user-owner', email: 'owner@example.com' };
    this.tables = {
      firm_members: [
        { id: 'm1', firm_id: 'firm-1', user_id: 'user-owner', role: 'owner' },
        {
          id: 'm2',
          firm_id: 'firm-1',
          user_id: 'user-paralegal',
          role: 'paralegal',
        },
        { id: 'm3', firm_id: 'firm-2', user_id: 'user-other', role: 'owner' },
      ],
      firms: [
        {
          id: 'firm-1',
          name: 'Hale & Rowe',
          slug: 'hale-rowe',
          firm_type: 'firm',
          created_at: '2026-01-04T00:00:00.000Z',
          // Long expired AND suspended. The export must not care.
          trial_ends_at: '2026-02-01T00:00:00.000Z',
          suspended_at: '2026-03-01T00:00:00.000Z',
        },
      ],
      cases: [
        { id: 'c1', firm_id: 'firm-1', title: 'Ours' },
        { id: 'c2', firm_id: 'firm-2', title: 'Someone else' },
      ],
      firm_documents: [
        { id: 'd1', firm_id: 'firm-1', name: 'Retainer.pdf' },
        { id: 'd2', firm_id: 'firm-2', name: 'Not ours.pdf' },
      ],
    };
  },
}));

/**
 * A chainable stand-in supporting exactly the calls the route and
 * lib/firm-authz.ts make: select/eq/order/range/maybeSingle, awaited directly.
 * `range` enforces the same 1000-row ceiling PostgREST does, so a route that
 * forgets to page fails here the way it would fail in production.
 */
class Query {
  private rows: Row[];
  constructor(table: string) {
    this.rows = [...(db.tables[table] ?? [])];
  }
  select() {
    return this;
  }
  eq(col: string, val: unknown) {
    this.rows = this.rows.filter((r) => r[col] === val);
    return this;
  }
  order(col: string) {
    this.rows = [...this.rows].sort((a, b) =>
      String(a[col]).localeCompare(String(b[col])),
    );
    return this;
  }
  range(from: number, to: number) {
    const capped = Math.min(to, from + 999);
    return Promise.resolve({
      data: this.rows.slice(from, capped + 1),
      error: null,
    });
  }
  maybeSingle() {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null });
  }
  then(resolve: (v: { data: Row[]; error: null }) => unknown) {
    return Promise.resolve({ data: this.rows, error: null }).then(resolve);
  }
}

const client = { from: (table: string) => new Query(table) };

vi.mock('@/lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  getCurrentUser: async () => db.user,
  getRealCurrentUser: async () => db.user,
  createServerSupabase: () => client,
  getSupabaseUrl: () => 'https://example.supabase.co',
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => client,
}));

// The active-organization pointer. The route falls back to this when no
// firmId is supplied.
vi.mock('@/lib/firm-storage', () => ({
  getActiveFirmContext: async () =>
    db.user ? { firm: { id: 'firm-1', slug: 'hale-rowe' } } : null,
}));

const logSecurityEvent = vi.hoisted(() =>
  vi.fn(
    async (_event: {
      kind: string;
      userId?: string | null;
      details?: Record<string, unknown>;
    }) => {},
  ),
);
vi.mock('@/lib/security-audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security-audit')>();
  return { ...actual, logSecurityEvent };
});

import { GET } from '@/app/api/firm/export/route';

const request = (url = 'https://app.advottic.com/api/firm/export') =>
  new Request(url, { headers: { 'user-agent': 'vitest' } });

async function archiveOf(res: Response) {
  return JSON.parse(await res.text()) as {
    _meta: { organization: { id: string }; format: string };
    data: Record<string, Row[]>;
    _summary: { tables: Record<string, number>; complete: boolean };
  };
}

beforeEach(() => {
  db.reset();
  logSecurityEvent.mockClear();
});

describe('organization export authorization', () => {
  it('gives a signed-out caller nothing', async () => {
    db.user = null;
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(logSecurityEvent).not.toHaveBeenCalled();
  });

  it('refuses a paralegal, who is a member but not an admin', async () => {
    db.user = { id: 'user-paralegal', email: 'para@example.com' };
    const res = await GET(request());
    expect(res.status).toBe(403);
    expect(logSecurityEvent).not.toHaveBeenCalled();
  });

  it('refuses an organization the caller does not belong to', async () => {
    const res = await GET(
      request('https://app.advottic.com/api/firm/export?firmId=firm-2'),
    );
    expect(res.status).toBe(403);
  });

  it('lets the owner through', async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('hale-rowe');
  });
});

describe('organization export content', () => {
  it('carries the caller organization rows and no other organization rows', async () => {
    const archive = await archiveOf(await GET(request()));
    expect(archive._meta.organization.id).toBe('firm-1');
    expect(archive.data.cases.map((c) => c.id)).toEqual(['c1']);
    expect(archive.data.firm_documents.map((d) => d.id)).toEqual(['d1']);
    expect(archive._summary.complete).toBe(true);
    expect(archive._summary.tables.cases).toBe(1);
  });

  it('pages past the 1000-row response ceiling', async () => {
    db.tables.firm_documents = Array.from({ length: 2400 }, (_, i) => ({
      id: `doc-${String(i).padStart(5, '0')}`,
      firm_id: 'firm-1',
    }));
    const archive = await archiveOf(await GET(request()));
    expect(archive.data.firm_documents).toHaveLength(2400);
    expect(archive._summary.tables.firm_documents).toBe(2400);
  });

  it('says nothing about the organization data being deleted', async () => {
    const body = await (await GET(request())).text();
    expect(body.toLowerCase()).not.toMatch(/delet|erase|purge|removed after/);
  });
});

describe('the export is exempt from the access gate', () => {
  /**
   * The organization in the fixture is both expired and suspended, which is
   * every way an organization can be export_only. If a future change makes
   * this route consult access state, this is the test that fails.
   */
  it('exports an expired and suspended organization', async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    const archive = await archiveOf(res);
    expect(archive._summary.complete).toBe(true);
    expect(archive.data.cases).toHaveLength(1);
  });
});

describe('the export is audited', () => {
  it('logs one data_exported event before the transfer, naming the organization', async () => {
    const res = await GET(request());
    // Logged at authorization time, not on completion: a download the client
    // abandons still handed out rows.
    expect(logSecurityEvent).toHaveBeenCalledTimes(1);
    const event = logSecurityEvent.mock.calls[0][0];
    expect(event.kind).toBe('data_exported');
    expect(event.userId).toBe('user-owner');
    expect(event.details?.scope).toBe('organization');
    expect(event.details?.firmId).toBe('firm-1');
    await res.text();
  });
});
