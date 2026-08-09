import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/cron/partner-reminders.
 *
 * The sweep decides whether a request is still waiting on the legal team. It
 * used to read `intake_answers.thread`, a jsonb array that stopped being
 * written when the conversation moved to `firm_intake_messages`. The empty
 * value is not read as "unknown", it is read as "the employee is still
 * waiting": the legal-answered check is `if (lastMessage && ...)`, so with no
 * last message it never fires, and the waiting clock falls back to the
 * ticket's creation date, which never moves. The result is nagging forever.
 * Every open partner ticket got a bell and an email to the firm's legal team
 * once per remindAfterHours window, indefinitely, including minutes after
 * legal had replied.
 *
 * lib/portal-open-requests.ts already fixed the employee's side of this same
 * migration, so the correct source of truth was established in the codebase.
 *
 * The fake below serves `firm_intake_messages` for real and records that it
 * was asked. Order and outcome are separate claims, so each case asserts both
 * that the reminder was refused AND that no notification was sent and no
 * lastReminderAt was stamped.
 */

const HOUR = 3_600_000;
const now = Date.UTC(2026, 7, 9, 12, 0, 0);
const ago = (hours: number) => new Date(now - hours * HOUR).toISOString();

type Msg = { author_role: string; created_at: string; visibility: string; deleted_at: string | null };

const world = vi.hoisted(() => ({
  intakes: [] as Record<string, unknown>[],
  messages: {} as Record<string, unknown[]>,
  remindAfterHours: 24,
  notified: [] as string[],
  updates: [] as { id: string; answers: Record<string, unknown> }[],
  messageQueries: [] as string[],
  reset() {
    this.intakes = [];
    this.messages = {};
    this.remindAfterHours = 24;
    this.notified = [];
    this.updates = [];
    this.messageQueries = [];
  },
}));

vi.mock('@/lib/partner-notify', () => ({
  partnerTicketEvent: async (intakeId: string) => {
    world.notified.push(intakeId);
  },
}));

vi.mock('@/lib/partner-config-core', () => ({
  readPartnerConfig: () => ({ remindAfterHours: world.remindAfterHours }),
}));

/**
 * A chainable stand-in for the PostgREST builder. Filters are recorded and
 * applied for real on `firm_intake_messages`, so a test that expects "legal
 * answered last" is answered by data, not by an empty fake. `select()` on an
 * update is deliberately absent, mirroring the route.
 */
function builder(table: string) {
  const filters: Record<string, unknown> = {};
  let desc = false;
  let pendingUpdate: Record<string, unknown> | null = null;
  let updateId = '';

  const rowsFor = (): unknown[] => {
    if (table === 'firms') return [{ metadata: {} }];
    if (table === 'firm_matter_intakes') return world.intakes;
    if (table === 'firm_intake_messages') {
      const id = String(filters.intake_id ?? '');
      world.messageQueries.push(id);
      // A filter that was never applied filters NOTHING, which is what
      // PostgREST does. Modelling an absent filter as "matches nothing" would
      // make a deleted filter look like a working one: every mutation that
      // removes a `.eq()` would go red for the wrong reason, and the cases
      // that should have caught it would pass on an empty result set.
      let all = (world.messages[id] ?? []) as Msg[];
      if ('visibility' in filters) all = all.filter((m) => m.visibility === filters.visibility);
      if ('deleted_at' in filters) all = all.filter((m) => m.deleted_at === null);
      all = all
        .slice()
        .sort((a, b) =>
          desc
            ? Date.parse(b.created_at) - Date.parse(a.created_at)
            : Date.parse(a.created_at) - Date.parse(b.created_at),
        );
      return all;
    }
    return [];
  };

  const api: Record<string, unknown> = {
    select: () => api,
    in: () => api,
    not: () => api,
    is: (col: string) => {
      filters[col] = null;
      return api;
    },
    eq: (col: string, val: unknown) => {
      if (pendingUpdate) {
        updateId = String(val);
        const target = world.intakes.find((r) => r.id === updateId);
        if (target) target.intake_answers = pendingUpdate.intake_answers;
        world.updates.push({
          id: updateId,
          answers: pendingUpdate.intake_answers as Record<string, unknown>,
        });
        pendingUpdate = null;
        return Promise.resolve({ data: null, error: null });
      }
      filters[col] = val;
      return api;
    },
    order: (_col: string, opts?: { ascending?: boolean }) => {
      desc = opts?.ascending === false;
      return api;
    },
    limit: (n: number) => Promise.resolve({ data: rowsFor().slice(0, n), error: null }),
    maybeSingle: () => Promise.resolve({ data: rowsFor()[0] ?? null, error: null }),
    update: (payload: Record<string, unknown>) => {
      pendingUpdate = payload;
      return api;
    },
  };
  // `.limit(n)` is awaited directly in one place and chained into
  // `.maybeSingle()` in another, so limit must be thenable AND chainable.
  const limitFn = (n: number) => {
    const rows = rowsFor().slice(0, n);
    const p = Promise.resolve({ data: rows, error: null }) as Promise<unknown> & {
      maybeSingle?: () => Promise<unknown>;
    };
    p.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    return p;
  };
  api.limit = limitFn;
  return api;
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => ({ from: (table: string) => builder(table) }),
}));

const { GET } = await import('@/app/api/cron/partner-reminders/route');

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function request(authorization = 'Bearer the-secret') {
  return new Request('https://example.test/api/cron/partner-reminders', {
    headers: { authorization },
  }) as unknown as Parameters<typeof GET>[0];
}

