import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Three writes that decide who is on a matter and who is in a workspace.
 *
 *   removeCollaborator runs through the MEMBER client and this table's
 *   delete policy is owner-scoped, so a collaborator or firm member who
 *   is not the case owner matches zero rows. Its caller writes
 *   'collaborator_removed' into the case audit chain the moment it
 *   resolves, so unread it produced a chain entry for a removal that
 *   never happened while the person kept their access.
 *
 *   approveAccessRequestAction and denyAccessRequestAction are the
 *   record of who reviewed a request to join an organization and when,
 *   and they drive the review queue. Unread, a denial could be reported
 *   while the request stayed pending, where the next admin can approve
 *   the person the first one turned away.
 *
 * PostgREST reports a zero-row DELETE or UPDATE as `error: null`. The
 * fake below models that and refuses to invent an error, because a fake
 * that returned one could not detect this defect class at all.
 */

type Row = Record<string, unknown>;

const world = {
  tables: {} as Record<string, Row[]>,
  /** Tables the caller's policy does not admit for writes. */
  policyBlocked: new Set<string>(),
  reset() {
    this.tables = {
      case_collaborators: [],
      firm_signup_requests: [],
      firm_members: [],
      firm_employees: [],
      firms: [],
    };
    this.policyBlocked = new Set<string>();
  },
};

const sendEmail = vi.fn().mockResolvedValue({ ok: true, id: 'email-1' });

function builder(table: string) {
  const preds: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'update' | 'delete' | 'insert' = 'select';
  let payload: Row = {};
  let selected = false;
  const rows = () => (world.tables[table] ??= []);

  const run = (): { data: unknown; error: unknown } => {
    if (op === 'insert') {
      const row = { id: `id-${rows().length + 1}`, ...payload };
      rows().push(row);
      return { data: [row], error: null };
    }
    if (op === 'update' || op === 'delete') {
      const hits = world.policyBlocked.has(table)
        ? []
        : rows().filter((r) => preds.every((p) => p(r)));
      if (op === 'update') for (const r of hits) Object.assign(r, payload);
      else {
        const gone = new Set(hits.map((r) => r.id));
        world.tables[table] = rows().filter((r) => !gone.has(r.id));
      }
      // No `.select()` means nothing comes back, whatever moved.
      return { data: selected ? hits.map((r) => ({ id: r.id })) : null, error: null };
    }
    return { data: rows().filter((r) => preds.every((p) => p(r))), error: null };
  };

  const api: Record<string, unknown> = {
    select() {
      selected = true;
      return api;
    },
    update(p: Row) {
      op = 'update';
      payload = p;
      return api;
    },
    insert(p: Row) {
      op = 'insert';
      payload = p;
      return api;
    },
    delete() {
      op = 'delete';
      return api;
    },
    eq(col: string, val: unknown) {
      preds.push((r) => r[col] === val);
      return api;
    },
    ilike(col: string, val: string) {
      preds.push(
        (r) => String(r[col] ?? '').toLowerCase() === String(val).toLowerCase(),
      );
      return api;
    },
    in(col: string, vals: unknown[]) {
      preds.push((r) => (vals as unknown[]).includes(r[col]));
      return api;
    },
    is(col: string, val: unknown) {
      preds.push((r) => (r[col] ?? null) === val);
      return api;
    },
    async maybeSingle() {
      const { data, error } = run();
      return { data: Array.isArray(data) ? (data[0] ?? null) : data, error };
    },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      return Promise.resolve(run()).then(res, rej);
    },
  };
  return api;
}

const client = {
  from: (t: string) => builder(t),
  auth: { admin: { getUserById: async () => ({ data: { user: null } }) } },
};

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/headers', () => ({
  headers: () => new Map([['x-forwarded-for', '1.2.3.4']]),
}));
vi.mock('../lib/supabase/server', () => ({
  createServerSupabase: () => client,
  getCurrentUser: async () => ({ id: 'member-1', email: 'm@firm.test' }),
  requireUser: async () => ({ id: 'admin-1', email: 'admin@firm.test' }),
  // usingSupabase() gates every storage helper; held open so the guard
  // under test is the only thing that can refuse.
  isSupabaseConfigured: () => true,
}));
vi.mock('../lib/supabase/admin', () => ({ createAdminSupabase: () => client }));
vi.mock('../lib/firm-authz', () => ({ requireActiveFirm: async () => undefined }));
vi.mock('../lib/notifications', () => ({ createNotification: async () => null }));
vi.mock('../lib/email', () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...a),
  isEmailConfigured: () => true,
}));

