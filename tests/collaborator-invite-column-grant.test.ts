import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The consumer invite writes case_collaborators through the MEMBER client,
 * which authenticates as the Postgres role `authenticated`.
 *
 * supabase/migrations/20260810_update_policies_collaborators_exhibits.sql is
 * APPLIED to production. To stop a collaborator promoting themselves by
 * writing their own `role`, it narrowed that role's UPDATE grant from the
 * whole table down to two columns:
 *
 *   revoke update on public.case_collaborators from authenticated;
 *   grant update (witness_statement, witness_statement_updated_at) ...
 *
 * A PostgREST upsert is INSERT ... ON CONFLICT DO UPDATE SET <every column in
 * the payload>, and Postgres requires UPDATE privilege on every column in that
 * SET list. It checks the grant when it plans the statement, so the refusal
 * does not wait for a row to actually conflict: the very first invite to a
 * brand new email is refused too.
 *
 * The fake below models the grant, not the policy. That distinction is the
 * whole point: a fake that only modelled RLS would let the broken upsert
 * through, because the caller here really is the case owner and the row-level
 * predicate really does admit them. Only the column grant refuses.
 */

type Row = Record<string, unknown>;

/** Exactly what the applied migration leaves `authenticated` able to update. */
const AUTHENTICATED_UPDATABLE = new Set([
  'witness_statement',
  'witness_statement_updated_at',
]);

const world = {
  tables: {} as Record<string, Row[]>,
  /** Every write the MEMBER client attempted, for the escalation assertion. */
  memberWrites: [] as Array<{ table: string; op: string; columns: string[] }>,
  reset() {
    this.tables = { cases: [], case_collaborators: [], profiles: [] };
    this.memberWrites = [];
  },
};

const sendEmail = vi.fn().mockResolvedValue({ ok: true, id: 'email-1' });

function builder(table: string, asMember: boolean) {
  const preds: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'update' | 'delete' | 'insert' | 'upsert' = 'select';
  let payload: Row = {};
  const rows = () => (world.tables[table] ??= []);

  /** Postgres 42501, as PostgREST hands it back through supabase-js. */
  const denied = () => ({
    data: null,
    error: {
      code: '42501',
      message: `permission denied for table ${table}`,
      details: null,
      hint: null,
    },
  });

  const conflictKey = (r: Row) => `${String(r.case_id)}|${String(r.email)}`;

  const run = (): { data: unknown; error: unknown } => {
    if (op === 'insert' || op === 'upsert' || op === 'update') {
      if (asMember) {
        world.memberWrites.push({ table, op, columns: Object.keys(payload) });
      }
      // The grant check. An UPDATE, and the DO UPDATE half of an upsert,
      // needs UPDATE privilege on every column being written.
      if (asMember && table === 'case_collaborators' && op !== 'insert') {
        const ungranted = Object.keys(payload).filter(
          (c) => !AUTHENTICATED_UPDATABLE.has(c),
        );
        if (ungranted.length > 0) return denied();
      }
    }

    if (op === 'insert' || op === 'upsert') {
      const existing = rows().find((r) => conflictKey(r) === conflictKey(payload));
      if (existing) {
        if (op === 'insert') {
          return {
            data: null,
            error: {
              code: '23505',
              message: `duplicate key value violates unique constraint "${table}_case_email_unique"`,
              details: null,
              hint: null,
            },
          };
        }
        Object.assign(existing, payload);
        return { data: [{ ...existing }], error: null };
      }
      const row = {
        id: `collab-${rows().length + 1}`,
        invited_at: '2026-08-10T00:00:00.000Z',
        witness_statement: null,
        witness_statement_updated_at: null,
        ...payload,
      };
      rows().push(row);
      return { data: [{ ...row }], error: null };
    }

    const hits = rows().filter((r) => preds.every((p) => p(r)));
    if (op === 'update') {
      for (const r of hits) Object.assign(r, payload);
      return { data: hits.map((r) => ({ ...r })), error: null };
    }
    if (op === 'delete') {
      const gone = new Set(hits.map((r) => r.id));
      world.tables[table] = rows().filter((r) => !gone.has(r.id));
      return { data: hits.map((r) => ({ ...r })), error: null };
    }
    return { data: hits.map((r) => ({ ...r })), error: null };
  };

  const api: Record<string, unknown> = {
    select() {
      return api;
    },
    insert(p: Row) {
      op = 'insert';
      payload = p;
      return api;
    },
    upsert(p: Row) {
      op = 'upsert';
      payload = p;
      return api;
    },
    update(p: Row) {
      op = 'update';
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
    order() {
      return api;
    },
    async single() {
      const { data, error } = run();
      const arr = data as Row[] | null;
      if (error) return { data: null, error };
      return { data: arr?.[0] ?? null, error: null };
    },
    async maybeSingle() {
      const { data, error } = run();
      const arr = data as Row[] | null;
      return { data: arr?.[0] ?? null, error };
    },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      return Promise.resolve(run()).then(res, rej);
    },
  };
  return api;
}

