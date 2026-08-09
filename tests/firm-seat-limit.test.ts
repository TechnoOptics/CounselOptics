import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The one path that CONSUMES a seat: acceptFirmInvitationAction in
 * lib/firm-actions.ts.
 *
 * seatCheck itself is pure and pinned in tests/firm-access.test.ts. What is
 * under test here is the READER that feeds it. It used to say
 * `(seatFirm as { seat_limit: number | null } | null)?.seat_limit ?? null`,
 * which reads a row that lacks the column as "no limit" and passes every seat
 * check that follows. The cast is doing no work at runtime, so the shape it
 * promises is not the shape the code has to survive.
 *
 * PostgREST errors an unknown column rather than returning a row without it,
 * so this was never a live hole. It is the rule three sibling readers on this
 * branch already hold, in lib/firm-trials.ts and in readTrialSnapshot: a
 * reader does not get to assume its caller's honesty about the shape it was
 * handed, and the fail-open direction is the one that has to be closed
 * whether or not it is currently reachable.
 */

const db = vi.hoisted(() => ({
  /** The firms row the seat read returns. `{}` is a row missing the column. */
  firmRow: { seat_limit: null } as Record<string, unknown> | null,
  /** One row per existing member of the organization. */
  members: [] as Array<{ user_id: string }>,
  /** Membership inserts, so a refusal that still wrote is visible. */
  inserts: [] as Array<Record<string, unknown>>,
  /** The row the membership insert reports back; null is "wrote nothing". */
  memberRow: { id: 'm-1' } as { id: string } | null,
  /** Rows the profiles activation reports as affected. */
  profileRows: [{ id: 'user-new' }] as Array<{ id: string }>,
  /** Rows the "mark the invitation used" update reports as affected. */
  inviteRows: [{ id: 'inv-1' }] as Array<{ id: string }>,
  /** Every confirmed write, in order, so ordering is its own assertion. */
  writes: [] as string[],
}));

/**
 * An update node that can be awaited WITHOUT `.select()`, exactly as PostgREST
 * behaves: it resolves clean with nothing to inspect. Keeping this shape is
 * what gives a mutation that deletes the confirmation somewhere to be caught.
 */
const updateNode = vi.hoisted(
  () => (label: string, rows: () => Array<{ id: string }>, log: string[]) => {
    const node: Record<string, unknown> = {
      eq: () => node,
      select: () => {
        log.push(label);
        return Promise.resolve({ data: rows(), error: null });
      },
      then: (resolve: (v: unknown) => unknown) => {
        log.push(label);
        return resolve({ data: null, error: null });
      },
    };
    return node;
  },
);

vi.mock('node:crypto', () => ({ default: { randomUUID: () => 'id' } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

vi.mock('../lib/supabase/server', () => ({
  getCurrentUser: async () => ({ id: 'user-new', email: 'new@example.com' }),
  requireUser: async () => ({ id: 'user-new', email: 'new@example.com' }),
  createServerSupabase: () => ({}),
}));

const INVITATION = {
  id: 'inv-1',
  firm_id: 'firm-1',
  email: 'new@example.com',
  role: 'staff',
  expires_at: '2099-01-01T00:00:00.000Z',
  accepted_at: null,
};

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      if (table === 'firm_invitations') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: INVITATION, error: null }) }),
          }),
          update: () => updateNode('invitation', () => db.inviteRows, db.writes),
        };
      }
      if (table === 'firm_members') {
        return {
          select: () => ({
            eq: async () => ({ data: db.members, error: null }),
          }),
          insert: (row: Record<string, unknown>) => {
            db.inserts.push(row);
            return {
              select: () => ({
                maybeSingle: async () => {
                  db.writes.push('member');
                  return {
                    data: db.memberRow,
                    error: db.memberRow
                      ? null
                      : { message: 'duplicate key value violates unique constraint' },
                  };
                },
              }),
              // Awaited directly by callers that want no row back.
              then: (
                resolve: (v: { error: null }) => unknown,
              ) => resolve({ error: null }),
            };
          },
        };
      }
      if (table === 'firm_channels' || table === 'firm_channel_members') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          insert: () => ({
            select: () => ({
              maybeSingle: async () => ({ data: { id: 'cm-1' }, error: null }),
            }),
          }),
        };
      }
      // firms, and everything else the tail of the action touches once the
      // seat check has passed. None of it is under test here.
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: table === 'firms' ? db.firmRow : null,
              error: null,
            }),
          }),
        }),
        update: () => updateNode('profile', () => db.profileRows, db.writes),
        insert: async () => ({ error: null }),
      };
    },
  }),
}));

// The access gate is not what these cases are about, and it has its own suite.
vi.mock('../lib/firm-authz', () => ({
  callerHasFirmRole: async () => true,
  callerIsFirmAdmin: async () => true,
  callerIsFirmMember: async () => true,
  requireActiveFirm: async () => {},
  FIRM_MANAGE_ROLES: ['owner', 'admin'],
}));

vi.mock('../lib/email', () => ({
  sendEmail: async () => {},
  buildMeetingInviteEmailHtml: () => '',
  buildSigningRequestEmailHtml: () => '',
  buildSigningCodeEmailHtml: () => '',
}));

