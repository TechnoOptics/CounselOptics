import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Once it is signed, that link can never be used to sign again."
 *
 * That is the promise this slice makes, and it is a narrower promise
 * than the one that was asked for. The firm asked for the emailed link
 * to stop existing; it cannot, because E-SIGN at 15 USC 7001(a)(1) and
 * (d) rest on the signer being able to retain the record, and this link
 * is their retention path. What the product CAN promise, and what these
 * tests hold it to, is that the request cannot be signed a second time
 * and that the copy behind the link is reachable for a stated window.
 *
 * The signing surface is three things, and a guard on one of them is
 * not a guard:
 *
 *   1. lib/signature-write.ts, the one function that stamps signed_at.
 *   2. POST /api/firm/sign, the desktop route holding the durable token.
 *   3. POST /api/firm/sign/mobile, the phone route holding a consumed
 *      handoff and no token at all.
 *
 * Every 'use server' export and every route handler in this repo is a
 * public HTTP endpoint, so each of the three is driven here directly,
 * against an in-memory stand-in for the service-role client, rather
 * than being assumed to inherit the guard from a sibling. The last
 * describe block covers the fourth path a second signature could arrive
 * on: two requests racing, both reading an unsigned row before either
 * writes.
 */

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  seq: 0,
  reset() {
    this.tables = {
      firm_signatures: [],
      firm_signing_requests: [],
      firm_documents: [],
      profiles: [],
    };
    this.seq = 0;
  },
}));

const storage = vi.hoisted(() => ({
  objects: new Map<string, Uint8Array>(),
  /** Uploads recorded in order, so a losing racer's write is visible. */
  uploads: [] as string[],
  failUpload: false,
  reset() {
    this.objects = new Map();
    this.uploads = [];
    this.failUpload = false;
  },
}));

const audit = vi.hoisted(() => ({ events: [] as Array<Record<string, unknown>> }));

type Filter = { col: string; val: unknown; kind: 'eq' | 'is' | 'in' };

/**
 * A stand-in for one PostgREST request, with the two behaviours the
 * guards below actually depend on: `.is(col, null)` narrows the rows an
 * UPDATE touches, and an UPDATE hands rows back only when the caller
 * asked for them with `.select()`. Both mirror the real client, and both
 * are what makes a conditional write falsifiable here: without them a
 * compare-and-swap that lost would still look like it won.
 */
class Query {
  private op: 'select' | 'update' = 'select';
  private filters: Filter[] = [];
  private patch: Row | null = null;
  private selected = false;
  private result: { data: unknown; error: { message: string } | null } | null = null;
  constructor(private table: string) {}
  select() {
    this.selected = true;
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  update(patch: Row) {
    this.op = 'update';
    this.patch = patch;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push({ col, val, kind: 'eq' });
    return this;
  }
  is(col: string, val: unknown) {
    this.filters.push({ col, val, kind: 'is' });
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push({ col, val: vals, kind: 'in' });
    return this;
  }
  private matching(): Row[] {
    return (db.tables[this.table] ?? []).filter((r) =>
      this.filters.every((f) =>
        f.kind === 'in'
          ? (f.val as unknown[]).includes(r[f.col])
          : f.kind === 'is'
            ? (r[f.col] ?? null) === f.val
            : r[f.col] === f.val,
      ),
    );
  }
  private run() {
    if (this.result) return this.result;
    if (this.op === 'update') {
      const hit = this.matching();
      for (const r of hit) Object.assign(r, this.patch);
      this.result = { data: this.selected ? hit.map((r) => ({ ...r })) : null, error: null };
    } else {
      this.result = { data: this.matching().map((r) => ({ ...r })), error: null };
    }
    return this.result;
  }
  maybeSingle() {
    const r = this.run();
    return Promise.resolve({ data: (r.data as Row[] | null)?.[0] ?? null, error: r.error });
  }
  then<T>(resolve: (v: { data: unknown; error: unknown }) => T) {
    return Promise.resolve(this.run()).then(resolve);
  }
}

const client = vi.hoisted(() => ({}) as Record<string, unknown>);

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => admin,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => admin,
}));
vi.mock('@/lib/esign-audit', () => ({
  appendSignatureEvent: async (_a: unknown, e: Record<string, unknown>) => {
    audit.events.push(e);
  },
  sha256: (s: string) => `sha:${s}`,
}));
vi.mock('../lib/esign-audit', () => ({
  appendSignatureEvent: async (_a: unknown, e: Record<string, unknown>) => {
    audit.events.push(e);
  },
  sha256: (s: string) => `sha:${s}`,
}));
// The executed-copy render and the completion notices are the far side
// of the completion branch. This file is about whether a SECOND
// signature can land, so both are stubbed to nothing rather than driven.
vi.mock('@/lib/signature-render', () => ({
  renderFinalSignedPdf: async () => ({ ok: true }),
  shouldLogRenderFailure: () => false,
}));
vi.mock('@/lib/notifications', () => ({
  createNotification: async () => ({ ok: true }),
}));

