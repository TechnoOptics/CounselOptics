import { beforeEach, describe, expect, it, vi } from 'vitest';
import { methodRefusalSentence } from '../lib/signature-methods';

/**
 * The server's refusal of a signature method the firm forbade, driven rather
 * than read.
 *
 * WHY THIS FILE EXISTS AT ALL. Hiding a tab in the signer's page is not a
 * control: /api/firm/sign takes a token out of a request body and every
 * 'use server' export in this application is a public HTTP endpoint. The
 * question these tests answer is the only one that matters for an instrument
 * offered as evidence - what does an attacker get when they post a forbidden
 * method directly - and it is answered by calling recordSignature with one.
 *
 * What is faked is the database, the session and the audit sink. The gate,
 * the decode, the claim and the metadata are the real ones.
 *
 * A NOTE ON THE PNG FIXTURE. It is a real 1x1 PNG, and it has to be: the
 * write now decodes the data URL through decodeSignaturePng, which checks the
 * eight magic bytes rather than the media type the caller declared. A fixture
 * of the string "hello" under a PNG label passed the old check and is exactly
 * what the new one exists to refuse.
 */

const appendSignatureEvent = vi.fn().mockResolvedValue(undefined);
const getRealCurrentUser = vi.fn();
const createAdminSupabase = vi.fn();

