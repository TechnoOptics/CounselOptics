import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two actions that put signing mail into somebody's inbox:
 * createSigningRequestAction and resendSigningEmailsAction. Between them
 * they authorize a caller, rotate a credential, send from the firm's
 * verified domain, and decide whether the firm's own views will show the
 * request as outstanding. These tests drive both against an in-memory
 * stand-in for the service-role client so each decision can be asserted
 * exactly:
 *
 *   - resend refuses a caller who is not a member of the firm, and a
 *     member whose role may not send for signature,
 *   - it answers a signature owned by ANOTHER firm exactly as it answers
 *     one that does not exist, so the endpoint cannot be used to probe,
 *   - it clears the access-code lockout when, and only when, the new code
 *     actually went out and the rotation actually landed,
 *   - it records the resend in the audit chain, for internal signers too,
 *   - it refuses a request that is closed or on hold, one that is over
 *     the per-signature limit, and one whose recipient is over the
 *     per-address budget, without sending anything,
 *   - both paths promote the request out of draft, and say so in the
 *     chain, on the same fact: the sign link reached a signer.
 */

// In-memory dataset the mock clients read and write.
type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  /** Tables whose UPDATE should come back as a store error. */
  failUpdate: new Set<string>(),
  seq: 0,
  reset() {
    this.tables = {
      firm_members: [],
      firm_signatures: [],
      firm_signing_requests: [],
      firm_documents: [],
      firms: [],
    };
    this.failUpdate = new Set<string>();
    this.seq = 0;
  },
}));

type Filter = { col: string; val: unknown; kind: 'eq' | 'is' | 'in' };

class Query {
  private op: 'select' | 'update' | 'insert' = 'select';
  private filters: Filter[] = [];
  private patch: Row | null = null;
  private pendingInsert: Row | null = null;
  /** Did the caller ask for the affected rows back? See run(). */
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
  insert(row: Row) {
    this.op = 'insert';
    this.pendingInsert = row;
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
  private matches(row: Row) {
    return this.filters.every((f) =>
      f.kind === 'in' ? (f.val as unknown[]).includes(row[f.col]) : row[f.col] === f.val,
    );
  }
  private matching(): Row[] {
    return (db.tables[this.table] ?? []).filter((r) => this.matches(r));
  }
  private run() {
    if (this.result) return this.result;
    if (this.op === 'insert') {
      const row: Row = { id: `${this.table}-${++db.seq}`, ...this.pendingInsert };
      (db.tables[this.table] ??= []).push(row);
      this.result = { data: [{ ...row }], error: null };
    } else if (this.op === 'update') {
      if (db.failUpdate.has(this.table)) {
        this.result = { data: null, error: { message: 'the store refused the update' } };
      } else {
        const hit = this.matching();
        for (const r of hit) Object.assign(r, this.patch);
        // Rows come back ONLY when the caller asked for them, which is
        // what supabase-js does: an UPDATE without .select() resolves
        // with data null however many rows it touched. Handing them back
        // regardless made "how many rows did I affect" readable without
        // asking, and the guards below read exactly that to decide
        // whether they won a race - so dropping the .select() from a
        // conditional write would have stayed green here while making
        // every such write report a conflict in production.
        this.result = { data: this.selected ? hit.map((r) => ({ ...r })) : null, error: null };
      }
    } else {
      // A read hands back a snapshot, never the stored row. Handing back
      // the live object would let a value the action read at the top
      // silently track a write that happened afterwards, which is the
      // one thing the concurrency test below has to be able to stage.
      this.result = { data: this.matching().map((r) => ({ ...r })), error: null };
    }
    return this.result;
  }
  maybeSingle() {
    const r = this.run();
    return Promise.resolve({ data: (r.data as Row[] | null)?.[0] ?? null, error: r.error });
  }
  single() {
    const r = this.run();
    const row = (r.data as Row[] | null)?.[0] ?? null;
    return Promise.resolve({
      data: row,
      error: r.error ?? (row ? null : { message: 'no rows returned' }),
    });
  }
  then<T>(resolve: (v: { data: unknown; error: unknown }) => T) {
    return Promise.resolve(this.run()).then(resolve);
  }
}

const client = {
  from(table: string) {
    return new Query(table);
  },
  // The signer-resolution path reads auth.users; nothing seeds it, so it
  // resolves to null and the signer is treated as external.
  schema(name: string) {
    return {
      from: (table: string) => new Query(`${name}.${table}`),
    };
  },
};

const session = vi.hoisted(() => ({ userId: 'user-1', email: 'partner@firm-a.test' }));
const mail = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; subject: string }>,
  // Per-subject outcome. 'code' matches the access-code email, 'link'
  // the branded sign link.
  fail: { link: false, code: false },
  /** Runs after a message is accepted, to interleave a concurrent write. */
  onSent: null as null | ((kind: 'link' | 'code') => void),
}));
const audit = vi.hoisted(() => ({ events: [] as Array<Record<string, unknown>> }));
const limiter = vi.hoisted(() => ({
  allow: true,
  /** Deny only the buckets whose key starts with this. */
  denyPrefix: null as string | null,
  keys: [] as string[],
}));

