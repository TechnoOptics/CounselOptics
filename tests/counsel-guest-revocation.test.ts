import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Security-sensitive: case-scoped Counsel GUEST access must be strictly scoped,
 * fail closed, and be cut IMMEDIATELY + PERMANENTLY on revocation.
 *
 * These tests drive lib/counsel-guest.ts against an in-memory stand-in for the
 * service-role client, so we can assert the exact access decisions:
 *   - a firm member is never a guest,
 *   - a deactivated provisioned guest gets NO access (fail closed),
 *   - a co-counsel (attorney) collaborator gets scoped access to that matter,
 *   - removing the collaborator row revokes it, and orphaning a provisioned
 *     guest deactivates the whole firm-owned identity.
 */

// ── In-memory dataset the mock admin client reads/writes ────────────────────
type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  reset() {
    this.tables = {
      firm_members: [],
      firm_guest_accounts: [],
      case_collaborators: [],
      cases: [],
    };
  },
}));

// A tiny chainable query builder over db.tables that supports the exact calls
// lib/counsel-guest.ts makes: select/eq/in/not/limit/order + maybeSingle, plus
// being awaited directly (thenable) and update().eq().
class Query {
  private rows: Row[];
  private pending: Row | null = null;
  private op: 'select' | 'update' = 'select';
  constructor(private table: string) {
    this.rows = [...(db.tables[table] ?? [])];
  }
  select() {
    return this;
  }
  update(patch: Row) {
    this.op = 'update';
    this.pending = patch;
    return this;
  }
  insert() {
    return this;
  }
  eq(col: string, val: unknown) {
    if (this.op === 'update') {
      for (const r of db.tables[this.table] ?? []) {
        if (r[col] === val) Object.assign(r, this.pending);
      }
      return Promise.resolve({ data: null, error: null });
    }
    this.rows = this.rows.filter((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.rows = this.rows.filter((r) => vals.includes(r[col]));
    return this;
  }
  not(col: string, _op: string, _val: unknown) {
    // Only ever used as `.not('user_id', 'is', null)`.
    this.rows = this.rows.filter((r) => r[col] !== null && r[col] !== undefined);
    return this;
  }
  order() {
    return this;
  }
  limit(n: number) {
    this.rows = this.rows.slice(0, n);
    return this;
  }
  maybeSingle() {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null });
  }
  then<T>(resolve: (v: { data: Row[]; error: null }) => T) {
    return Promise.resolve({ data: this.rows, error: null }).then(resolve);
  }
}

const admin = {
  from(table: string) {
    return new Query(table);
  },
};

const session = vi.hoisted(() => ({ userId: 'guest-1', email: 'g@example.com' }));

vi.mock('../lib/supabase/server', () => ({
  getCurrentUser: async () => ({
    id: session.userId,
    email: session.email,
    user_metadata: {},
  }),
}));
vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => admin,
}));
vi.mock('../lib/firm-storage', () => ({
  getFirmById: async () => null,
}));

let mod: typeof import('../lib/counsel-guest');

beforeEach(async () => {
  db.reset();
  session.userId = 'guest-1';
  session.email = 'g@example.com';
  vi.resetModules();
  mod = await import('../lib/counsel-guest');
});

function seedAttorneyGuestOnCase() {
  db.tables.cases.push({ id: 'case-A', firm_id: 'firm-1' });
  db.tables.case_collaborators.push({
    id: 'collab-1',
    case_id: 'case-A',
    user_id: 'guest-1',
    role: 'attorney',
  });
}