vi.mock('@/lib/esign-audit', () => ({
  appendSignatureEvent: (...args: unknown[]) => appendSignatureEvent(...args),
  sha256: (v: string) => `sha(${v})`,
}));
vi.mock('@/lib/signer-invite', () => ({
  sendNextSignerInvite: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getRealCurrentUser: () => getRealCurrentUser(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => createAdminSupabase(),
}));

const { recordSignature } = await import('../lib/signature-write');

/** A real 1x1 PNG. See the note in the file header. */
const PNG_BYTES =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG = `data:image/png;base64,${PNG_BYTES}`;

type SigRow = Record<string, unknown> & { id: string };

type World = {
  signatures: SigRow[];
  request: Record<string, unknown>;
  uploads: Array<{ path: string }>;
};

let world: World;

function matches(row: Record<string, unknown>, filters: Array<[string, string, unknown]>) {
  return filters.every(([kind, col, val]) => {
    if (kind === 'is') return (row[col] ?? null) === val;
    if (kind === 'in') return (val as unknown[]).includes(row[col]);
    return row[col] === val;
  });
}

function fakeAdmin() {
  const rowsOf = (table: string): Array<Record<string, unknown>> =>
    table === 'firm_signatures'
      ? world.signatures
      : table === 'firm_signing_requests'
        ? [world.request]
        : [];

  const build = (table: string) => {
    const filters: Array<[string, string, unknown]> = [];
    let op: 'select' | 'update' = 'select';
    let cols = '';
    let payload: Record<string, unknown> = {};

    const run = async (): Promise<{ data: unknown; error: unknown }> => {
      if (op === 'update') {
        const hits = rowsOf(table).filter((r) => matches(r, filters));
        for (const r of hits) Object.assign(r, payload);
        return { data: hits.map((r) => ({ id: r.id })), error: null };
      }
      if (table === 'firm_signatures') {
        const wanted = cols.split(',').map((c) => c.trim());
        return {
          data: world.signatures
            .filter((r) => matches(r, filters))
            .map((r) =>
              Object.fromEntries(wanted.filter((c) => c in r).map((c) => [c, r[c]])),
            ),
          error: null,
        };
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
      order: () => api,
      limit: () => api,
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

  return {
    from: (table: string) => build(table),
    storage: {
      from: () => ({
        upload: async (path: string) => {
          world.uploads.push({ path });
          return { error: null };
        },
      }),
    },
    schema: () => ({ from: (t: string) => build(t) }),
  };
}

/** Set the frozen restriction on the request under test. */
function restrictTo(methods: string[] | null) {
  world.request.signature_methods = methods;
}

beforeEach(() => {
  appendSignatureEvent.mockClear();
  getRealCurrentUser.mockReset();
  getRealCurrentUser.mockResolvedValue(null);
  world = {
    signatures: [
      {
        id: 'sig-1',
        signing_request_id: 'req-1',
        signed_at: null,
        signer_email: 'dana@outside.test',
        signer_name: 'Dana Reyes',
        // A hash present and verified makes this an EXTERNAL signer who has
        // already cleared the access-code gate, so these tests exercise the
        // method gate rather than tripping over identity first.
        access_code_hash: 'hash',
        access_code_verified_at: '2026-08-10T00:00:00.000Z',
        response: null,
        signer_order: null,
        token: 'tok-1',
      },
    ],
    request: {
      id: 'req-1',
      firm_id: 'firm-1',
      document_id: 'doc-1',
      status: 'sent',
      document_sha256: 'abc',
      signature_methods: null,
    },
    uploads: [],
  };
  createAdminSupabase.mockReturnValue(fakeAdmin());
});

const sign = (over: Record<string, unknown> = {}) =>
  recordSignature({
    locator: { kind: 'token', token: 'tok-1' },
    signatureDataUrl: PNG,
    ip: '203.0.113.7',
    userAgent: 'vitest',
    source: 'web',
    ...over,
  } as Parameters<typeof recordSignature>[0]);

const signedEvent = () =>
  appendSignatureEvent.mock.calls
    .map((c) => c[1] as { eventType: string; metadata?: Record<string, unknown> })
    .find((e) => e.eventType === 'signed');

describe('a method the firm forbade', () => {
  it('is refused by the server, not merely hidden on the page', async () => {
    restrictTo(['draw', 'type']);
    const result = await sign({ method: 'upload' });
    expect(result).toEqual({
      ok: false,
      status: 403,
      error: methodRefusalSentence('upload'),
    });
  });

  /**
   * The refusal has to happen BEFORE the row is claimed. A gate that returns
   * an error after writing signed_at has not refused anything: it has
   * recorded the signature and then complained, and the signer can never
   * retry because their own row is now taken.
   */
  it('leaves the signature unclaimed and unstamped', async () => {
    restrictTo(['draw', 'type']);
    await sign({ method: 'upload' });
    expect(world.signatures[0].signed_at).toBeNull();
    expect(world.signatures[0].signature_image_path ?? null).toBeNull();
    expect(world.uploads).toEqual([]);
  });

  it('writes nothing to the audit chain', async () => {
    restrictTo(['draw', 'type']);
    await sign({ method: 'upload' });
    expect(signedEvent()).toBeUndefined();
  });

  /**
   * Fail closed. Omitting the field must not be the way past a restriction,
   * or the control is one deleted JSON key wide.
   */
  it('is refused when the caller declines to say which method they used', async () => {
    restrictTo(['draw']);
    const result = await sign({});
    expect(result.ok).toBe(false);
    expect(world.signatures[0].signed_at).toBeNull();
  });
});

describe('a method the firm allows', () => {
  it('is recorded', async () => {
    restrictTo(['draw', 'type']);
    expect(await sign({ method: 'draw' })).toEqual({ ok: true });
    expect(world.signatures[0].signed_at).not.toBeNull();
  });

  /**
   * The method is evidence about how an instrument was executed, so it goes
   * on the record rather than being inferable only from a browser that has
   * since closed.
   */
  it('names the method in the signed event', async () => {
    restrictTo(['draw', 'type']);
    await sign({ method: 'type' });
    expect(signedEvent()?.metadata?.signature_method).toBe('type');
  });
});

describe('a request with no restriction recorded', () => {
  it('still signs for a client that sends no method at all', async () => {
    restrictTo(null);
    expect(await sign({})).toEqual({ ok: true });
  });

  /**
   * Unspecified, and said so. Writing 'draw' here because most signatures are
   * drawn would put a guess into an evidentiary record.
   */
  it('records the method as null rather than guessing one', async () => {
    restrictTo(null);
    await sign({});
    expect(signedEvent()?.metadata?.signature_method).toBeNull();
  });

  it('records a method the client did send', async () => {
    restrictTo(null);
    await sign({ method: 'upload' });
    expect(signedEvent()?.metadata?.signature_method).toBe('upload');
  });
});

describe('the phone handoff', () => {
  /**
   * The server decides this one. A phone that claimed 'draw' would otherwise
   * walk straight through a firm that had forbidden the handoff, because the
   * mark a phone makes IS a drawn one.
   */
  it('is recorded as phone whatever the caller claims', async () => {
    restrictTo(null);
    await sign({ source: 'mobile_handoff', method: 'draw', handoffId: 'h-1' });
    expect(signedEvent()?.metadata?.signature_method).toBe('phone');
  });

  it('is refused when the firm did not allow signing on a phone', async () => {
    restrictTo(['draw', 'type']);
    const result = await sign({
      source: 'mobile_handoff',
      method: 'draw',
      handoffId: 'h-1',
    });
    expect(result.ok).toBe(false);
    expect(world.signatures[0].signed_at).toBeNull();
  });
});

describe('the uploaded image itself', () => {
  /**
   * The bytes are what is checked, never the media type, because both halves
   * of a data URL are written by the caller. The old gate was a startsWith on
   * that label and would have accepted this.
   */
  it('is refused when the bytes are not a PNG however the URL is labelled', async () => {
    restrictTo(null);
    const result = await sign({
      method: 'upload',
      signatureDataUrl: `data:image/png;base64,${Buffer.from('<svg onload=alert(1)>').toString('base64')}`,
    });
    expect(result.ok).toBe(false);
    expect(world.signatures[0].signed_at).toBeNull();
  });

  it('is refused when it is larger than the cap', async () => {
    restrictTo(null);
    const huge = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(600 * 1024, 0x41),
    ]);
    const result = await sign({
      method: 'upload',
      signatureDataUrl: `data:image/png;base64,${huge.toString('base64')}`,
    });
    expect(result.ok).toBe(false);
    expect(world.signatures[0].signed_at).toBeNull();
  });

  it('lands under its own firm and request prefix', async () => {
    restrictTo(null);
    await sign({ method: 'upload' });
    expect(world.uploads).toEqual([{ path: 'firm-1/req-1/sig-1.png' }]);
  });

  /**
   * The segments are database uuids today, so this is not currently
   * reachable. It is checked anyway because the path is what keeps one firm's
   * marks out of another's prefix, and "the ids happen to be uuids" is a
   * property of the callers rather than of this function.
   */
  it('refuses to build a path out of a segment carrying separators', async () => {
    restrictTo(null);
    world.request.firm_id = '../firm-2';
    const result = await sign({ method: 'upload' });
    expect(result.ok).toBe(false);
    expect(world.uploads).toEqual([]);
  });
});

/**
 * A browser cannot have signed on a phone.
 *
 * 'phone' is the one method the server can actually establish, and it is the
 * only one that buys a firm anything checkable: the handoff burns a one-time
 * token, binds a cookie to the scanning device, and records that device's IP
 * and user agent on its own row. A web caller was able to simply claim it,
 * which defeated a phone-only restriction outright and put a provenance in
 * the chain that no handoff row backed.
 *
 * The derivation is now symmetric. The server writes 'phone' on the handoff
 * path and refuses to read it anywhere else.
 */
describe('a phone claimed from a browser', () => {
  it('cannot satisfy a phone-only restriction', async () => {
    restrictTo(['phone']);
    const result = await sign({ method: 'phone' });
    expect(result.ok).toBe(false);
    expect(world.signatures[0].signed_at).toBeNull();
  });

  it('is not written into the chain on an unrestricted request either', async () => {
    restrictTo(null);
    await sign({ method: 'phone' });
    expect(signedEvent()?.metadata?.signature_method).toBeNull();
  });
});

/**
 * How much the recorded method is worth, said in the record itself.
 *
 * Draw, type and upload all produce one PNG data URL and the server cannot
 * tell them apart, so for those three the value is the signer's own account of
 * what they did. The handoff is different: the server puts 'phone' there
 * itself. A reader of an evidentiary record must not have to know which of
 * those two happened, so the record says.
 */
describe('the provenance of the recorded method', () => {
  it('is attributed to the signer on the web path', async () => {
    restrictTo(null);
    await sign({ method: 'draw' });
    expect(signedEvent()?.metadata?.signature_method_attested_by).toBe('signer');
  });

  it('is attributed to the server on the handoff path', async () => {
    restrictTo(null);
    await sign({ source: 'mobile_handoff', handoffId: 'h-1' });
    expect(signedEvent()?.metadata?.signature_method_attested_by).toBe('server');
  });
});