vi.mock('../lib/supabase/server', () => ({
  requireUser: async () => ({ id: session.userId, email: session.email }),
  getCurrentUser: async () => ({ id: session.userId, email: session.email }),
  createServerSupabase: () => client,
}));
vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => client,
}));
vi.mock('../lib/rate-limit', () => ({
  checkRateLimit: async (key: string) => {
    limiter.keys.push(key);
    if (limiter.denyPrefix && key.startsWith(limiter.denyPrefix)) return false;
    return limiter.allow;
  },
}));
vi.mock('../lib/notifications', () => ({
  createNotification: async () => ({ ok: true }),
}));
vi.mock('../lib/email', () => ({
  sendEmail: async (input: { to: string; subject: string }) => {
    const kind = input.subject.includes('access code') ? 'code' : 'link';
    if (mail.fail[kind]) return { ok: false, error: `provider refused the ${kind}` };
    mail.sent.push({ to: input.to, subject: input.subject });
    mail.onSent?.(kind);
    return { ok: true };
  },
  buildSigningRequestEmailHtml: () => '<p></p>',
  buildSigningCodeEmailHtml: () => '<p></p>',
  buildMeetingInviteEmailHtml: () => '<p></p>',
}));
vi.mock('../lib/esign-audit', () => ({
  appendSignatureEvent: async (_admin: unknown, e: Record<string, unknown>) => {
    audit.events.push(e);
  },
  sha256: (s: string) => `sha:${s}`,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => undefined, set: () => {} }),
  headers: () => new Map(),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

let mod: typeof import('../lib/firm-actions');

const SIG_ID = 'sig-1';
const REQ_ID = 'req-1';
const DOC_ID = 'doc-1';
const FIRM_A = 'firm-a';
const FIRM_B = 'firm-b';

function sigRow() {
  return db.tables.firm_signatures.find((r) => r.id === SIG_ID) as Row;
}
function reqRow() {
  return db.tables.firm_signing_requests.find((r) => r.id === REQ_ID) as Row;
}
function eventTypes() {
  return audit.events.map((e) => e.eventType);
}

/** The firm, a member who may send, and a document. */
function seedFirm() {
  db.tables.firm_members.push({
    firm_id: FIRM_A,
    user_id: session.userId,
    role: 'attorney',
    display_name: 'A Partner',
  });
  db.tables.firms.push({ id: FIRM_A, name: 'Firm A', logo_url: null });
  db.tables.firm_documents.push({
    id: DOC_ID,
    firm_id: FIRM_A,
    name: 'Engagement letter',
    // No stored file: the hash + anchor detection are skipped, which
    // keeps these tests on the mail and status decisions.
    file_path: null,
    signable_file_path: null,
    status: 'ready',
  });
}

/** A signer of firm A's request, external (has a code), locked out. */
function seed(opts: { external?: boolean; requestFirm?: string; status?: string } = {}) {
  const external = opts.external ?? true;
  seedFirm();
  db.tables.firm_signing_requests.push({
    id: REQ_ID,
    firm_id: opts.requestFirm ?? FIRM_A,
    document_id: DOC_ID,
    message: null,
    status: opts.status ?? 'sent',
  });
  db.tables.firm_signatures.push({
    id: SIG_ID,
    signing_request_id: REQ_ID,
    signer_email: 'signer@example.test',
    signer_name: 'A Signer',
    token: 'tok-1',
    signed_at: null,
    access_code_hash: external ? 'sha:OLDCODE' : null,
    // Locked out: MAX_ACCESS_ATTEMPTS is 8 and nothing else in the tree
    // ever clears this counter.
    access_attempts: 8,
    access_code_verified_at: null,
  });
}

beforeEach(async () => {
  db.reset();
  mail.sent = [];
  mail.fail = { link: false, code: false };
  mail.onSent = null;
  audit.events = [];
  limiter.allow = true;
  limiter.denyPrefix = null;
  limiter.keys = [];
  session.userId = 'user-1';
  vi.resetModules();
  mod = await import('../lib/firm-actions');
});

describe('resend authorization boundary', () => {
  it('refuses a caller who is not a member of the firm, and sends nothing', async () => {
    seed();
    session.userId = 'outsider';
    const res = await mod.resendSigningEmailsAction(FIRM_A, SIG_ID);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/permission/i);
    expect(mail.sent).toHaveLength(0);
  });

  it('refuses a member whose role may not send for signature', async () => {
    seed();
    (db.tables.firm_members[0] as Row).role = 'billing';
    const res = await mod.resendSigningEmailsAction(FIRM_A, SIG_ID);
    expect(res.ok).toBe(false);
    expect(mail.sent).toHaveLength(0);
  });

  it("answers another firm's signature exactly as an unknown id, and sends nothing", async () => {
    // The request belongs to firm B; the caller is a member of firm A and
    // asks about it by id. If this answered "Signer not found." only for
    // ids that do not exist, the wording alone would confirm the row
    // exists somewhere else.
    seed({ requestFirm: FIRM_B });
    const foreign = await mod.resendSigningEmailsAction(FIRM_A, SIG_ID);
    const unknown = await mod.resendSigningEmailsAction(FIRM_A, 'no-such-signature');
    expect(foreign.ok).toBe(false);
    expect(unknown.ok).toBe(false);
    expect(foreign.error).toBe(unknown.error);
    expect(mail.sent).toHaveLength(0);
  });

  it('does not disclose that a signer has already signed before proving the firm', async () => {
    seed({ requestFirm: FIRM_B });
    sigRow().signed_at = new Date().toISOString();
    const res = await mod.resendSigningEmailsAction(FIRM_A, SIG_ID);
    expect(res.error).not.toMatch(/already signed/i);
  });

  it('refuses a request the signer put on hold, and sends nothing', async () => {
    seed({ status: 'rejected' });
    const res = await mod.resendSigningEmailsAction(FIRM_A, SIG_ID);
    expect(res.ok).toBe(false);
    expect(mail.sent).toHaveLength(0);
  });

  it('sends nothing when the caller is over the rate limit', async () => {
    seed();
    limiter.allow = false;
    const res = await mod.resendSigningEmailsAction(FIRM_A, SIG_ID);
    expect(res.ok).toBe(false);
    expect(mail.sent).toHaveLength(0);
  });
});

