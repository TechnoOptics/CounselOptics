import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

/**
 * scheduleMeetingFromIntakeAction posts the meeting into the conversation.
 *
 * The conversation moved out of the `intake_answers.thread` jsonb array and
 * into `firm_intake_messages` (supabase/migrations/20260727_intake_conversation.sql),
 * and this action was left behind: it appended the meeting note to the dead
 * array, so the one line on the ticket the requester most needs - the join
 * link - was written where nothing reads. The panel, the portal and the
 * partner API all read the table.
 *
 * The same leftover already caused a shipped bug on the reminder sweep
 * (tests/partner-reminder-source-of-truth.test.ts), which is why the claim
 * pinned here is not "a message was written" but "the write went to the
 * table AND no thread was written anywhere".
 *
 * Mutations this is meant to catch:
 *   - restore the jsonb append: "writes no thread" goes red.
 *   - drop the insertIntakeMessage call: "posts the meeting" goes red.
 *   - change the message to `internal` or `system`: "the requester can see
 *     it" goes red, because an internal note is filtered out of the
 *     employee's view and a system-authored row is routed firm-side only.
 */

type Row = Record<string, unknown>;

const world = vi.hoisted(() => ({
  intake: null as Row | null,
  /** Rows inserted into firm_intake_messages. */
  messages: [] as Row[],
  /** Every UPDATE payload sent to firm_matter_intakes. */
  intakeUpdates: [] as Row[],
  meetings: [] as Row[],
  notifications: [] as Row[],
  /** Make the message insert fail the way PostgREST does: `{ error }`. */
  messageInsertFails: false,
  meetingResult: {
    ok: true,
    provider: 'microsoft',
    joinUrl: 'https://teams.example.test/j/abc',
  } as Record<string, unknown>,
  reset() {
    this.intake = {
      id: 'intake-1',
      firm_id: 'firm-1',
      created_by: 'employee-1',
      client_name: 'Acme renewal',
      client_email: 'e@example.test',
      matter_type: 'contract',
      status: 'in_progress',
      assigned_to: null,
      intake_answers: { partner: { externalId: 'ZIN-42' } },
    };
    this.messages = [];
    this.intakeUpdates = [];
    this.meetings = [];
    this.notifications = [];
    this.messageInsertFails = false;
    this.meetingResult = {
      ok: true,
      provider: 'microsoft',
      joinUrl: 'https://teams.example.test/j/abc',
    };
  },
}));

/**
 * A chainable PostgREST stand-in. It is thenable so an awaited chain that
 * never calls `.single()` / `.maybeSingle()` (hydratePeople's `.in()`, the
 * `updated_at` bump) resolves like the real builder does.
 */
function builder(table: string) {
  let pendingInsert: Row | null = null;
  let pendingUpdate: Row | null = null;

  const rowsFor = (): Row[] => {
    if (table === 'firm_matter_intakes') return world.intake ? [world.intake] : [];
    if (table === 'profiles')
      return [{ id: 'user-1', display_name: 'Dana Reed', avatar_url: null }];
    if (table === 'firm_members')
      return [{ user_id: 'user-1', display_name: 'Dana Reed', role: 'attorney' }];
    return [];
  };

  const settle = () => {
    if (pendingUpdate) {
      if (table === 'firm_matter_intakes') world.intakeUpdates.push(pendingUpdate);
      pendingUpdate = null;
      return { data: null, error: null };
    }
    if (pendingInsert) {
      pendingInsert = null;
      return { data: null, error: null };
    }
    return { data: rowsFor(), error: null };
  };

  const api: Record<string, unknown> = {
    select: () => api,
    eq: () => api,
    in: () => api,
    is: () => api,
    order: () => api,
    limit: () => api,
    insert: (payload: Row) => {
      pendingInsert = payload;
      if (table === 'firm_meetings') world.meetings.push(payload);
      return api;
    },
    update: (payload: Row) => {
      pendingUpdate = payload;
      return api;
    },
    maybeSingle: async () => ({ data: rowsFor()[0] ?? null, error: null }),
    single: async () => {
      if (pendingInsert && table === 'firm_intake_messages') {
        const payload = pendingInsert;
        pendingInsert = null;
        if (world.messageInsertFails) {
          return { data: null, error: { message: 'insert refused' } };
        }
        const row = { id: 'msg-1', created_at: '2026-08-09T12:00:00.000Z', ...payload };
        world.messages.push(row);
        return { data: row, error: null };
      }
      return { data: rowsFor()[0] ?? null, error: null };
    },
    then: (resolve: (v: unknown) => unknown) => resolve(settle()),
  };
  return api;
}

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => ({ from: (table: string) => builder(table) }),
}));

