import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SIGNER_NOT_YET_YOUR_TURN } from '../lib/signer-order';
import { INTERNAL_SIGNER_GATE_COPY } from '../lib/signer-view';

/**
 * respondToSignatureAction, the second thing a signing token can do.
 *
 * Declining is not a lesser act than signing. It puts the instrument on
 * hold, stops every other signer's link working, and writes an event into
 * the tamper-evident chain attributed by name and address to the person the
 * signature row names. That chain is offered as evidence, so this file's
 * central assertion is not that a refused caller sees an error: it is that
 * a refused caller leaves NOTHING behind, and above all no chain event
 * carrying somebody else's address.
 *
 * The gates being exercised are lib/signature-write.ts's gates. That path
 * enforced them and this one did not, which meant a forwarded /sign link
 * could reject in an employee's name with no session and no access code.
 *
 * What is faked is the database, the session and the audit sink. The gates,
 * the ordering arithmetic and the action's own control flow are real.
 */

const appendSignatureEvent = vi.fn().mockResolvedValue(undefined);
const createNotification = vi.fn().mockResolvedValue(undefined);
const getRealCurrentUser = vi.fn();
const createAdminSupabase = vi.fn();

vi.mock('@/lib/esign-audit', () => ({
  appendSignatureEvent: (...args: unknown[]) => appendSignatureEvent(...args),
  sha256: (v: string) => `sha(${v})`,
}));
vi.mock('@/lib/notifications', () => ({
  createNotification: (...args: unknown[]) => createNotification(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  getRealCurrentUser: () => getRealCurrentUser(),
  getCurrentUser: async () => null,
  createServerSupabase: () => ({ from: () => ({}) }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => createAdminSupabase(),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const { respondToSignatureAction } = await import('../lib/signing-actions');

type SigRow = {
  id: string;
  signing_request_id: string;
  signed_at: string | null;
  signer_email: string;
  signer_name: string | null;
  access_code_hash: string | null;
  access_code_verified_at: string | null;
  response: string | null;
  responded_at: string | null;
  signer_order: number | null;
  token: string;
};

type World = {
  signatures: SigRow[];
  request: Record<string, unknown>;
  /** Every update PostgREST was actually asked to run. */
  updates: Array<{ table: string; payload: Record<string, unknown> }>;
};

let world: World;

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

    const rowsOf = (t: string): Array<Record<string, unknown>> =>
      t === 'firm_signatures'
        ? (world.signatures as unknown as Array<Record<string, unknown>>)
        : t === 'firm_signing_requests'
          ? [world.request]
          : [];

    const run = async (): Promise<{ data: unknown; error: unknown }> => {
      if (op === 'update') {
        world.updates.push({ table, payload });
        const hits = rowsOf(table).filter((r) => matches(r, filters));
        for (const r of hits) Object.assign(r, payload);
        return { data: hits.map((r) => ({ id: r.id })), error: null };
      }
      if (table === 'firm_signatures') {
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
        return {
          data: matches(world.request, filters) ? world.request : null,
          error: null,
        };
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

  return { from: (table: string) => build(table) };
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
    responded_at: null,
    signer_order: null,
    token: 'tok-1',
    ...over,
  };
}

beforeEach(() => {
  appendSignatureEvent.mockClear();
  createNotification.mockClear();
  getRealCurrentUser.mockReset();
  getRealCurrentUser.mockResolvedValue(null);
  world = {
    signatures: [signature()],
    request: {
      id: 'req-1',
      firm_id: 'firm-1',
      document_id: 'doc-1',
      status: 'sent',
      requested_by: 'user-partner',
      document_sha256: 'abc',
    },
    updates: [],
  };
  createAdminSupabase.mockReturnValue(fakeAdmin());
});

const reject = (token = 'tok-1') =>
  respondToSignatureAction(token, 'rejected', 'Not the version we agreed.');

/** Did anything at all land on the record? */
const wrote = () => world.updates.length > 0;

describe('an internal signer, who is issued no access code', () => {
  it('cannot be declined for by a stranger holding the link', async () => {
    // The gap this closes. The durable /sign URL is emailed, forwarded and
    // kept alive for the retention window, and possession of it was enough
    // to put another firm's instrument on hold in this employee's name.
    const out = await reject();
    expect(out).toEqual({
      ok: false,
      error: INTERNAL_SIGNER_GATE_COPY['sign-in-required'],
    });
    expect(wrote()).toBe(false);
    // The part that matters most: nothing entered the chain claiming to be
    // this signer.
    expect(appendSignatureEvent).not.toHaveBeenCalled();
    expect(world.signatures[0].response).toBeNull();
    expect(world.request.status).toBe('sent');
  });

  it('cannot be declined for by somebody signed in as themselves', async () => {
    getRealCurrentUser.mockResolvedValue({ email: 'sam@firm.test' });
    const out = await reject();
    expect(out.ok).toBe(false);
    expect(out.error).toContain('waiting for a different account');
    expect(out.error).toContain('d•••@firm.test');
    expect(out.error).not.toContain('dana@firm.test');
    expect(wrote()).toBe(false);
    expect(appendSignatureEvent).not.toHaveBeenCalled();
  });

  it('may decline when the session is theirs, whatever the case', async () => {
    getRealCurrentUser.mockResolvedValue({ email: 'Dana@Firm.TEST' });
    await expect(reject()).resolves.toEqual({ ok: true });
    expect(world.signatures[0].response).toBe('rejected');
    expect(world.request.status).toBe('rejected');
    // The event is attributed to the person who actually performed it.
    expect(appendSignatureEvent).toHaveBeenCalledTimes(1);
    expect(appendSignatureEvent.mock.calls[0][1]).toMatchObject({
      eventType: 'rejected',
      signatureId: 'sig-1',
      signerEmail: 'dana@firm.test',
    });
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

  it('may decline with no session at all', async () => {
    // A counterparty is a stranger to this app. Requiring an account to
    // say no would leave them with no way out but silence.
    await expect(reject()).resolves.toEqual({ ok: true });
    expect(world.signatures[0].response).toBe('rejected');
  });

  it('is refused when the code was never entered', async () => {
    // A link forwarded without its code must not be able to act on the
    // request behind it, which is exactly what the signature write says.
    world.signatures[0].access_code_verified_at = null;
    const out = await reject();
    expect(out.ok).toBe(false);
    expect(out.error).toContain('access code');
    expect(wrote()).toBe(false);
    expect(appendSignatureEvent).not.toHaveBeenCalled();
  });
});

describe('a signer whose turn has not come', () => {
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

  it('cannot put the instrument on hold before they are even invited', async () => {
    const out = await reject('tok-emp');
    expect(out).toEqual({ ok: false, error: SIGNER_NOT_YET_YOUR_TURN });
    expect(wrote()).toBe(false);
    expect(world.request.status).toBe('sent');
  });

  it('may decline once their turn has come', async () => {
    world.signatures[0].signed_at = '2026-08-07T11:00:00.000Z';
    await expect(reject('tok-emp')).resolves.toEqual({ ok: true });
    expect(world.signatures[1].response).toBe('rejected');
  });
});

describe('the guarantees this sits beside', () => {
  beforeEach(() => {
    getRealCurrentUser.mockResolvedValue({ email: 'dana@firm.test' });
  });

  it('refuses a second response on a link already on hold', async () => {
    world.signatures[0].response = 'changes_requested';
    const out = await reject();
    expect(out.ok).toBe(false);
    expect(out.error).toContain('on hold');
    expect(wrote()).toBe(false);
  });

  it('still refuses a signer who has already signed', async () => {
    world.signatures[0].signed_at = '2026-08-07T11:00:00.000Z';
    const out = await reject();
    expect(out.ok).toBe(false);
    expect(wrote()).toBe(false);
  });

  it('still refuses a recalled request', async () => {
    world.request.status = 'canceled';
    const out = await reject();
    expect(out.ok).toBe(false);
    expect(wrote()).toBe(false);
  });

  it('refuses an unknown token', async () => {
    const out = await reject('not-a-token');
    expect(out).toEqual({ ok: false, error: 'Sign link not found.' });
    expect(wrote()).toBe(false);
  });
});