describe('the address itself has a budget', () => {
  it('refuses a resend to a recipient who is over it, inside the per-signature limit', async () => {
    // The per-signature bucket allows this call. Only the address-keyed
    // one denies, which is the bucket that survives somebody minting a
    // fresh request to reach the same inbox.
    seed();
    limiter.denyPrefix = 'signing-recipient:';
    const res = await mod.resendSigningEmailsAction(FIRM_A, SIG_ID);
    expect(res.ok).toBe(false);
    expect(mail.sent).toHaveLength(0);
    expect(limiter.keys).toContain('signing-recipient:signer@example.test');
  });

  it('refuses a new request naming an address that is over it, and stays recoverable', async () => {
    // A new request is a new signature id and therefore a new
    // per-signature bucket, so this is the only cap on the create path.
    seedFirm();
    limiter.denyPrefix = 'signing-recipient:';
    const res = await mod.createSigningRequestAction(
      FIRM_A,
      DOC_ID,
      [{ email: 'Victim@Example.TEST' }],
      null,
    );
    expect(mail.sent).toHaveLength(0);
    expect(res.emailFailures?.[0].email).toBe('victim@example.test');
    // Keyed on the normalized address, or a capitalized spelling of the
    // same inbox would be handed a fresh bucket.
    expect(limiter.keys).toContain('signing-recipient:victim@example.test');
    // The signature row exists with a live token, and the request stays a
    // draft, so a resend once the window has passed delivers it.
    const created = db.tables.firm_signatures.find(
      (r) => r.signer_email === 'victim@example.test',
    );
    expect(created?.token).toBeTruthy();
    expect(db.tables.firm_signing_requests[0].status).toBe('draft');
  });
});

