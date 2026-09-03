import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A reminder is sent once per person until that person has read it.
 *
 * The cron's timer is the first line of defence against a repeat. It failed
 * for a week on one firm, and every hourly run then handed each owner and
 * admin another bell and another email about the same request. This is the
 * second line: before the fan-out writes to a recipient, it asks whether
 * that recipient still holds this exact notice unread. If so, the bell is
 * not written and the email is not sent, because a second copy of an unread
 * message is a nag rather than news.
 *
 * The test drives the real fan-out through partnerTicketEvent with a fake
 * admin client that serves each table by name, and it records what reached
 * the bell and the mailer per recipient, so the claim "A was skipped and B
 * was not" is read off the record rather than inferred from a count.
 */

const world = vi.hoisted(() => ({
  /** Recipients who already hold this reminder unread. */
  unreadFor: new Set<string>(),
  bells: [] as string[],
  emails: [] as string[],
  reset() {
    this.unreadFor = new Set();
    this.bells = [];
    this.emails = [];
  },
}));

vi.mock('@/lib/notifications', () => ({
  createNotification: async (input: { userId: string }) => {
    world.bells.push(input.userId);
    return null;
  },
}));

vi.mock('@/lib/email', () => ({
  sendEmail: async (input: { to: string }) => {
    world.emails.push(input.to);
  },
}));

const INTAKE = {
  id: 'intake-1',
  firm_id: 'firm-1',
  status: 'in_progress',
  matter_type: 'contract-review',
  client_name: 'Dana Employee',
  client_email: 'dana@example.test',
  case_id: null,
  intake_answers: { subject: 'Wire', partner: { employeeEmail: 'dana@example.test' } },
};

function builder(table: string) {
  const filters: Record<string, unknown> = {};
  const rowsFor = (): unknown[] => {
    if (table === 'firm_matter_intakes') return [INTAKE];
    if (table === 'firms') return [{ name: 'Zinpro', metadata: {} }];
    if (table === 'firm_members') return [{ user_id: 'user-a' }, { user_id: 'user-b' }];
    if (table === 'notifications') {
      const uid = String(filters.user_id ?? '');
      return world.unreadFor.has(uid) ? [{ id: `n-${uid}` }] : [];
    }
    return [];
  };
  const api: Record<string, unknown> = {
    select: () => api,
    in: () => api,
    is: (col: string) => {
      filters[col] = null;
      return api;
    },
    eq: (col: string, val: unknown) => {
      filters[col] = val;
      return api;
    },
    limit: () => api,
    maybeSingle: () => Promise.resolve({ data: rowsFor()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: rowsFor(), error: null }).then(resolve),
  };
  return api;
}

const admin = {
  from: (table: string) => builder(table),
  auth: {
    admin: {
      getUserById: async (id: string) => ({ data: { user: { email: `${id}@example.test` } } }),
    },
  },
};

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => admin,
}));

const { partnerTicketEvent } = await import('@/lib/partner-notify');

beforeEach(() => {
  world.reset();
});

describe('a reminder reaches a person once until they have read it', () => {
  /**
   * Mutation: delete the unread-twin lookup. Both recipients get a bell and
   * an email regardless, and this goes red.
   */
  it('skips the bell and the email for a recipient who still holds it unread', async () => {
    world.unreadFor.add('user-a');

    await partnerTicketEvent(INTAKE as never, 'ticket.reminder');

    expect(world.bells).toEqual(['user-b']);
    expect(world.emails).toEqual(['user-b@example.test']);
  });

  /**
   * The lookup narrows, it never blanks. With nothing unread, everyone is
   * notified exactly as before.
   */
  it('notifies every owner and admin when none of them holds it unread', async () => {
    await partnerTicketEvent(INTAKE as never, 'ticket.reminder');

    expect(world.bells).toEqual(['user-a', 'user-b']);
    expect(world.emails).toEqual(['user-a@example.test', 'user-b@example.test']);
  });

  /**
   * Mutation: make the lookup fail open the other way (skip when the read
   * ERRORS). A lookup that cannot run must not silence a first reminder; the
   * duplicate is the smaller wrong. This case serves an error from the
   * notifications table and expects the send to go ahead.
   */
  it('still sends when the unread lookup itself fails', async () => {
    const failing = {
      ...admin,
      from: (table: string) => {
        if (table !== 'notifications') return builder(table);
        const api: Record<string, unknown> = {
          select: () => api,
          eq: () => api,
          is: () => api,
          limit: () => api,
          maybeSingle: () => Promise.resolve({ data: null, error: { message: 'read timeout' } }),
        };
        return api;
      },
    };
    const mod = await import('@/lib/supabase/admin');
    const spy = vi.spyOn(mod, 'createAdminSupabase').mockReturnValue(failing as never);

    await partnerTicketEvent(INTAKE as never, 'ticket.reminder');

    spy.mockRestore();
    expect(world.bells).toEqual(['user-a', 'user-b']);
  });
});