function ticket(id: string, createdHoursAgo: number, partner: Record<string, unknown> = {}) {
  return {
    id,
    firm_id: 'firm-1',
    status: 'in_progress',
    created_at: ago(createdHoursAgo),
    updated_at: ago(createdHoursAgo),
    intake_answers: { partner: { employeeEmail: 'e@example.test', ...partner } },
  };
}

function message(role: string, hoursAgo: number, over: Partial<Msg> = {}): Msg {
  return { author_role: role, created_at: ago(hoursAgo), visibility: 'shared', deleted_at: null, ...over };
}

beforeEach(() => {
  world.reset();
  process.env.CRON_SECRET = 'the-secret';
  vi.setSystemTime(new Date(now));
});

afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

describe('the reminder sweep reads firm_intake_messages, not the legacy thread', () => {
  it('does not nag when legal answered last, even though the legacy thread is empty', async () => {
    world.intakes = [ticket('t1', 100)];
    world.messages.t1 = [message('employee', 90), message('legal', 2)];

    const res = await GET(request());
    const body = await res.json();

    // The branch was really exercised: the conversation table was consulted.
    expect(world.messageQueries).toContain('t1');
    // Refused...
    expect(body.reminded).toBe(0);
    // ...and the side effects did not happen.
    expect(world.notified).toEqual([]);
    expect(world.updates).toEqual([]);
  });

  it('does not nag when legal answered last, however long ago that was', async () => {
    // The discriminating case. Legal's reply is 100 hours old on a 24 hour
    // window, so the waiting-time gate would let this through: only the
    // "legal spoke last" check can refuse it. Without this case, deleting
    // that check leaves the suite green because a neighbouring gate happens
    // to say no.
    world.intakes = [ticket('t1', 500)];
    world.messages.t1 = [message('employee', 400), message('legal', 100)];

    const body = await (await GET(request())).json();
    expect(world.messageQueries).toContain('t1');
    expect(body.reminded).toBe(0);
    expect(world.notified).toEqual([]);
    expect(world.updates).toEqual([]);
  });

  it('does not nag when legal answered inside the window but before the employee waited it out', async () => {
    // Legal replied 2 hours ago on a 24h window: nothing is owed yet.
    world.intakes = [ticket('t1', 500)];
    world.messages.t1 = [message('legal', 2)];

    await GET(request());
    expect(world.notified).toEqual([]);
  });

  it('nags when the employee spoke last and has been waiting past the window', async () => {
    world.intakes = [ticket('t1', 500)];
    world.messages.t1 = [message('legal', 400), message('employee', 30)];

    const body = await (await GET(request())).json();
    expect(body.reminded).toBe(1);
    expect(world.notified).toEqual(['t1']);
    expect(world.updates).toHaveLength(1);
    expect(
      (world.updates[0].answers.partner as Record<string, unknown>).lastReminderAt,
    ).toBeTruthy();
  });

  it('measures the wait from the last message, not from the ticket creation date', async () => {
    // Old ticket, but the employee only spoke an hour ago. Under the old
    // created_at clock this fired; it must not.
    world.intakes = [ticket('t1', 500)];
    world.messages.t1 = [message('employee', 1)];

    await GET(request());
    expect(world.messageQueries).toContain('t1');
    expect(world.notified).toEqual([]);
    expect(world.updates).toEqual([]);
  });

  it('still nags a request with no messages at all once it is past the window', async () => {
    world.intakes = [ticket('t1', 500)];

    const body = await (await GET(request())).json();
    expect(body.reminded).toBe(1);
    expect(world.notified).toEqual(['t1']);
  });

  it('ignores an internal legal note, which the employee never saw', async () => {
    world.intakes = [ticket('t1', 500)];
    world.messages.t1 = [
      message('employee', 100),
      message('legal', 1, { visibility: 'internal' }),
    ];

    const body = await (await GET(request())).json();
    expect(body.reminded).toBe(1);
    expect(world.notified).toEqual(['t1']);
  });

  it('ignores a deleted legal reply', async () => {
    world.intakes = [ticket('t1', 500)];
    world.messages.t1 = [
      message('employee', 100),
      message('legal', 1, { deleted_at: ago(0) }),
    ];

    const body = await (await GET(request())).json();
    expect(body.reminded).toBe(1);
  });

  it('does not re-nag inside the reminder window, and does not consult the conversation to decide that', async () => {
    world.intakes = [ticket('t1', 500, { lastReminderAt: ago(1) })];
    world.messages.t1 = [message('employee', 100)];

    await GET(request());
    expect(world.notified).toEqual([]);
    expect(world.updates).toEqual([]);
    // Order, not just outcome: the gates that need no query run first, so the
    // sweep does not issue one lookup per open ticket every hour.
    expect(world.messageQueries).toEqual([]);
  });
});

describe('the sweep still refuses a caller it cannot authenticate', () => {
  it('refuses, and reads nothing, when CRON_SECRET is not set', async () => {
    delete process.env.CRON_SECRET;
    world.intakes = [ticket('t1', 500)];

    const res = await GET(request());
    expect(res.status).toBe(503);
    expect(world.notified).toEqual([]);
    expect(world.messageQueries).toEqual([]);
  });

  it('refuses a wrong secret before any sweep happens', async () => {
    world.intakes = [ticket('t1', 500)];

    const res = await GET(request('Bearer wrong'));
    expect(res.status).toBe(403);
    expect(world.notified).toEqual([]);
    expect(world.messageQueries).toEqual([]);
  });
});
