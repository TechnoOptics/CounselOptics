import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SIGNER_NOT_YET_YOUR_TURN } from '../lib/signer-order';
import { INTERNAL_SIGNER_GATE_COPY } from '../lib/signer-view';

/**
 * The two gates this slice adds to the one signature write, exercised
 * rather than read.
 *
 * tests/signer-view.test.ts asserts the calls are WRITTEN, which is a
 * weak check and says so. This file drives recordSignature itself over a
 * fake database, because both gates are the kind that fail silently: a
 * session check that never runs still leaves a page that says "sign in",
 * and an ordering check that never runs still leaves a portal that hides
 * the button. Two controls in this repo have already been found existing
 * with nothing exercising them.
 *
 * What is faked is the database and the session, and nothing else. The
 * guards, the claim and the ordering arithmetic are the real ones.
 */

const appendSignatureEvent = vi.fn().mockResolvedValue(undefined);
const sendNextSignerInvite = vi.fn().mockResolvedValue({ ok: true });
const getRealCurrentUser = vi.fn();
const createAdminSupabase = vi.fn();

vi.mock('@/lib/esign-audit', () => ({
  appendSignatureEvent: (...args: unknown[]) => appendSignatureEvent(...args),
  sha256: (v: string) => `sha(${v})`,
}));
vi.mock('@/lib/signer-invite', () => ({
  sendNextSignerInvite: (...args: unknown[]) => sendNextSignerInvite(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  getRealCurrentUser: () => getRealCurrentUser(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => createAdminSupabase(),
}));

const { recordSignature } = await import('../lib/signature-write');

/**
 * A real 1x1 PNG.
 *
 * This fixture used to be `data:image/png;base64,aGVsbG8=`, which is the five
 * bytes of the word "hello" under a PNG label, and recordSignature accepted it
 * and put it in the bucket. The check it passed was a startsWith on the label,
 * and both halves of a data URL are written by whoever posts it. The write now
 * decodes through decodeSignaturePng and checks the eight magic bytes, so the
 * fixture has to be an actual image. The gates this file exercises are
 * unchanged; only the mark they are exercised with is now a real one.
 */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type SigRow = {
  id: string;
  signing_request_id: string;
  signed_at: string | null;
  signer_email: string;
  signer_name?: string | null;
  access_code_hash: string | null;
  access_code_verified_at: string | null;
  response: string | null;
  signer_order: number | null;
  token: string;
};

type World = {
  signatures: SigRow[];
  request: Record<string, unknown>;
  /** False models a database where 20260807_flow_join.sql is unapplied. */
  orderColumn: boolean;
  /** Set to fail the sibling read with something that is NOT a missing
   *  column, which must fail closed rather than read as "no ordering". */
  siblingReadError: { code: string; message: string } | null;
  /** Every update PostgREST was actually asked to run. */
  updates: Array<{
    table: string;
    payload: Record<string, unknown>;
    filters: Array<[string, string, unknown]>;
  }>;
};

let world: World;

const MISSING_COLUMN = {
  code: 'PGRST204',
  message: "Could not find the 'signer_order' column of 'firm_signatures'",
};

function matches(row: Record<string, unknown>, filters: Array<[string, string, unknown]>) {
  return filters.every(([kind, col, val]) => {
    if (kind === 'is') return (row[col] ?? null) === val;
    if (kind === 'in') return (val as unknown[]).includes(row[col]);
    return row[col] === val;
  });
}

/** A supabase-js shaped client over `world`. Thenable, like the real one. */
function fakeAdmin() {
  const build = (table: string) => {
    const filters: Array<[string, string, unknown]> = [];
    let op: 'select' | 'update' = 'select';
    let cols = '';
    let payload: Record<string, unknown> = {};

    const run = async (): Promise<{ data: unknown; error: unknown }> => {
      if (op === 'update') {
        world.updates.push({ table, payload, filters: [...filters] });
        const hits = rowsOf(table).filter((r) => matches(r, filters));
        for (const r of hits) Object.assign(r, payload);
        return { data: hits.map((r) => ({ id: r.id })), error: null };
      }
      if (table === 'firm_signatures') {
        if (cols.includes('signer_order')) {
          if (world.siblingReadError) {
            return { data: null, error: world.siblingReadError };
          }
          if (!world.orderColumn) return { data: null, error: MISSING_COLUMN };
        }
        // Projected to the requested columns, which is the whole point on
        // the unmigrated path: PostgREST cannot hand back a column the
        // table does not have, so a fake that returned the fixture's own
        // signer_order would let the fallback read as ordered and prove
        // nothing.
        const wanted = cols.split(',').map((c) => c.trim());
        const hits = world.signatures
          .filter((r) => matches(r, filters))
          .map((r) =>
            Object.fromEntries(
              wanted
                .filter((c) => c in r)
                .map((c) => [c, (r as unknown as Record<string, unknown>)[c]]),
            ),
          );
        return { data: hits, error: null };
      }
      if (table === 'firm_signing_requests') {
        return { data: matches(world.request, filters) ? world.request : null, error: null };
      }
      return { data: [], error: null };
    };

    const api: Record<string, unknown> = {
      select(c: string) {
        if (op !== 'update') cols = c;
        return api;
      },
      update(p: Record<string, unknown>) {
        op = 'update';
        payload = p;
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push(['eq', col, val]);
        return api;
      },
      is(col: string, val: unknown) {
        filters.push(['is', col, val]);
        return api;
      },
      in(col: string, val: unknown) {
        filters.push(['in', col, val]);
        return api;
      },
      order() {
        return api;
      },
      limit() {
        return api;
      },
      async maybeSingle() {
        const { data, error } = await run();
        return { data: Array.isArray(data) ? (data[0] ?? null) : data, error };
      },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
        return run().then(res, rej);
      },
    };
    return api;
  };

  const rowsOf = (table: string): Array<Record<string, unknown>> =>
    table === 'firm_signatures'
      ? (world.signatures as unknown as Array<Record<string, unknown>>)
      : table === 'firm_signing_requests'
        ? [world.request]
        : [];

  return {
    from: (table: string) => build(table),
    storage: {
      from: () => ({ upload: async () => ({ error: null }) }),
    },
    schema: () => ({ from: (t: string) => build(t) }),
  };
}

function signature(over: Partial<SigRow> = {}): SigRow {
  return {
    id: 'sig-1',
    signing_request_id: 'req-1',
    signed_at: null,
    signer_email: 'dana@firm.test',
    signer_name: 'Dana Reyes',
    access_code_hash: null,
    access_code_verified_at: null,
    response: null,
    signer_order: null,
    token: 'tok-1',
    ...over,
  };
}

beforeEach(() => {
  appendSignatureEvent.mockClear();
  sendNextSignerInvite.mockClear();
  sendNextSignerInvite.mockResolvedValue({ ok: true });
  getRealCurrentUser.mockReset();
  getRealCurrentUser.mockResolvedValue(null);
  world = {
    signatures: [signature()],
    request: {
      id: 'req-1',
      firm_id: 'firm-1',
      document_id: 'doc-1',
      status: 'sent',
      document_sha256: 'abc',
    },
    orderColumn: true,
    siblingReadError: null,
    updates: [],
  };
  createAdminSupabase.mockReturnValue(fakeAdmin());
});

const sign = (token = 'tok-1') =>
  recordSignature({
    locator: { kind: 'token', token },
    signatureDataUrl: PNG,
    ip: '203.0.113.7',
    userAgent: 'a browser',
    source: 'web',
  });

const claims = () =>
  world.updates.filter(
    (u) =>
      u.table === 'firm_signatures' &&
      Object.prototype.hasOwnProperty.call(u.payload, 'signed_at'),
  );

describe('an internal signer, who is issued no access code', () => {
  it('is refused outright when nobody is signed in', async () => {
    // The gap this closes. Before it, holding the durable link was
    // sufficient to produce this employee's signature on an executed
    // agreement, and the audit chain would have said nothing was wrong.
    const out = await sign();
    expect(out).toEqual({
      ok: false,
      status: 403,
      error: INTERNAL_SIGNER_GATE_COPY['sign-in-required'],
    });
    expect(claims()).toHaveLength(0);
    expect(appendSignatureEvent).not.toHaveBeenCalled();
  });

  it('is refused when the session belongs to somebody else', async () => {
    getRealCurrentUser.mockResolvedValue({ email: 'sam@firm.test' });
    const out = await sign();
    expect(out.ok).toBe(false);
    expect((out as { error: string }).error).toContain('waiting for a different account');
    // The expected address is named, and masked, so the right person can
    // recognise it and a stranger cannot learn it.
    expect((out as { error: string }).error).toContain('d•••@firm.test');
    expect((out as { error: string }).error).not.toContain('dana@firm.test');
    expect(claims()).toHaveLength(0);
  });

  it('signs when the session is theirs, whatever the case', async () => {
    getRealCurrentUser.mockResolvedValue({ email: 'Dana@Firm.TEST' });
    await expect(sign()).resolves.toEqual({ ok: true });
    expect(claims()).toHaveLength(1);
    expect(world.signatures[0].signed_at).toBeTruthy();
  });
});

describe('an external signer, whose code is their proof', () => {
  beforeEach(() => {
    world.signatures = [
      signature({
        signer_email: 'buyer@acme.test',
        access_code_hash: 'hash',
        access_code_verified_at: '2026-08-07T09:00:00.000Z',
      }),
    ];
  });

  it('signs with no session at all', async () => {
    // Requiring a counterparty to hold an account before they can sign
    // would break the flow this whole branch exists to build.
    await expect(sign()).resolves.toEqual({ ok: true });
    expect(claims()).toHaveLength(1);
  });

  it('is still refused when the code was never entered', async () => {
    // The pre-existing gate, untouched by the one added beside it.
    world.signatures[0].access_code_verified_at = null;
    const out = await sign();
    expect(out).toMatchObject({ ok: false, status: 403 });
    expect((out as { error: string }).error).toContain('access code');
    expect(claims()).toHaveLength(0);
  });
});

describe('signing order, enforced by the write and not by the page', () => {
  beforeEach(() => {
    world.signatures = [
      signature({
        id: 'sig-counterparty',
        token: 'tok-cp',
        signer_email: 'buyer@acme.test',
        access_code_hash: 'hash',
        access_code_verified_at: '2026-08-07T09:00:00.000Z',
        signer_order: 1,
      }),
      signature({ id: 'sig-employee', token: 'tok-emp', signer_order: 2 }),
    ];
    getRealCurrentUser.mockResolvedValue({ email: 'dana@firm.test' });
  });

  it('refuses the employee while the counterparty has not signed', async () => {
    // The employee is signed in as themselves and holds their own link.
    // The only thing wrong is the turn, and the write is what says so:
    // hiding the button on the portal is not a gate, because this
    // endpoint takes the token straight out of a request body.
    const out = await sign('tok-emp');
    expect(out).toEqual({ ok: false, status: 409, error: SIGNER_NOT_YET_YOUR_TURN });
    expect(claims()).toHaveLength(0);
    expect(world.signatures[1].signed_at).toBeNull();
  });

  it('lets the counterparty sign first and carries the order into the claim', async () => {
    await expect(sign('tok-cp')).resolves.toEqual({ ok: true });
    const claim = claims()[0];
    // The turn is not decided by a separate write in front of the claim.
    // It rides on the same conditional update, so a request whose signers
    // were reordered between the read and the write loses the claim
    // instead of taking a signature the new order forbids.
    expect(claim.filters).toContainEqual(['is', 'signed_at', null]);
    expect(claim.filters).toContainEqual(['eq', 'signer_order', 1]);
  });

  it('releases the employee once the counterparty is in', async () => {
    world.signatures[0].signed_at = '2026-08-07T11:00:00.000Z';
    await expect(sign('tok-emp')).resolves.toEqual({ ok: true });
    expect(world.signatures[1].signed_at).toBeTruthy();
  });

  it('emails the signer whose turn it has just become, and nobody else', async () => {
    await sign('tok-cp');
    expect(sendNextSignerInvite).toHaveBeenCalledTimes(1);
    expect(sendNextSignerInvite.mock.calls[0][1]).toBe('sig-employee');
  });

  it('does not re-invite somebody who was reachable all along', async () => {
    // Two unordered signers were both emailed when the request was
    // created. One signing does not make the other newly reachable, and
    // mailing them again would be noise.
    world.signatures = [
      signature({ id: 'sig-a', token: 'tok-a', signer_order: null }),
      signature({
        id: 'sig-b',
        token: 'tok-b',
        signer_email: 'sam@firm.test',
        signer_order: null,
      }),
    ];
    await sign('tok-a');
    expect(sendNextSignerInvite).not.toHaveBeenCalled();
  });
});

describe('a database that has not had the migration applied', () => {
  beforeEach(() => {
    world.orderColumn = false;
    world.signatures = [
      signature({ id: 'sig-a', token: 'tok-a', signer_order: 1 }),
      signature({
        id: 'sig-b',
        token: 'tok-b',
        signer_email: 'sam@firm.test',
        signer_order: 2,
      }),
    ];
    getRealCurrentUser.mockResolvedValue({ email: 'sam@firm.test' });
  });

  it('sees exactly the behaviour of last week: everyone may sign', async () => {
    // PostgREST refuses an entire statement that names a column the table
    // does not have. If this were not handled, a firm without the
    // migration would stop being able to sign anything at all.
    await expect(sign('tok-b')).resolves.toEqual({ ok: true });
  });

  it('keeps signer_order out of the claim, so the update is not refused too', async () => {
    await sign('tok-b');
    const claim = claims()[0];
    expect(claim.filters.map((f) => f[1])).not.toContain('signer_order');
    expect(claim.filters).toContainEqual(['is', 'signed_at', null]);
  });

  it('invites nobody, because nothing here knows about an order', async () => {
    await sign('tok-a');
    expect(sendNextSignerInvite).not.toHaveBeenCalled();
  });
});

describe('a read that failed for some other reason', () => {
  it('fails closed and retryably rather than reading as "no ordering"', async () => {
    // Narrowly scoped to a missing column, on purpose. Treating a
    // permission failure or a dropped connection as "this firm has no
    // ordering" would turn an infrastructure problem into a signature
    // taken out of turn.
    getRealCurrentUser.mockResolvedValue({ email: 'dana@firm.test' });
    world.siblingReadError = { code: '42501', message: 'permission denied' };
    const out = await sign();
    expect(out).toMatchObject({ ok: false, status: 503 });
    expect(claims()).toHaveLength(0);
  });
});

describe('the guarantees the new gates sit beside', () => {
  beforeEach(() => {
    getRealCurrentUser.mockResolvedValue({ email: 'dana@firm.test' });
  });

  it('still refuses a row that already carries signed_at', async () => {
    world.signatures[0].signed_at = '2026-08-07T11:00:00.000Z';
    const out = await sign();
    expect(out).toMatchObject({ ok: false, status: 410 });
    expect(claims()).toHaveLength(0);
  });

  it('still refuses a canceled request', async () => {
    world.request.status = 'canceled';
    await expect(sign()).resolves.toMatchObject({ ok: false, status: 410 });
  });

  it('still loses the claim to whoever wrote first', async () => {
    // The conditional claim is what holds when two pads submit together.
    // Adding the ordering filter to it must not have replaced the
    // signed_at condition with it.
    const admin = fakeAdmin();
    createAdminSupabase.mockReturnValue(admin);
    const original = admin.from;
    admin.from = ((table: string) => {
      const q = original(table) as Record<string, unknown>;
      const update = q.update as (p: Record<string, unknown>) => unknown;
      q.update = (p: Record<string, unknown>) => {
        // Somebody else claims the row between the guard and the write.
        if (table === 'firm_signatures' && 'signed_at' in p) {
          world.signatures[0].signed_at = '2026-08-07T11:59:00.000Z';
        }
        return update(p);
      };
      return q;
    }) as typeof admin.from;
    const out = await sign();
    expect(out).toMatchObject({ ok: false, status: 410 });
  });
});