vi.mock('../lib/security-audit', () => ({ logSecurityEvent: async () => {} }));

import { acceptFirmInvitationAction } from '../lib/firm-actions';

beforeEach(() => {
  db.firmRow = { seat_limit: null };
  db.members = [];
  db.inserts = [];
  db.memberRow = { id: 'm-1' };
  db.profileRows = [{ id: 'user-new' }];
  db.inviteRows = [{ id: 'inv-1' }];
  db.writes = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the seat limit read on the one path that consumes a seat', () => {
  it('refuses a firms row that came back without seat_limit, rather than reading it as no limit', async () => {
    // THE MUTATION: put back
    //   const seatLimit = (seatFirm as {...} | null)?.seat_limit ?? null;
    // and delete the key-presence check. This case then returns ok:true and
    // writes the membership, because `undefined ?? null` is null and
    // seatCheck reads null as unlimited.
    db.firmRow = {};
    db.members = [{ user_id: 'a' }, { user_id: 'b' }];

    const res = await acceptFirmInvitationAction('tok');

    expect(res.ok).toBe(false);
    // The refusal has to happen BEFORE the seat is taken.
    expect(db.inserts).toHaveLength(0);
  });

  it('still treats a present null as no limit, which is what a paying organization has', async () => {
    db.firmRow = { seat_limit: null };
    db.members = [{ user_id: 'a' }];

    const res = await acceptFirmInvitationAction('tok');

    expect(res.ok).toBe(true);
    expect(db.inserts).toHaveLength(1);
  });

  it('still enforces a real limit', async () => {
    db.firmRow = { seat_limit: 2 };
    db.members = [{ user_id: 'a' }, { user_id: 'b' }];

    const res = await acceptFirmInvitationAction('tok');

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/limit of 2 members/);
    expect(db.inserts).toHaveLength(0);
  });

  // A limit of zero is a real limit and must not read as unlimited. It is
  // refused at the database by firms_seat_limit_positive, but this reader
  // must not be the thing that lets it through if it ever arrives.
  it('treats a zero limit as a limit rather than as unlimited', async () => {
    db.firmRow = { seat_limit: 0 };
    db.members = [];

    const res = await acceptFirmInvitationAction('tok');

    expect(res.ok).toBe(false);
    expect(db.inserts).toHaveLength(0);
  });
});

/**
 * The writes that follow the seat check, and why "it did not throw" was never
 * proof that any of them landed.
 *
 * supabase-js resolves rather than throws: a write that matched no row comes
 * back `{ data: null, error: null }`, indistinguishable from one that wrote.
 * All four writes at the end of this action used to be issued and dropped, so
 * a caller could be told they had joined an organization whose membership row
 * was never created, and the invitation would still be burned on the way out.
 *
 * The fake above can fail on demand for exactly this reason. A mutation that
 * comes back green here is a broken test before it is a redundant guard: an
 * earlier agent's hollow-success mutation passed only because its fake's
 * insert always succeeded.
 *
 * Mutations, each verified red:
 *   - delete the `!memberRow && !alreadyAMember` check: "refuses when the
 *     membership row was not created" goes red.
 *   - delete `.select('id')` from the profiles or the invitations update, or
 *     the length check under it: the matching case goes red, because the node
 *     above then resolves with nothing to inspect.
 *   - mark the invitation used before the membership insert: "leaves the
 *     invitation usable" goes red on the ordering assertion while its refusal
 *     assertion stays green, which is why both are asserted.
 */
describe('the writes that finish an accepted invitation are confirmed', () => {
  it('refuses when the membership row was not created', async () => {
    db.memberRow = null;

    const res = await acceptFirmInvitationAction('tok');

    expect(res.ok).toBe(false);
    // And nothing downstream ran: no firm activated, no invitation consumed.
    expect(db.writes).toEqual(['member']);
  });

  it('still accepts a re-accept, where the unique constraint returns no row', async () => {
    // Already inside the organization. The insert conflicts and returns
    // nothing, which is success for this person and only for this person.
    db.memberRow = null;
    db.members = [{ user_id: 'user-new' }];

    const res = await acceptFirmInvitationAction('tok');

    expect(res.ok).toBe(true);
    expect(res.firmId).toBe('firm-1');
  });

  it('refuses when there was no profiles row to activate the firm on', async () => {
    db.profileRows = [];

    const res = await acceptFirmInvitationAction('tok');

    expect(res.ok).toBe(false);
    // Refused BEFORE the invitation was consumed, so a retry is still possible.
    expect(db.writes).toEqual(['member', 'profile']);
  });

  it('refuses when the invitation could not be marked as used', async () => {
    db.inviteRows = [];

    const res = await acceptFirmInvitationAction('tok');

    expect(res.ok).toBe(false);
    expect(db.writes).toEqual(['member', 'profile', 'invitation']);
  });

  it('leaves the invitation usable until everything before it has landed', async () => {
    const res = await acceptFirmInvitationAction('tok');

    expect(res.ok).toBe(true);
    // Order is a separate claim from outcome. Consuming the invitation is the
    // one step that cannot be retried, so it goes last.
    expect(db.writes).toEqual(['member', 'profile', 'invitation']);
  });
});
