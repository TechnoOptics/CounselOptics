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
}));

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
          update: () => ({ eq: async () => ({ error: null }) }),
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
                maybeSingle: async () => ({ data: { id: 'm-1' }, error: null }),
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
          insert: async () => ({ error: null }),
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
        update: () => ({ eq: async () => ({ error: null }) }),
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