const memberClient = { from: (t: string) => builder(t, true) };
const adminClient = {
  from: (t: string) => builder(t, false),
  auth: {
    signInWithOtp: async () => ({ data: null, error: null }),
    admin: {
      listUsers: async () => ({ data: { users: [] as { id: string; email: string }[] } }),
      generateLink: async () => ({
        data: { properties: { action_link: 'https://advottic.com/link' } },
      }),
      inviteUserByEmail: async () => ({ data: null, error: null }),
    },
  },
};

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/headers', () => ({ headers: () => new Map() }));
vi.mock('../lib/supabase/server', () => ({
  createServerSupabase: () => memberClient,
  getCurrentUser: async () => ({
    id: 'owner-1',
    email: 'owner@example.test',
    user_metadata: { full_name: 'Case Owner' },
  }),
  requireUser: async () => ({ id: 'owner-1', email: 'owner@example.test' }),
  isSupabaseConfigured: () => true,
}));
vi.mock('../lib/supabase/admin', () => ({ createAdminSupabase: () => adminClient }));
vi.mock('../lib/email', () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...a),
  isEmailConfigured: () => true,
}));

const { inviteCollaborator } = await import('../lib/storage');

beforeEach(() => {
  world.reset();
  sendEmail.mockClear();
  sendEmail.mockResolvedValue({ ok: true, id: 'email-1' });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  process.env.RESEND_API_KEY = 'test-key';
  world.tables.cases.push({
    id: 'case-1',
    title: 'A matter',
    user_id: 'owner-1',
  });
});

describe('a case owner inviting a collaborator', () => {
  it('adds a first-time invitee, which the narrowed UPDATE grant refuses through the member client', async () => {
    const { collaborator } = await inviteCollaborator({
      caseId: 'case-1',
      email: 'Colleague@Example.test',
      role: 'attorney',
    });

    expect(collaborator.email).toBe('colleague@example.test');
    expect(collaborator.role).toBe('attorney');
    // Asserted separately from the resolve: the person is really on the case.
    expect(world.tables.case_collaborators).toHaveLength(1);
    expect(world.tables.case_collaborators[0]).toMatchObject({
      case_id: 'case-1',
      email: 'colleague@example.test',
      role: 'attorney',
      invited_by: 'owner-1',
    });
  });

  it('re-invites someone already on the case, and their new role sticks', async () => {
    await inviteCollaborator({
      caseId: 'case-1',
      email: 'colleague@example.test',
      role: 'viewer',
    });
    const { collaborator } = await inviteCollaborator({
      caseId: 'case-1',
      email: 'colleague@example.test',
      role: 'attorney',
    });

    expect(collaborator.role).toBe('attorney');
    expect(world.tables.case_collaborators).toHaveLength(1);
    expect(world.tables.case_collaborators[0].role).toBe('attorney');
  });

  it('never asks the member client for a privilege the applied migration took away', async () => {
    await inviteCollaborator({
      caseId: 'case-1',
      email: 'colleague@example.test',
      role: 'viewer',
    });
    await inviteCollaborator({
      caseId: 'case-1',
      email: 'colleague@example.test',
      role: 'attorney',
    });

    // The member client may INSERT a collaborator, because that is what the
    // owner-scoped INSERT policy is for. It may not reach `role` through an
    // UPDATE or the DO UPDATE half of an upsert: that is the self-promotion
    // the migration closed, and re-opening it would be a worse bug than the
    // one being fixed.
    const escalating = world.memberWrites.filter(
      (w) =>
        w.table === 'case_collaborators' &&
        w.op !== 'insert' &&
        w.columns.some((c) => !AUTHENTICATED_UPDATABLE.has(c)),
    );
    expect(escalating).toEqual([]);
  });

  it('refuses a case the caller does not own', async () => {
    world.tables.cases.push({
      id: 'case-2',
      title: 'Someone else',
      user_id: 'stranger-9',
    });

    await expect(
      inviteCollaborator({
        caseId: 'case-2',
        email: 'colleague@example.test',
        role: 'viewer',
      }),
    ).rejects.toThrow(/only the case owner/i);
    expect(world.tables.case_collaborators).toHaveLength(0);
  });
});
