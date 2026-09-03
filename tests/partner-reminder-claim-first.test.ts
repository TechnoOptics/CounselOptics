import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/cron/partner-reminders: the stamp comes before the nudge, and a
 * stamp that does not land cancels the nudge.
 *
 * The sweep used to notify the legal team first and stamp lastReminderAt
 * second, without reading the result of the stamp. supabase-js writes resolve
 * with { error } rather than throwing, so a stamp that failed looked exactly
 * like one that succeeded, the next hourly run found no timestamp, and it
 * nudged again. On one firm a single open ticket produced 24 bells and 24
 * emails a day to every owner and admin, for a week, and the badge read 99+.
 *
 * Two claims, asserted separately because they fail separately:
 *
 *   1. ORDER. When both succeed, the stamp is recorded before the fan-out
 *      runs, so the timestamp a later run reads is already in the row
 *      whatever the fan-out does.
 *   2. FAILURE. When the stamp fails, nothing is sent and the run reports
 *      nothing reminded. A missed hour costs nothing; a repeated nag costs
 *      the team's attention.
 *
 * The fake is the same shape as partner-reminder-source-of-truth.test.ts,
 * with two additions: the update can be made to fail, and every stamp and
 * every notify is appended to one ordered log so the sequence is a fact
 * rather than an inference.
 */

const HOUR = 3_600_000;
const now = Date.UTC(2026, 8, 3, 12, 0, 0);
const ago = (hours: number) => new Date(now - hours * HOUR).toISOString();

type Msg = { author_role: string; created_at: string; visibility: string; deleted_at: string | null };

const world = vi.hoisted(() => ({
  intakes: [] as Record<string, unknown>[],
  messages: {} as Record<string, unknown[]>,
  /** Ticket ids whose lastReminderAt stamp is made to fail. */
  failStampFor: new Set<string>(),
  log: [] as string[],
  reset() {
    this.intakes = [];
    this.messages = {};
    this.failStampFor = new Set();
    this.log = [];
  },
}));

vi.mock('@/lib/partner-notify', () => ({
  partnerTicketEvent: async (intakeId: string) => {
    world.log.push(`notify:${intakeId}`);
  },
}));

vi.mock('@/lib/partner-config-core', () => ({
  readPartnerConfig: () => ({ remindAfterHours: 24 }),
}));

function builder(table: string) {
  const filters: Record<string, unknown> = {};
  let desc = false;
  let pendingUpdate: Record<string, unknown> | null = null;

  const rowsFor = (): unknown[] => {
    if (table === 'firms') return [{ metadata: {} }];
    if (table === 'firm_matter_intakes') return world.intakes;
    if (table === 'firm_intake_messages') {
      const id = String(filters.intake_id ?? '');
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
        const id = String(val);
        const payload = pendingUpdate;
        pendingUpdate = null;
        if (world.failStampFor.has(id)) {
          world.log.push(`stamp-failed:${id}`);
          return Promise.resolve({
            data: null,
            error: { message: 'permission denied for table firm_matter_intakes' },
          });
        }
        const target = world.intakes.find((r) => r.id === id);
        if (target) target.intake_answers = payload.intake_answers;
        world.log.push(`stamp:${id}`);
        return Promise.resolve({ data: null, error: null });
      }
      filters[col] = val;
      return api;
    },
    order: (_col: string, opts?: { ascending?: boolean }) => {
      desc = opts?.ascending === false;
      return api;
    },
    maybeSingle: () => Promise.resolve({ data: rowsFor()[0] ?? null, error: null }),
    update: (payload: Record<string, unknown>) => {
      pendingUpdate = payload;
      return api;
    },
  };
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

function request() {
  return new Request('https://example.test/api/cron/partner-reminders', {
    headers: { authorization: 'Bearer the-secret' },
  }) as unknown as Parameters<typeof GET>[0];
}

/** A ticket the employee filed long ago and nobody from legal has answered. */
function overdueTicket(id: string) {
  return {
    id,
    firm_id: 'firm-1',
    status: 'in_progress',
    created_at: ago(100),
    updated_at: ago(100),
    intake_answers: { partner: { employeeEmail: 'e@example.test' } },
  };
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

describe('the reminder sweep stamps first and nudges second', () => {
  /**
   * Mutation: swap the two statements back (notify, then stamp). The log
   * reads notify before stamp and this goes red.
   */
  it('records lastReminderAt before the legal team is notified', async () => {
    world.intakes = [overdueTicket('t1')];
    world.messages.t1 = [];

    const body = await (await GET(request())).json();

    expect(body.reminded).toBe(1);
    expect(world.log).toEqual(['stamp:t1', 'notify:t1']);
  });

  /**
   * Mutation: ignore the update's error (drop the `if (stampError)` branch).
   * The reminder goes out on a row that never recorded it, the log shows a
   * notify after a failed stamp, and this goes red.
   */
  it('sends nothing when the stamp did not land, and reports nothing reminded', async () => {
    world.intakes = [overdueTicket('t1')];
    world.messages.t1 = [];
    world.failStampFor.add('t1');

    const body = await (await GET(request())).json();

    expect(body.reminded).toBe(0);
    expect(world.log).toEqual(['stamp-failed:t1']);
    expect(world.log.some((l) => l.startsWith('notify:'))).toBe(false);
  });

  /**
   * A failed stamp on one ticket must not take the rest of the sweep down
   * with it. The second ticket still gets its reminder.
   */
  it('keeps sweeping the other tickets after one stamp fails', async () => {
    world.intakes = [overdueTicket('t1'), overdueTicket('t2')];
    world.messages.t1 = [];
    world.messages.t2 = [];
    world.failStampFor.add('t1');

    const body = await (await GET(request())).json();

    expect(body.reminded).toBe(1);
    expect(world.log).toEqual(['stamp-failed:t1', 'stamp:t2', 'notify:t2']);
  });
});