describe('resend clears the access-code lockout', () => {
  it('resets the attempt counter and the unlock latch when the new code went out', async () => {
    seed();
    sigRow().access_code_verified_at = '2026-01-01T00:00:00.000Z';
    const res = await mod.resendSigningEmailsAction(FIRM_A, SIG_ID);
    expect(res.ok).toBe(true);
    // Without this the signer is told to ask the firm to resend, the
    // firm resends, and the lockout still answers before the fresh code
    // is ever compared.
    expect(sigRow().access_attempts).toBe(0);
    expect(sigRow().access_code_verified_at).toBeNull();
    expect(sigRow().access_code_hash).not.toBe('sha:OLDCODE');
  });

  it('leaves the counter and the old code alone when the code email failed', async () => {
    seed();
    mail.fail.code = true;
    const res = await mod.resendSigningEmailsAction(FIRM_A, SIG_ID);
    expect(res.ok).toBe(false);
    // A code nobody received must not unlock anything, and must not
    // replace the code the signer may already be holding.
    expect(sigRow().access_attempts).toBe(8);
    expect(sigRow().access_code_hash).toBe('sha:OLDCODE');
  });

  it('reports the failure, and claims no rotation, when the write is refused', async () => {
    seed();
    db.failUpdate.add('firm_signatures');
    const res = await mod.resendSigningEmailsAction(FIRM_A, SIG_ID);
    expect(res.ok).toBe(false);
    expect(res.emailFailures?.some((f) => f.kind === 'code')).toBe(true);
    // The chain is evidence. It must not carry access_code_sent for a
    // code the gate will never accept.
    expect(eventTypes()).not.toContain('access_code_sent');
  });

  it('says so, and keeps its hands off the row, when another resend rotated first', async () => {
    // A second resend lands between this one reading the row and writing
    // it back. Unconditionally, this UPDATE would win the row and the
    // signer would hold two codes with no way to tell which is live.
    seed();
    mail.onSent = (kind) => {
      if (kind === 'code') sigRow().access_code_hash = 'sha:SOMEONE-ELSES-CODE';
    };
    const res = await mod.resendSigningEmailsAction(FIRM_A, SIG_ID);
    expect(res.ok).toBe(false);
    expect(res.emailFailures?.some((f) => f.kind === 'code')).toBe(true);
    expect(sigRow().access_code_hash).toBe('sha:SOMEONE-ELSES-CODE');
    expect(sigRow().access_attempts).toBe(8);
    expect(eventTypes()).not.toContain('access_code_sent');
  });
});