const { removeCollaborator } = await import('../lib/storage');
const { approveAccessRequestAction, denyAccessRequestAction } = await import(
  '../lib/access-actions'
);

beforeEach(() => {
  world.reset();
  sendEmail.mockClear();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  world.tables.case_collaborators.push({
    id: 'collab-1',
    case_id: 'case-1',
    email: 'witness@example.com',
    role: 'witness',
  });
  // The caller is a firm admin, so the role gate in front of the review
  // actions is open and only the write guard can refuse.
  world.tables.firm_members.push({
    firm_id: 'firm-1',
    user_id: 'admin-1',
    role: 'admin',
  });
  world.tables.firms.push({ id: 'firm-1', name: 'Anderson Foundation' });
  world.tables.firm_signup_requests.push({
    id: 'req-1',
    firm_id: 'firm-1',
    email: 'joiner@acme.test',
    full_name: 'Jo Iner',
    classification: 'external',
    status: 'pending',
    reviewed_by: null,
    reviewed_at: null,
  });
});

describe('removing someone from a case', () => {
  it('throws rather than letting an audit entry be written for a removal that did not happen', async () => {
    // The delete policy is owner-scoped; this caller is not the owner, so
    // the row simply does not match. PostgREST calls that error null.
    world.policyBlocked.add('case_collaborators');

    await expect(removeCollaborator('collab-1')).rejects.toThrow(
      /could not be removed/i,
    );
    // Asserted separately from the throw: the person still has access.
    expect(world.tables.case_collaborators).toHaveLength(1);
  });

  it('throws on a collaborator id that does not exist', async () => {
    await expect(removeCollaborator('collab-nope')).rejects.toThrow(
      /could not be removed/i,
    );
    expect(world.tables.case_collaborators).toHaveLength(1);
  });

  it('removes the row when the caller really can', async () => {
    await expect(removeCollaborator('collab-1')).resolves.toBeUndefined();
    expect(world.tables.case_collaborators).toHaveLength(0);
  });
});

describe('reviewing a request to join an organization', () => {
  it('does not report an approval the request never took', async () => {
    world.policyBlocked.add('firm_signup_requests');

    const res = await approveAccessRequestAction('req-1');

    expect(res.ok).toBe(false);
    expect(res.error).toContain('not approved');
    expect(world.tables.firm_signup_requests[0].status).toBe('pending');
    expect(world.tables.firm_signup_requests[0].reviewed_by).toBeNull();
    // The "you're approved" mail must not go to someone whose request is
    // still sitting in the queue.
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('does not report a denial that left the request pending', async () => {
    world.policyBlocked.add('firm_signup_requests');

    const res = await denyAccessRequestAction('req-1');

    expect(res.ok).toBe(false);
    expect(res.error).toContain('not declined');
    // Still pending is the whole problem: the next admin can approve the
    // person this one turned away.
    expect(world.tables.firm_signup_requests[0].status).toBe('pending');
  });

  it('loses the race to an admin who reviewed it first', async () => {
    world.tables.firm_signup_requests[0].status = 'pending';
    const first = await denyAccessRequestAction('req-1');
    expect(first.ok).toBe(true);

    // The read-time check and the write-time claim now disagree only in a
    // real race; here the second reviewer is refused by one of them and,
    // either way, does not overwrite the first reviewer's decision.
    const second = await approveAccessRequestAction('req-1');
    expect(second.ok).toBe(false);
    expect(world.tables.firm_signup_requests[0].status).toBe('denied');
  });

  it('records the reviewer when the row really moves', async () => {
    const res = await denyAccessRequestAction('req-1');

    expect(res).toEqual({ ok: true });
    expect(world.tables.firm_signup_requests[0].status).toBe('denied');
    expect(world.tables.firm_signup_requests[0].reviewed_by).toBe('admin-1');
  });
});