const admin = {
  from: (table: string) => new Query(table),
  schema: (name: string) => ({ from: (table: string) => new Query(`${name}.${table}`) }),
  storage: {
    from: () => ({
      upload: async (path: string, body: Uint8Array | Buffer) => {
        if (storage.failUpload) return { error: { message: 'bucket refused' } };
        storage.uploads.push(path);
        storage.objects.set(path, new Uint8Array(body as Uint8Array));
        return { error: null };
      },
      download: async (path: string) => {
        const bytes = storage.objects.get(path);
        if (!bytes) return { data: null, error: { message: 'not found' } };
        return {
          data: { arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer },
          error: null,
        };
      },
    }),
  },
};
void client;

const SIG_ID = 'sig-1';
const REQ_ID = 'req-1';
const DOC_ID = 'doc-1';
const FIRM_ID = 'firm-1';
const TOKEN = 'signer-token-1';
/** A one pixel PNG, which is all recordSignature validates about it. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function sigRow(): Row {
  return db.tables.firm_signatures.find((r) => r.id === SIG_ID) as Row;
}
function reqRow(): Row {
  return db.tables.firm_signing_requests.find((r) => r.id === REQ_ID) as Row;
}

function seed(
  opts: {
    signedAt?: string | null;
    requestStatus?: string;
    completedAt?: string | null;
    external?: boolean;
    signerCanDownload?: boolean;
    signedFilePath?: string | null;
  } = {},
) {
  const external = opts.external ?? true;
  db.tables.firm_signing_requests.push({
    id: REQ_ID,
    firm_id: FIRM_ID,
    document_id: DOC_ID,
    requested_by: 'user-1',
    status: opts.requestStatus ?? 'sent',
    completed_at: opts.completedAt ?? null,
    document_sha256: 'sha-of-bytes',
    signer_can_download: opts.signerCanDownload ?? true,
    signed_file_path: opts.signedFilePath ?? null,
  });
  db.tables.firm_signatures.push({
    id: SIG_ID,
    signing_request_id: REQ_ID,
    signer_email: 'counterparty@example.test',
    signer_name: 'A Counterparty',
    token: TOKEN,
    signed_at: opts.signedAt ?? null,
    response: null,
    access_code_hash: external ? 'sha:CODE' : null,
    access_code_verified_at: external ? '2026-08-01T11:00:00.000Z' : null,
  });
  db.tables.firm_documents.push({
    id: DOC_ID,
    firm_id: FIRM_ID,
    name: 'Mutual NDA',
    file_path: `${FIRM_ID}/${DOC_ID}/nda.pdf`,
    signable_file_path: null,
  });
  storage.objects.set(`${FIRM_ID}/${DOC_ID}/nda.pdf`, new Uint8Array([1, 2, 3]));
}

/** A request body as the routes read it. */
function postRequest(body: unknown, cookie?: string) {
  const req = new Request('https://advottic.com/api/firm/sign', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    body: JSON.stringify(body),
  }) as Request & { cookies: { get: (n: string) => { value: string } | undefined } };
  req.cookies = {
    get: () => (cookie === undefined ? undefined : { value: cookie }),
  };
  return req;
}

let write: typeof import('../lib/signature-write');
let deskRoute: typeof import('../app/api/firm/sign/route');
let phoneRoute: typeof import('../app/api/firm/sign/mobile/route');
let copyRoute: typeof import('../app/api/firm/sign/copy/[token]/route');
let retention: typeof import('../lib/signer-retention');

beforeEach(async () => {
  db.reset();
  storage.reset();
  audit.events = [];
  vi.resetModules();
  vi.doMock('@/lib/signing-handoff-queries', () => ({
    HANDOFF_COOKIE: 'adv_sign_handoff',
    // A handoff that resolved cleanly and points at THIS signature row.
    // Deliberately permissive: the phone's own handoff state machine has
    // its own already-signed refusal, and stubbing that refusal away is
    // the only way to prove the write itself refuses rather than
    // inheriting a guard from the layer above it.
    loadBoundHandoff: async () => ({
      ok: true,
      signatureId: SIG_ID,
      handoffId: 'handoff-1',
      desktopConsent: null,
    }),
  }));
  write = await import('../lib/signature-write');
  deskRoute = await import('../app/api/firm/sign/route');
  phoneRoute = await import('../app/api/firm/sign/mobile/route');
  copyRoute = await import('../app/api/firm/sign/copy/[token]/route');
  retention = await import('../lib/signer-retention');
});

