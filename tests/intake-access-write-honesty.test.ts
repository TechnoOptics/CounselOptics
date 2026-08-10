import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two intake actions that END an access somebody else is currently
 * relying on, and the dialogs that promise they did.
 *
 * revokeIntakeUploadRequestAction sets `revoked_at` on a tokenized PUBLIC
 * upload link. That column IS the revocation: lib/intake-upload-public.ts
 * reads it and nothing else decides whether the endpoint still accepts a
 * file. The link is already in an outside client's inbox, and the dialog
 * says "The link stops working for whoever it was sent to."
 *
 * removeIntakeParticipantAction deletes the row resolveAccess consults to
 * let a colleague read a privileged intake thread. The dialog says they
 * "lose sight of the conversation and everything filed with it".
 *
 * Both wrote and returned `{ ok: true }` without looking. PostgREST reports
 * an UPDATE or DELETE that matched no rows as `error: null`, so a write that
 * moved nothing was indistinguishable from one that worked, and the firm was
 * told an access was closed while it was open. The fake below models that
 * exactly and never invents an error for a zero-row match, because a fake
 * that did could not detect this defect class at all.
 *
 * Mutations these are meant to catch:
 *   - drop `.select(...)` on either write and return `{ ok: true }`: the
 *     zero-row tests go red.
 *   - stop binding `{ error }`: the transport-failure tests go red.
 *   - keep the checks but report `{ ok: true }` anyway: every negative test
 *     goes red.
 */

type Row = Record<string, unknown>;

const world = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  /**
   * Tables where a write matches nothing: the id is gone, the intake scope
   * does not hold, or a policy silently excluded the row. PostgREST answers
   * all three the same way, with `error: null` and no rows.
   */
  writeMatchesNothing: new Set<string>(),
  /** Tables whose next write reports a transport failure instead. */
  writeFails: new Set<string>(),
  reset() {
    this.tables = {
      firm_matter_intakes: [
        {
          id: 'intake-1',
          firm_id: 'firm-1',
          created_by: 'employee-1',
          client_name: 'Acme renewal',
          status: 'in_progress',
          assigned_to: null,
          intake_answers: {},
        },
      ],
      firm_intake_upload_requests: [
        {
          id: 'req-1',
          intake_id: 'intake-1',
          firm_id: 'firm-1',
          token: 'tok-abc',
          label: 'the signed NDA',
          revoked_at: null,
        },
      ],
      firm_intake_participants: [
        { id: 'p-1', intake_id: 'intake-1', user_id: 'colleague-1', role: 'watcher' },
      ],
    };
    this.writeMatchesNothing = new Set<string>();
    this.writeFails = new Set<string>();
  },
}));

