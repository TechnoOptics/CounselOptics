import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Impact page's meeting counts came off the USER-SCOPED client.
 *
 * firm_meetings has RLS enabled and no policies, so that select returns an
 * empty set for every caller and every firm, with no error and nothing in the
 * logs. The counts read zero for a firm with a full calendar, and nobody was
 * told. The same defect was live on the /counsel dashboard tile, where a firm
 * with meetings booked was shown "Nothing on the calendar".
 *
 * WHAT THIS TEST DRIVES. The real getFirmAnalytics and the real
 * lib/firm-authz.ts gate. Only the two client factories are faked, and the
 * user-scoped fake behaves the way the database does: it answers every OTHER
 * table with rows and answers firm_meetings with nothing. So the meeting
 * counts can only be non-zero if the read genuinely moved to the service-role
 * client. Faking callerIsFirmMember instead would have proved nothing about
 * the gate, which is the half most likely to be dropped.
 */

const T0 = new Date('2026-08-09T12:00:00Z');

const state = vi.hoisted(() => ({
  /** The caller's row in firm_members, as the user-scoped client would see it. */
  memberRole: 'attorney' as string | null,
  serviceRole: true,
  userTables: [] as string[],
  adminTables: [] as string[],
}));

/**
 * Rows the user-scoped client hands back per table.
 *
 * Every neighbour is held OPEN on purpose. If the other eight reads came back
 * empty too, a zero meeting count would prove nothing about which client read
 * firm_meetings; the assertions below check a neighbour is populated for
 * exactly that reason.
 *
 * firm_meetings is present and EMPTY, which is what RLS with no policies
 * actually does. An absent key would be indistinguishable from a mock that
 * was never asked.
 */
const USER_ROWS: Record<string, Array<Record<string, unknown>>> = {
  firm_matter_intakes: [
    { status: 'new', created_at: '2026-08-01T00:00:00Z', updated_at: null },
    { status: 'engaged', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-03T00:00:00Z' },
  ],
  firm_signing_requests: [
    { status: 'completed', created_at: '2026-08-01T00:00:00Z', completed_at: '2026-08-02T00:00:00Z' },
  ],
  firm_documents: [{ status: 'final' }],
  cases: [{ status: 'open' }],
  firm_meetings: [],
  firm_invoices: [{ status: 'sent', total_cents: 5000, paid_at: null }],
  firm_trust_transactions: [{ kind: 'deposit', amount_cents: 1000 }],
  // firm_members is answered by the branch in the mock below, not from here,
  // because two tests need it to change between runs.
  firm_employees: [{ id: 'e1' }],
};

const ADMIN_MEETINGS = [
  { start_at: '2026-08-20T09:00:00Z' },
  { start_at: '2026-08-25T09:00:00Z' },
  { start_at: '2026-06-01T09:00:00Z' },
];

/** A query builder thin enough to be obviously faithful and thenable like the real one. */
function builder(rows: Array<Record<string, unknown>>) {
  const result = { data: rows, error: null, count: rows.length };
  const q: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'is', 'gte', 'lte', 'order']) {
    q[method] = () => q;
  }
  q.limit = async () => result;
  q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
  q.then = (onFulfilled: (v: typeof result) => unknown) =>
    Promise.resolve(result).then(onFulfilled);
  return q;
}

vi.mock('../lib/supabase/server', () => ({
  createServerSupabase: () => ({
    from: (table: string) => {
      state.userTables.push(table);
      if (table === 'firm_members') {
        // The membership row lib/firm-authz.ts reads. Held open by default so
        // a refusal in these tests can only have come from the gate under
        // test, never from a neighbour that happened to be shut.
        return builder(state.memberRole === null ? [] : [{ id: 'm1', role: state.memberRole }]);
      }
      return builder(USER_ROWS[table] ?? []);
    },
  }),
  getCurrentUser: async () => ({ id: 'user-1', email: 'a@example.com' }),
  isSupabaseConfigured: () => true,
}));

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () =>
    state.serviceRole
      ? {
          from: (table: string) => {
            state.adminTables.push(table);
            return builder(table === 'firm_meetings' ? ADMIN_MEETINGS : []);
          },
        }
      : null,
  isServiceRoleConfigured: () => state.serviceRole,
}));

const { getFirmAnalytics } = await import('../lib/counsel-analytics');

beforeEach(() => {
  vi.setSystemTime(T0);
  state.memberRole = 'attorney';
  state.serviceRole = true;
  state.userTables = [];
  state.adminTables = [];
});

describe('a firm member sees the meetings that exist', () => {
  it('counts them, which is only possible off the service-role client', async () => {
    const a = await getFirmAnalytics('firm-1');
    expect(a.meetings.total).toBe(3);
    expect(a.meetings.upcoming).toBe(2);
    expect(a.meetings.thisMonth).toBe(2);
  });

  it('asks the service-role client, and never the user-scoped one', async () => {
    await getFirmAnalytics('firm-1');
    expect(state.adminTables).toContain('firm_meetings');
    expect(state.userTables).not.toContain('firm_meetings');
  });

  it('still reads every other table through the user-scoped client', async () => {
    // The point of the fixture: if the neighbours were empty, a zero meeting
    // count would be ambiguous and this whole file would be decorative.
    const a = await getFirmAnalytics('firm-1');
    expect(state.userTables).toContain('firm_matter_intakes');
    expect(state.adminTables).not.toContain('firm_matter_intakes');
    expect(a.requests.total).toBe(2);
    expect(a.cases.total).toBe(1);
  });
});

describe('a caller who is not a member of the firm', () => {
  it('is refused, and gets the empty counts they got before', async () => {
    state.memberRole = null;
    const a = await getFirmAnalytics('firm-1');
    expect(a.meetings).toEqual({ total: 0, upcoming: 0, thisMonth: 0 });
  });

  it('never reaches the table at all, which is a separate claim', async () => {
    // Outcome and ORDER are different. A gate moved below the query still
    // returns zeros, and the assertion above would not notice; this one does.
    state.memberRole = null;
    await getFirmAnalytics('firm-1');
    expect(state.adminTables).not.toContain('firm_meetings');
  });
});

describe('a deployment with no service-role key', () => {
  it('degrades to empty counts rather than throwing', async () => {
    state.serviceRole = false;
    const a = await getFirmAnalytics('firm-1');
    expect(a.meetings).toEqual({ total: 0, upcoming: 0, thisMonth: 0 });
    // The rest of the page is unaffected: it never needed the admin client.
    expect(a.requests.total).toBe(2);
  });
});