/** Drive the three paths through one description each. */
const PATHS = [
  {
    name: 'the shared write, called directly',
    run: async () => {
      const res = await write.recordSignature({
        locator: { kind: 'token', token: TOKEN },
        signatureDataUrl: PNG,
        typedName: 'A Counterparty',
        ip: '198.51.100.7',
        userAgent: 'vitest',
        source: 'web' as const,
      });
      return res.ok ? { status: 200, error: null } : { status: res.status, error: res.error };
    },
  },
  {
    name: 'the desktop route',
    run: async () => {
      const res = await deskRoute.POST(
        postRequest({ token: TOKEN, signatureDataUrl: PNG }) as never,
      );
      const body = (await res.json()) as { error?: string };
      return { status: res.status, error: body.error ?? null };
    },
  },
  {
    name: 'the phone route',
    run: async () => {
      const res = await phoneRoute.POST(
        postRequest({ handoffToken: 'h-raw', signatureDataUrl: PNG }, 'session') as never,
      );
      const body = (await res.json()) as { error?: string };
      return { status: res.status, error: body.error ?? null };
    },
  },
];

describe.each(PATHS)('$name', ({ run }) => {
  it('signs an unsigned request once', async () => {
    seed();
    const res = await run();
    expect(res.status).toBe(200);
    expect(sigRow().signed_at).toBeTruthy();
    expect(audit.events.filter((e) => e.eventType === 'signed')).toHaveLength(1);
  });

  it('refuses a request that has already been signed, with 410', async () => {
    seed({ signedAt: '2026-08-01T12:00:00.000Z', requestStatus: 'completed' });
    const res = await run();
    expect(res.status).toBe(410);
    expect(res.error).toBe(retention.SIGNER_ALREADY_SIGNED_SENTENCE);
    // Not merely refused: nothing was written on the way to refusing.
    expect(sigRow().signed_at).toBe('2026-08-01T12:00:00.000Z');
    expect(audit.events.filter((e) => e.eventType === 'signed')).toHaveLength(0);
    expect(storage.uploads).toHaveLength(0);
  });

  it('refuses a signer who already signed a request others are still working through', async () => {
    // The scenario neither of the request-level guards covers: two
    // signers, this one has signed, the request is 'partial' because the
    // other has not, and this signer's link is submitted again. Neither
    // 'canceled' nor 'completed' applies, so the refusal has to come
    // from the row itself or from the conditional claim on it.
    seed({ signedAt: '2026-08-01T12:00:00.000Z', requestStatus: 'partial' });
    const res = await run();
    expect(res.status).toBe(410);
    expect(res.error).toBe(retention.SIGNER_ALREADY_SIGNED_SENTENCE);
    expect(sigRow().signed_at).toBe('2026-08-01T12:00:00.000Z');
    expect(audit.events.filter((e) => e.eventType === 'signed')).toHaveLength(0);
    expect(storage.uploads).toHaveLength(0);
  });

  it('refuses a second signature on a request that is already completed', async () => {
    // The row-level guard reads this signature's own signed_at, so a row
    // added to a finished request after the fact would slip past it. A
    // completed request is a finished instrument, and a signature landing
    // on one would produce a second executed copy of the same document.
    seed({ signedAt: null, requestStatus: 'completed', completedAt: '2026-08-01T12:00:00.000Z' });
    const res = await run();
    expect(res.status).toBe(410);
    expect(res.error).toBe(retention.SIGNER_ALREADY_SIGNED_SENTENCE);
    expect(sigRow().signed_at).toBeFalsy();
    expect(audit.events.filter((e) => e.eventType === 'signed')).toHaveLength(0);
  });

  it('still refuses a recalled request, which is a different refusal', async () => {
    // Pinned so the new guard above cannot be widened into swallowing
    // this one: a recalled request and a signed one are different facts
    // and the signer is told different things.
    seed({ requestStatus: 'canceled' });
    const res = await run();
    expect(res.status).toBe(410);
    expect(res.error).not.toBe(retention.SIGNER_ALREADY_SIGNED_SENTENCE);
  });
});

