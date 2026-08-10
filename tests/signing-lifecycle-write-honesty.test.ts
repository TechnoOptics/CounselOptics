import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The signing lifecycle must not report a change the database refused.
 *
 * Every one of these four actions ends by asserting that its write landed:
 * a recall tells every signer the document is gone, a reopen tells them
 * their link is live again, a verified access code opens the gate, and a
 * response puts the whole instrument on hold. Three of them also append an
 * event to the tamper-evident chain, and that chain is offered as
 * evidence, attributed by name and address to the person the signature row
 * names. An event in it for a change that never happened is the worst
 * thing this file can produce.
 *
 * PostgREST does not raise on a zero-row match: an UPDATE that touches
 * nothing resolves `error: null`, and a write with no `.select()` resolves
 * `data: null` besides. All four writes ran unread, so all four could say
 * so with nothing behind them.
 *
 * The fake below models that behaviour exactly, and deliberately does NOT
 * turn a zero-row match into an error - a fake that did could not detect
 * this defect class at all. Every gate ahead of the write (role, firm,
 * status, access code, session, turn order) is held OPEN in each test, so
 * a refusal can only have come from the guard under test.
 */

const appendSignatureEvent = vi.fn().mockResolvedValue(undefined);
const createNotification = vi.fn().mockResolvedValue(undefined);
const getRealCurrentUser = vi.fn();
const requireActiveFirm = vi.fn().mockResolvedValue(undefined);

type Row = Record<string, unknown>;

const world = {
  tables: {} as Record<string, Row[]>,
  /** Tables whose writes match nothing, as an absent row would. */
  unmatched: new Set<string>(),
  /** Tables whose writes come back carrying an error. */
  failing: new Set<string>(),
  /** Tables whose writes reach at most N rows, as a partial filter would. */
  capped: new Map<string, number>(),
  /**
   * Fires the instant a write EXECUTES, before its predicates are
   * evaluated - the window a concurrent actor would use, and the only
   * honest way to test a claim made in the WHERE clause. Setting the row
   * up front instead would be answered by the read-time gate above, and
   * the test would pass without the predicate existing at all.
   */
  onWrite: null as null | (() => void),
  reset() {
    this.tables = { firm_signatures: [], firm_signing_requests: [] };
    this.unmatched = new Set<string>();
    this.failing = new Set<string>();
    this.capped = new Map<string, number>();
    this.onWrite = null;
  },
};

/**
 * A supabase-js shaped builder over `world`. Thenable, like the real one.
 *
 * Two details carry the whole point of this file:
 *   - a write with no `.select()` resolves `{ data: null, error: null }`,
 *     which is what PostgREST actually returns, and
 *   - a write that matches no rows is NOT an error.
 */