describe('resend leaves an audit trace', () => {
  it('appends reminder_sent for an external signer', async () => {
    seed();
    await mod.resendSigningEmailsAction(FIRM_A, SIG_ID);
    expect(eventTypes()).toContain('reminder_sent');
    expect(eventTypes()).toContain('access_code_sent');
  });

  it('appends reminder_sent for an internal signer, who gets no code email', async () => {
    seed({ external: false });
    await mod.resendSigningEmailsAction(FIRM_A, SIG_ID);
    // The whole reason resend was added was that reminder_sent had no
    // emitter. An internal-signer resend used to leave no record at all.
    expect(eventTypes()).toContain('reminder_sent');
    expect(eventTypes()).not.toContain('access_code_sent');
  });

  it('appends nothing when the provider accepted nothing', async () => {
    seed({ external: false });
    mail.fail.link = true;
    await mod.resendSigningEmailsAction(FIRM_A, SIG_ID);
    expect(audit.events).toHaveLength(0);
  });
});

describe('a request stops being a draft when the link reaches a signer', () => {
  it('promotes a recovered request, so the firm can see it is outstanding', async () => {
    // Every original email was refused, so the request opened as a draft.
    // The resend is the send. Left in draft it is invisible to every view
    // that filters on status in ('sent', 'partial'), which is how a
    // request genuinely out for signature reads as "nothing pending".
    seed({ status: 'draft' });
    const res = await mod.resendSigningEmailsAction(FIRM_A, SIG_ID);
    expect(res.ok).toBe(true);
    expect(reqRow().status).toBe('sent');
    expect(reqRow().sent_at).toBeTruthy();
    expect(eventTypes()).toContain('request_sent');
  });

  it('leaves a request that was already sent alone', async () => {
    seed({ status: 'sent' });
    reqRow().sent_at = '2026-01-01T00:00:00.000Z';
    await mod.resendSigningEmailsAction(FIRM_A, SIG_ID);
    // A second request_sent would tell an auditor the request went out
    // twice as a first send, which is what reminder_sent is for.
    expect(eventTypes()).not.toContain('request_sent');
    expect(reqRow().sent_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('promotes once when a second send for the same draft lands first', async () => {
    // Two resends on one draft request, or two signers of it, both read
    // 'draft' at the top of the action and both reach a signer. If the
    // promotion were unconditional they would both write it: two
    // request_sent events in an evidence chain, and the later sent_at
    // overwriting the moment the request actually went out.
    seed({ status: 'draft' });
    mail.onSent = (kind) => {
      if (kind !== 'link') return;
      reqRow().status = 'sent';
      reqRow().sent_at = '2026-01-01T00:00:00.000Z';
    };
    const res = await mod.resendSigningEmailsAction(FIRM_A, SIG_ID);
    expect(res.ok).toBe(true);
    expect(eventTypes()).not.toContain('request_sent');
    expect(reqRow().sent_at).toBe('2026-01-01T00:00:00.000Z');
    // The mail this caller sent is still on the record, as a resend.
    expect(eventTypes()).toContain('reminder_sent');
  });

  it('leaves a draft alone when the sign link was refused again', async () => {
    seed({ status: 'draft' });
    mail.fail.link = true;
    await mod.resendSigningEmailsAction(FIRM_A, SIG_ID);
    expect(reqRow().status).toBe('draft');
    expect(eventTypes()).not.toContain('request_sent');
  });

  it('records the send in the chain when the request is first created', async () => {
    seedFirm();
    const res = await mod.createSigningRequestAction(
      FIRM_A,
      DOC_ID,
      [{ email: 'signer@example.test' }],
      null,
    );
    expect(res.ok).toBe(true);
    // request_created fires for a row that may never be sent, so on its
    // own it cannot tell an auditor "created, never sent" from "created
    // and sent". request_sent is what makes the chain agree with the
    // status column.
    expect(eventTypes()).toContain('request_created');
    expect(eventTypes()).toContain('request_sent');
    expect(db.tables.firm_signing_requests[0].status).toBe('sent');
  });

  it('records no send when every email was refused', async () => {
    seedFirm();
    mail.fail.link = true;
    mail.fail.code = true;
    await mod.createSigningRequestAction(
      FIRM_A,
      DOC_ID,
      [{ email: 'signer@example.test' }],
      null,
    );
    expect(eventTypes()).toContain('request_created');
    expect(eventTypes()).not.toContain('request_sent');
    expect(db.tables.firm_signing_requests[0].status).toBe('draft');
  });
});