vi.mock('../lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  getCurrentUser: async () => ({ id: 'user-1', email: 'dana@firm.test' }),
  createServerSupabase: () => ({}),
  requireUser: async () => ({ id: 'user-1' }),
}));

vi.mock('../lib/firm-authz', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callerIsFirmMember: async () => memberships.isMember,
  callerHasFirmRole: async () => memberships.isMember,
  callerIsFirmAdmin: async () => memberships.isMember,
  requireActiveFirm: async () => {},
}));

vi.mock('../lib/firm-meetings', () => ({
  scheduleFirmMeeting: async () => world.meetingResult,
}));

vi.mock('../lib/notifications', () => ({
  createNotification: async (input: Row) => {
    world.notifications.push(input);
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const memberships = { isMember: true };

const { scheduleMeetingFromIntakeAction } = await import('../lib/firm-actions');

function form(over: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set('startISO', new Date(Date.now() + 86_400_000).toISOString());
  fd.set('durationMin', '30');
  for (const [k, v] of Object.entries(over)) fd.set(k, v);
  return fd;
}

const run = () => scheduleMeetingFromIntakeAction('firm-1', 'intake-1', form());

beforeEach(() => {
  world.reset();
  memberships.isMember = true;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the meeting note lands in the live conversation', () => {
  it('posts the meeting to firm_intake_messages', async () => {
    const res = await run();

    expect(res.ok).toBe(true);
    expect(world.messages).toHaveLength(1);
    expect(world.messages[0]).toMatchObject({
      intake_id: 'intake-1',
      firm_id: 'firm-1',
      author_user_id: 'user-1',
      kind: 'event',
      event_type: 'meeting_scheduled',
    });
  });

  it('carries the join link, which is the only reason the note exists', async () => {
    await run();
    expect(String(world.messages[0].body)).toContain('https://teams.example.test/j/abc');
    expect(String(world.messages[0].body)).toContain('Microsoft Teams');
  });

  it('writes no thread: the legacy jsonb array is never touched', async () => {
    await run();

    // The only UPDATEs on the request are the `updated_at` bumps. An
    // intake_answers write here is the defect returning, whatever it holds.
    for (const payload of world.intakeUpdates) {
      expect(payload).not.toHaveProperty('intake_answers');
    }
    expect(JSON.stringify(world.intakeUpdates)).not.toContain('thread');
  });

  it('is shared and legal-authored, so the requester actually sees it', async () => {
    await run();
    // 'internal' is filtered out of the employee's view; a 'system' author is
    // routed to the legal team rather than to the person who is being told.
    expect(world.messages[0].visibility).toBe('shared');
    expect(world.messages[0].author_role).toBe('legal');
  });

  it('names the firm member who scheduled it', async () => {
    await run();
    expect(world.messages[0].author_name).toBe('Dana Reed');
  });
});

describe('the meeting survives a conversation write that fails', () => {
  it('still returns the join URL and still notifies the requester', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    world.messageInsertFails = true;

    const res = await run();

    expect(res).toMatchObject({ ok: true, joinUrl: 'https://teams.example.test/j/abc' });
    expect(world.messages).toEqual([]);
    expect(world.notifications).toHaveLength(1);
    // supabase-js resolves with `{ error }` instead of throwing, so a silent
    // failure here is exactly the shape that goes unnoticed. It is logged.
    expect(err).toHaveBeenCalled();
  });
});

describe('the action refuses before it writes anything', () => {
  it('refuses a caller who is not in the firm', async () => {
    memberships.isMember = false;
    const res = await scheduleMeetingFromIntakeAction('firm-1', 'intake-1', form());
    expect(res.ok).toBe(false);
    expect(world.messages).toEqual([]);
    expect(world.meetings).toEqual([]);
  });

  it('refuses a request that belongs to another firm', async () => {
    world.intake = { ...(world.intake as Row), firm_id: 'firm-2' };
    const res = await run();
    expect(res.ok).toBe(false);
    expect(world.messages).toEqual([]);
  });

  it('refuses a time in the past without scheduling anything', async () => {
    const fd = form({ startISO: new Date(Date.now() - 86_400_000).toISOString() });
    const res = await scheduleMeetingFromIntakeAction('firm-1', 'intake-1', fd);
    expect(res.ok).toBe(false);
    expect(world.messages).toEqual([]);
  });
});