function builder(table: string) {
  const preds: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'update' = 'select';
  let payload: Row = {};
  let selected = false;

  const rows = () => (world.tables[table] ??= []);

  const run = (): { data: unknown; error: unknown } => {
    if (op === 'update') {
      if (world.onWrite) {
        const hook = world.onWrite;
        world.onWrite = null;
        hook();
      }
      if (world.failing.has(table)) {
        return { data: null, error: { message: `${table} write rejected` } };
      }
      let hits = world.unmatched.has(table)
        ? []
        : rows().filter((r) => preds.every((p) => p(r)));
      const cap = world.capped.get(table);
      if (cap !== undefined) hits = hits.slice(0, cap);
      for (const r of hits) Object.assign(r, payload);
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
    eq(col: string, val: unknown) {
      preds.push((r) => r[col] === val);
      return api;
    },
    is(col: string, val: unknown) {
      preds.push((r) => (r[col] ?? null) === val);
      return api;
    },
    in(col: string, vals: unknown[]) {
      preds.push((r) => (vals as unknown[]).includes(r[col]));
      return api;
    },
    order() {
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

const admin = {
  from: (t: string) => builder(t),
  rpc: async () => ({ data: null, error: null }),
};

const firmContext = {
  firm: { id: 'firm-1', name: 'Anderson Foundation' },
  membership: { role: 'attorney' },
};

vi.mock('@/lib/esign-audit', () => ({
  appendSignatureEvent: (...a: unknown[]) => appendSignatureEvent(...a),
  sha256: (v: string) => `sha(${v})`,
}));
vi.mock('@/lib/notifications', () => ({
  createNotification: (...a: unknown[]) => createNotification(...a),
}));
vi.mock('@/lib/firm-storage', () => ({
  getActiveFirmContext: async () => firmContext,
}));
vi.mock('@/lib/firm-authz', () => ({
  requireActiveFirm: (...a: unknown[]) => requireActiveFirm(...a),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => true }));
vi.mock('@/lib/supabase/server', () => ({
  getRealCurrentUser: () => getRealCurrentUser(),
  getCurrentUser: async () => null,
  createServerSupabase: () => ({ from: () => ({}) }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => admin }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const {
  recallSigningRequestAction,
  reopenSigningRequestAction,
  verifyAccessCodeAction,
  respondToSignatureAction,
} = await import('../lib/signing-actions');

function seedRequest(over: Row = {}) {
  world.tables.firm_signing_requests.push({
    id: 'req-1',
    firm_id: 'firm-1',
    status: 'sent',
    document_id: 'doc-1',
    requested_by: 'user-partner',
    ...over,
  });
}
function seedSignature(over: Row = {}) {
  world.tables.firm_signatures.push({
    id: 'sig-1',
    signing_request_id: 'req-1',
    token: 'tok-1',
    signer_email: 'dana@firm.test',
    signer_name: 'Dana Reyes',
    signed_at: null,
    response: null,
    response_note: null,
    responded_at: null,
    signer_order: null,
    access_code_hash: null,
    access_code_verified_at: null,
    access_attempts: 0,
    ...over,
  });
}

beforeEach(() => {
  world.reset();
  appendSignatureEvent.mockClear();
  createNotification.mockClear();
  requireActiveFirm.mockClear();
  getRealCurrentUser.mockReset();
  getRealCurrentUser.mockResolvedValue({ email: 'dana@firm.test' });
});

describe('recalling a request that the database did not cancel', () => {
  beforeEach(() => {
    seedRequest();
    seedSignature({ signer_user_id: 'user-signer' });
  });

  it('refuses rather than telling every signer the document is gone', async () => {
    world.unmatched.add('firm_signing_requests');

    const res = await recallSigningRequestAction('req-1');

    expect(res).toEqual({
      ok: false,
      error: 'This request could not be recalled just now. Reload and try again.',
    });
    // Asserted separately from the refusal: a gate that still refuses but
    // has drifted below its side effects would pass the line above.
    expect(appendSignatureEvent).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
    expect(world.tables.firm_signing_requests[0].status).toBe('sent');
  });

  it('refuses when the write comes back carrying an error', async () => {
    world.failing.add('firm_signing_requests');

    const res = await recallSigningRequestAction('req-1');

    expect(res.ok).toBe(false);
    expect(appendSignatureEvent).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('still recalls, and says so, when the row really moves', async () => {
    const res = await recallSigningRequestAction('req-1');

    expect(res).toEqual({ ok: true });
    expect(world.tables.firm_signing_requests[0].status).toBe('canceled');
    expect(appendSignatureEvent).toHaveBeenCalledTimes(1);
    expect(appendSignatureEvent.mock.calls[0][1]).toMatchObject({
      eventType: 'recalled',
    });
    expect(createNotification).toHaveBeenCalledTimes(1);
  });
});

describe('reopening a request whose links did not come back', () => {
  beforeEach(() => {
    seedRequest({ status: 'rejected' });
    seedSignature({
      signer_user_id: 'user-signer',
      response: 'rejected',
      responded_at: '2026-08-07T10:00:00.000Z',
    });
  });

  it('refuses rather than telling a signer a dead link is live again', async () => {
    world.unmatched.add('firm_signatures');

    const res = await reopenSigningRequestAction('req-1');

    expect(res).toEqual({
      ok: false,
      error: 'This request could not be reopened just now. Reload and try again.',
    });
    expect(appendSignatureEvent).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
    // The response is what makes the link dead, so it is the thing to check.
    expect(world.tables.firm_signatures[0].response).toBe('rejected');
    expect(world.tables.firm_signing_requests[0].status).toBe('rejected');
  });

  it('refuses when only some of the objecting signers are cleared', async () => {
    // Two signers on hold and the write reaches one of them. A plain
    // "did anything move" check passes here, which is why the guard counts
    // the rows: clearing one of two responses and then telling both that
    // their link works is the same lie in a smaller size.
    seedSignature({
      id: 'sig-2',
      token: 'tok-2',
      signer_email: 'sam@firm.test',
      signer_user_id: 'user-signer-2',
      response: 'changes_requested',
    });
    world.capped.set('firm_signatures', 1);

    const res = await reopenSigningRequestAction('req-1');

    expect(res.ok).toBe(false);
    expect(appendSignatureEvent).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
    // The second signer's link is still dead, which is the point.
    expect(world.tables.firm_signatures[1].response).toBe('changes_requested');
  });

  it('still reopens when the responses really clear', async () => {
    const res = await reopenSigningRequestAction('req-1');

    expect(res).toEqual({ ok: true });
    expect(world.tables.firm_signatures[0].response).toBeNull();
    expect(world.tables.firm_signing_requests[0].status).toBe('sent');
    expect(appendSignatureEvent).toHaveBeenCalledTimes(1);
  });
});

describe('an access code that was right but did not unlock anything', () => {
  beforeEach(() => {
    seedRequest();
    seedSignature({ access_code_hash: 'sha(ABCD)' });
  });

  it('refuses rather than reporting a gate it did not open', async () => {
    world.unmatched.add('firm_signatures');

    const res = await verifyAccessCodeAction('tok-1', 'ABCD');

    expect(res).toEqual({
      ok: false,
      error: 'That code could not be checked just now. Please try again shortly.',
    });
    // No 'access_verified' in the chain for a gate that is still shut.
    expect(appendSignatureEvent).not.toHaveBeenCalled();
    expect(world.tables.firm_signatures[0].access_code_verified_at).toBeNull();
  });

  it('unlocks and records it when the stamp really lands', async () => {
    const res = await verifyAccessCodeAction('tok-1', 'ABCD');

    expect(res).toEqual({ ok: true });
    expect(world.tables.firm_signatures[0].access_code_verified_at).toEqual(
      expect.any(String),
    );
    expect(appendSignatureEvent.mock.calls[0][1]).toMatchObject({
      eventType: 'access_verified',
    });
  });
});

describe('a decline the database never took', () => {
  beforeEach(() => {
    seedRequest();
    seedSignature();
  });

  it('puts no event in the chain and tells nobody it was declined', async () => {
    world.unmatched.add('firm_signatures');

    const res = await respondToSignatureAction('tok-1', 'rejected', 'Not this version.');

    expect(res).toEqual({
      ok: false,
      error: 'This could not be recorded just now. Please try again shortly.',
    });
    // The central assertion of this file: nothing entered the chain
    // carrying this signer's address, and the instrument is not on hold.
    expect(appendSignatureEvent).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
    expect(world.tables.firm_signatures[0].response).toBeNull();
    expect(world.tables.firm_signing_requests[0].status).toBe('sent');
  });

  it('refuses when the write comes back carrying an error', async () => {
    world.failing.add('firm_signatures');

    const res = await respondToSignatureAction('tok-1', 'rejected', 'No.');

    expect(res.ok).toBe(false);
    expect(appendSignatureEvent).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('loses the race to a response that got there first', async () => {
    // A genuine race, not a row that was already on hold when the action
    // started: the read-time gate would have answered that one, and this
    // test would then pass with no predicate on the write at all. The
    // second response lands while this one is executing, so only the
    // claim on response IS NULL can refuse it.
    world.onWrite = () => {
      world.tables.firm_signatures[0].response = 'changes_requested';
      world.tables.firm_signatures[0].responded_at = '2026-08-07T12:00:00.000Z';
    };

    const res = await respondToSignatureAction('tok-1', 'rejected', 'No.');

    expect(res.ok).toBe(false);
    expect(appendSignatureEvent).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
    // The first response stands; two clicks did not both reach the chain.
    expect(world.tables.firm_signatures[0].response).toBe('changes_requested');
    expect(world.tables.firm_signing_requests[0].status).toBe('sent');
  });

  it('records the decline, and speaks for it, when the row really moves', async () => {
    const res = await respondToSignatureAction('tok-1', 'rejected', 'Not this version.');

    expect(res).toEqual({ ok: true });
    expect(world.tables.firm_signatures[0].response).toBe('rejected');
    expect(world.tables.firm_signing_requests[0].status).toBe('rejected');
    expect(appendSignatureEvent.mock.calls[0][1]).toMatchObject({
      eventType: 'rejected',
      signerEmail: 'dana@firm.test',
    });
    expect(createNotification).toHaveBeenCalledTimes(1);
  });
});