function builder(table: string) {
  const preds: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'update' | 'delete' = 'select';
  let payload: Row = {};
  let selected = false;
  const rows = () => (world.tables[table] ??= []);

  const run = (): { data: unknown; error: unknown } => {
    if (op === 'update' || op === 'delete') {
      if (world.writeFails.has(table)) {
        return { data: null, error: { message: 'connection reset' } };
      }
      const hits = world.writeMatchesNothing.has(table)
        ? []
        : rows().filter((r) => preds.every((p) => p(r)));
      if (op === 'update') for (const r of hits) Object.assign(r, payload);
      else {
        const gone = new Set(hits.map((r) => r.id));
        world.tables[table] = rows().filter((r) => !gone.has(r.id));
      }
      // Without `.select()` PostgREST hands back nothing, whatever moved.
      return { data: selected ? hits.map((r) => ({ ...r })) : null, error: null };
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
    delete() {
      op = 'delete';
      return api;
    },
    eq(col: string, val: unknown) {
      preds.push((r) => r[col] === val);
      return api;
    },
    in(col: string, vals: unknown[]) {
      preds.push((r) => (vals as unknown[]).includes(r[col]));
      return api;
    },
    order: () => api,
    limit: () => api,
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

const client = { from: (t: string) => builder(t) };

/** The caller is a firm member, so only the write guard can refuse. */
const actor = { role: 'legal' as 'legal' | 'employee' };

vi.mock('../lib/supabase/admin', () => ({ createAdminSupabase: () => client }));
vi.mock('../lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  getCurrentUser: async () => ({ id: 'attorney-1', email: 'a@firm.test' }),
  createServerSupabase: () => client,
  requireUser: async () => ({ id: 'attorney-1' }),
}));
vi.mock('../lib/portal-entitlements', () => ({
  authorizeFirmActor: async () => ({ ok: true, role: actor.role }),
}));
vi.mock('../lib/intake-notify', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  revalidateIntake: () => {},
  hydratePeople: async () => new Map(),
  insertIntakeMessage: async () => null,
  notifyIntakeActivity: async () => {},
  siteUrl: () => 'https://example.test',
}));
vi.mock('../lib/rate-limit', () => ({ checkRateLimit: async () => true }));
vi.mock('../lib/partner-notify', () => ({ partnerTicketEvent: async () => {} }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const { removeIntakeParticipantAction, revokeIntakeUploadRequestAction } =
  await import('../lib/intake-conversation');

beforeEach(() => {
  world.reset();
  actor.role = 'legal';
});

describe('revoking a public upload link', () => {
  it('does not report a revocation when the write matched nothing', async () => {
    world.writeMatchesNothing.add('firm_intake_upload_requests');

    const res = await revokeIntakeUploadRequestAction('intake-1', 'req-1');

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not revoked/i);
    // The whole cost of the old behaviour: the endpoint an outside client
    // can still post files to, under a dialog that said it had stopped.
    expect(world.tables.firm_intake_upload_requests[0].revoked_at).toBeNull();
  });

  it('does not report a revocation the database refused', async () => {
    world.writeFails.add('firm_intake_upload_requests');

    const res = await revokeIntakeUploadRequestAction('intake-1', 'req-1');

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not revoked/i);
    expect(world.tables.firm_intake_upload_requests[0].revoked_at).toBeNull();
  });

  it('refuses a link that belongs to a different request', async () => {
    world.tables.firm_matter_intakes.push({
      id: 'intake-2',
      firm_id: 'firm-1',
      created_by: 'employee-2',
      client_name: 'Other matter',
      status: 'in_progress',
      assigned_to: null,
      intake_answers: {},
    });

    const res = await revokeIntakeUploadRequestAction('intake-2', 'req-1');

    expect(res.ok).toBe(false);
    expect(world.tables.firm_intake_upload_requests[0].revoked_at).toBeNull();
  });

  it('stamps revoked_at, and says so, when the link really closes', async () => {
    const res = await revokeIntakeUploadRequestAction('intake-1', 'req-1');

    expect(res).toEqual({ ok: true });
    expect(world.tables.firm_intake_upload_requests[0].revoked_at).toEqual(
      expect.any(String),
    );
  });
});

describe('removing someone from an intake conversation', () => {
  it('does not report a removal when the delete matched nothing', async () => {
    world.writeMatchesNothing.add('firm_intake_participants');

    const res = await removeIntakeParticipantAction('intake-1', 'colleague-1');

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not removed/i);
    // Still on the request is the whole problem: resolveAccess reads this
    // row, so they are still reading a privileged thread.
    expect(world.tables.firm_intake_participants).toHaveLength(1);
  });

  it('does not report a removal the database refused', async () => {
    world.writeFails.add('firm_intake_participants');

    const res = await removeIntakeParticipantAction('intake-1', 'colleague-1');

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not removed/i);
    expect(world.tables.firm_intake_participants).toHaveLength(1);
  });

  it('removes the row, and says so, when the caller really can', async () => {
    const res = await removeIntakeParticipantAction('intake-1', 'colleague-1');

    expect(res).toEqual({ ok: true });
    expect(world.tables.firm_intake_participants).toHaveLength(0);
  });

  it('still lets only the legal team end either access', async () => {
    actor.role = 'employee';
    // Made the requester, so resolveAccess admits them to the conversation
    // and the role check is the only thing left that can refuse the two
    // destructive actions.
    world.tables.firm_matter_intakes[0].created_by = 'attorney-1';

    const removed = await removeIntakeParticipantAction('intake-1', 'colleague-1');
    const revoked = await revokeIntakeUploadRequestAction('intake-1', 'req-1');

    expect(removed.ok).toBe(false);
    expect(revoked.ok).toBe(false);
    expect(world.tables.firm_intake_participants).toHaveLength(1);
    expect(world.tables.firm_intake_upload_requests[0].revoked_at).toBeNull();
  });
});
