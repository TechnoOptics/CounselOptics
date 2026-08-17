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

/**
 * A phone-only document, signed on the phone itself.
 *
 * The signer page stopped offering the QR handoff to somebody already holding a
 * phone, because scanning a code with the device displaying it is a loop rather
 * than a handoff. That leaves a document restricted to ['phone'] exactly one
 * route on a phone - drawing directly on it - and this gate is what decides
 * whether that route reaches a record or a 403. Before the device was read here
 * it was a 403, so the page would have offered a pad whose every mark this
 * function threw away.
 *
 * THE INVARIANT THESE TESTS EXIST FOR, and it is sharper than the employee
 * form's: this path writes signature_method AND signature_method_attested_by.
 * Widening what may be SIGNED must never widen what is CLAIMED about it. A
 * person drawing on their phone made a DRAWN signature on a phone, attested by
 * nobody but themselves. The handoff's 'phone' attested_by 'server' is a
 * different and stronger claim, backed by a burned one-time token and a cookie
 * bound to the scanning device, and on an executed instrument that difference is
 * the evidentiary record.
 */
const PHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

describe('a document restricted to the phone, signed from a phone', () => {
  it('accepts the drawn mark instead of refusing the only route it has', async () => {
    restrictTo(['phone']);
    expect(await sign({ method: 'draw', userAgent: PHONE_UA })).toEqual({ ok: true });
    expect(world.signatures[0].signed_at).not.toBeNull();
  });

  /**
   * THE INVARIANT. Being on a phone widened what could be drawn. It did not
   * manufacture the attestation, and a record saying 'phone' here would claim a
   * handoff that never happened.
   */
  it('records it as a drawn signature and not as the phone method', async () => {
    restrictTo(['phone']);
    await sign({ method: 'draw', userAgent: PHONE_UA });
    expect(signedEvent()?.metadata?.signature_method).toBe('draw');
  });

  /** The other half of the same invariant: the server did not vouch for this. */
  it('still attributes the method to the signer, not to the server', async () => {
    restrictTo(['phone']);
    await sign({ method: 'draw', userAgent: PHONE_UA });
    expect(signedEvent()?.metadata?.signature_method_attested_by).toBe('signer');
  });

  /**
   * The user agent is the caller's own string. It may open the drawn door, and
   * it may never be the thing that mints an attestation: a POST claiming
   * 'phone' with no handoff behind it is still read as having said nothing, and
   * a restricted request still refuses it.
   */
  it('does not let a browser claim the phone method by sending a phone user agent', async () => {
    restrictTo(['phone']);
    const result = await sign({ method: 'phone', userAgent: PHONE_UA });
    expect(result.ok).toBe(false);
    expect(world.signatures[0].signed_at).toBeNull();
  });

  it('does not widen anything else the firm forbade', async () => {
    restrictTo(['phone']);
    const result = await sign({ method: 'upload', userAgent: PHONE_UA });
    expect(result.ok).toBe(false);
    expect(world.signatures[0].signed_at).toBeNull();
  });

  /** The desk is unchanged, which is what makes this a resolution and not a
   *  loosening: there the QR is still the route and still the only one. */
  it('is still refused on a desktop, where the handoff is the route', async () => {
    restrictTo(['phone']);
    const result = await sign({ method: 'draw', userAgent: DESKTOP_UA });
    expect(result.ok).toBe(false);
    expect(world.signatures[0].signed_at).toBeNull();
  });

  /** A restriction naming no method names no phone either. Being on a phone
   *  must not turn a document nobody can sign into one anybody can. */
  it('does not rescue a restriction that names no method at all', async () => {
    restrictTo([]);
    const result = await sign({ method: 'draw', userAgent: PHONE_UA });
    expect(result.ok).toBe(false);
    expect(world.signatures[0].signed_at).toBeNull();
  });

  /** The real handoff, arriving from the phone it was scanned on, is untouched
   *  by any of this and still carries the stronger claim. */
  it('leaves a genuine handoff from a phone attested by the server', async () => {
    restrictTo(['phone']);
    await sign({ source: 'mobile_handoff', handoffId: 'h-1', userAgent: PHONE_UA });
    expect(signedEvent()?.metadata?.signature_method).toBe('phone');
    expect(signedEvent()?.metadata?.signature_method_attested_by).toBe('server');
  });

  /** A tablet is not a phone: iPadOS reports a Macintosh user agent, so the
   *  allowlist in lib/platform.ts cannot identify one and deliberately does not
   *  try. The tablet keeps the handoff, which is the truthful route for it. */
  it('does not treat a tablet as a phone', async () => {
    restrictTo(['phone']);
    const iPad =
      'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    const result = await sign({ method: 'draw', userAgent: iPad });
    expect(result.ok).toBe(false);
  });

  /** No header is not a phone. The device may only ever widen, so the case it
   *  cannot answer lands on the behaviour that was already there. */
  it('does not treat a missing user agent as a phone', async () => {
    restrictTo(['phone']);
    const result = await sign({ method: 'draw', userAgent: null });
    expect(result.ok).toBe(false);
  });
});