describe('resolveGuestContextForUser', () => {
  const user = { id: 'guest-1', email: 'g@example.com', user_metadata: {} } as never;

  it('grants scoped access to an attorney collaborator who is not a firm member', async () => {
    seedAttorneyGuestOnCase();
    const ctx = await mod.resolveGuestContextForUser(user);
    expect(ctx).not.toBeNull();
    expect(ctx!.caseIds).toEqual(['case-A']);
    expect(mod.guestCanAccessCase(ctx!, 'case-A')).toBe(true);
    expect(mod.guestCanAccessCase(ctx!, 'case-OTHER')).toBe(false);
  });

  it('is NOT a guest when the user is a firm member', async () => {
    seedAttorneyGuestOnCase();
    db.tables.firm_members.push({ id: 'm1', user_id: 'guest-1', firm_id: 'firm-1' });
    expect(await mod.resolveGuestContextForUser(user)).toBeNull();
  });

  it('fails closed for a DEACTIVATED provisioned guest', async () => {
    seedAttorneyGuestOnCase();
    db.tables.firm_guest_accounts.push({
      id: 'ga-1',
      user_id: 'guest-1',
      firm_id: 'firm-1',
      must_change_password: false,
      deactivated_at: '2026-07-08T00:00:00Z',
    });
    expect(await mod.resolveGuestContextForUser(user)).toBeNull();
  });

  it('returns null once the attorney collaborator row is removed', async () => {
    seedAttorneyGuestOnCase();
    // Remove (revoke) the collaborator row.
    db.tables.case_collaborators = [];
    expect(await mod.resolveGuestContextForUser(user)).toBeNull();
  });

  it('constrains a provisioned guest to matters owned by their firm', async () => {
    // Guest is provisioned by firm-1 but mistakenly collaborator on firm-2's case.
    db.tables.cases.push({ id: 'case-X', firm_id: 'firm-2' });
    db.tables.case_collaborators.push({
      id: 'c-x',
      case_id: 'case-X',
      user_id: 'guest-1',
      role: 'attorney',
    });
    db.tables.firm_guest_accounts.push({
      id: 'ga-1',
      user_id: 'guest-1',
      firm_id: 'firm-1',
      must_change_password: false,
      deactivated_at: null,
    });
    const ctx = await mod.resolveGuestContextForUser(user);
    expect(ctx).not.toBeNull();
    expect(ctx!.caseIds).toEqual([]); // firm-2 case is not reachable
  });
});

describe('revokeGuestAccessOnRemoval', () => {
  it('deactivates a provisioned guest orphaned by removal', async () => {
    db.tables.firm_guest_accounts.push({
      id: 'ga-1',
      user_id: 'guest-1',
      firm_id: 'firm-1',
      must_change_password: false,
      deactivated_at: null,
    });
    // No remaining attorney collaborator rows (they were just removed).
    await mod.revokeGuestAccessOnRemoval({ userId: 'guest-1', firmId: 'firm-1' });
    expect(db.tables.firm_guest_accounts[0]!.deactivated_at).toBeTruthy();
  });

  it('leaves a multi-matter guest active (still on another matter)', async () => {
    db.tables.firm_guest_accounts.push({
      id: 'ga-1',
      user_id: 'guest-1',
      firm_id: 'firm-1',
      must_change_password: false,
      deactivated_at: null,
    });
    db.tables.case_collaborators.push({
      id: 'c-keep',
      case_id: 'case-B',
      user_id: 'guest-1',
      role: 'attorney',
    });
    await mod.revokeGuestAccessOnRemoval({ userId: 'guest-1', firmId: 'firm-1' });
    expect(db.tables.firm_guest_accounts[0]!.deactivated_at).toBeNull();
  });

  it('is a no-op for a pending (unlinked) invite', async () => {
    db.tables.firm_guest_accounts.push({
      id: 'ga-1',
      user_id: 'guest-1',
      firm_id: 'firm-1',
      must_change_password: false,
      deactivated_at: null,
    });
    await mod.revokeGuestAccessOnRemoval({ userId: null, firmId: 'firm-1' });
    expect(db.tables.firm_guest_accounts[0]!.deactivated_at).toBeNull();
  });
});

describe('guestPathAllowed (path scoping)', () => {
  const guest = {
    userId: 'guest-1',
    email: null,
    displayName: null,
    caseIds: ['case-A'],
    firm: null,
    firmId: 'firm-1',
    provisioned: true,
    mustChangePassword: false,
    guestAccountId: 'ga-1',
  };

  it('allows their matter and its subpages', () => {
    expect(mod.guestPathAllowed(guest, '/counsel/cases/case-A')).toBe(true);
    expect(mod.guestPathAllowed(guest, '/counsel/cases/case-A/timeline')).toBe(true);
    expect(mod.guestPathAllowed(guest, '/counsel/cases/case-A/evidence')).toBe(true);
    expect(mod.guestPathAllowed(guest, '/counsel/guest/profile')).toBe(true);
  });

  it('denies other matters and firm-wide surfaces', () => {
    expect(mod.guestPathAllowed(guest, '/counsel/cases/case-B')).toBe(false);
    expect(mod.guestPathAllowed(guest, '/counsel/cases/case-B/timeline')).toBe(false);
    expect(mod.guestPathAllowed(guest, '/counsel')).toBe(false);
    expect(mod.guestPathAllowed(guest, '/counsel/clients')).toBe(false);
    expect(mod.guestPathAllowed(guest, '/counsel/team')).toBe(false);
    expect(mod.guestPathAllowed(guest, '/counsel/settings')).toBe(false);
    expect(mod.guestPathAllowed(guest, '/counsel/billing')).toBe(false);
  });
});