describe('a claim that cannot be completed', () => {
  it('is released, so the signer is not locked out of their own signature', async () => {
    // The row is claimed before the mark is stored, which is what stops
    // a losing racer overwriting the winner's image. The cost of that
    // order is this case: if the bucket then refuses, the row is
    // recorded as signed with nothing behind it and the signer, reading
    // a 500, could never retry because their own row is now taken.
    seed();
    storage.failUpload = true;
    const first = await write.recordSignature({
      locator: { kind: 'token', token: TOKEN },
      signatureDataUrl: PNG,
      ip: null,
      userAgent: null,
      source: 'web',
    });
    expect(first.ok).toBe(false);
    expect((first as { status: number }).status).toBe(500);
    expect(sigRow().signed_at).toBeFalsy();

    // And the retry works, which is the point of releasing it.
    storage.failUpload = false;
    const second = await write.recordSignature({
      locator: { kind: 'token', token: TOKEN },
      signatureDataUrl: PNG,
      ip: null,
      userAgent: null,
      source: 'web',
    });
    expect(second.ok).toBe(true);
    expect(sigRow().signed_at).toBeTruthy();
    expect(audit.events.filter((e) => e.eventType === 'signed')).toHaveLength(1);
  });
});

describe('two submissions racing for one signature', () => {
  it('lets exactly one of them win', async () => {
    // The laptop and the phone can both be holding a live pad. Before
    // the write became conditional, both read signed_at as null, both
    // passed the guard, and both wrote: two 'signed' events on one
    // chain, two rollups, and the executed copy stamped from whichever
    // image landed last.
    seed();
    const [a, b] = await Promise.all([
      write.recordSignature({
        locator: { kind: 'token', token: TOKEN },
        signatureDataUrl: PNG,
        ip: '198.51.100.7',
        userAgent: 'laptop',
        source: 'web',
      }),
      write.recordSignature({
        locator: { kind: 'id', signatureId: SIG_ID },
        signatureDataUrl: PNG,
        ip: '198.51.100.8',
        userAgent: 'phone',
        source: 'mobile_handoff',
        handoffId: 'handoff-1',
      }),
    ]);
    const outcomes = [a, b];
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    const loser = outcomes.find((r) => !r.ok) as { status: number; error: string };
    expect(loser.status).toBe(410);
    expect(loser.error).toBe(retention.SIGNER_ALREADY_SIGNED_SENTENCE);
    // One signature on the chain, whichever device got there first.
    expect(audit.events.filter((e) => e.eventType === 'signed')).toHaveLength(1);
    expect(reqRow().status).toBe('completed');
  });
});

describe('the copy the signer keeps', () => {
  const EXECUTED = `${FIRM_ID}/${REQ_ID}/executed.pdf`;

  function seedExecuted(completedAt: string | null) {
    seed({
      signedAt: '2026-08-01T12:00:00.000Z',
      requestStatus: 'completed',
      completedAt,
      signedFilePath: EXECUTED,
    });
    storage.objects.set(EXECUTED, new Uint8Array([9, 9, 9]));
  }

  async function get() {
    const req = new Request(`https://advottic.com/api/firm/sign/copy/${TOKEN}`, {
      headers: { 'user-agent': 'vitest' },
    });
    return copyRoute.GET(req as never, { params: { token: TOKEN } });
  }

  it('is served inside the retention window', async () => {
    // Signing does not take the record away. This is the whole reason
    // the link cannot simply be killed.
    seedExecuted(new Date().toISOString());
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
  });

  it('is refused once the retention window has passed', async () => {
    const long = new Date(
      Date.now() - (retention.SIGNER_COPY_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000,
    ).toISOString();
    seedExecuted(long);
    const res = await get();
    expect(res.status).toBe(410);
    expect(await res.text()).toBe(retention.SIGNER_COPY_RETENTION_EXPIRED_COPY);
  });

  it('is served while the window has not started', async () => {
    // completed_at null means the other party has not signed yet. The
    // clock has not begun, and a signer must never be refused their own
    // record because a column was empty.
    seedExecuted(null);
    const res = await get();
    expect(res.status).toBe(200);
  });

  it('runs the retention check after the existing refusals, not before', async () => {
    // Ordering is load-bearing. resolveSignerCopyAccess answers a
    // forwarded link with 'code-required' as a 404 so it teaches nobody
    // anything about the request behind it. A retention check that ran
    // first would answer that same link with a 410 and confirm the
    // request exists.
    seedExecuted(
      new Date(
        Date.now() - (retention.SIGNER_COPY_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000,
      ).toISOString(),
    );
    sigRow().access_code_verified_at = null;
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.text()).not.toBe(retention.SIGNER_COPY_RETENTION_EXPIRED_COPY);
  });
});
