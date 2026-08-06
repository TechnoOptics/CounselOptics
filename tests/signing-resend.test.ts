import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * resendSigningEmailsAction is the recovery path for a signing request
 * whose mail did not leave the building, and it is also an endpoint that
 * sends mail from the firm's verified domain and rotates a credential.
 * These tests drive it against an in-memory stand-in for the service-role
 * client so the decisions can be asserted exactly:
 *
 *   - it refuses a caller who is not a member of the firm, and a member
 *     whose role may not send for signature,
 *   - it answers a signature owned by ANOTHER firm exactly as it answers
 *     one that does not exist, so the endpoint cannot be used to probe,
 *   - it clears the access-code lockout when, and only when, the new code
 *     actually went out,
 *   - it records the resend in the audit chain, for internal signers too,
 *   - it refuses a request that is closed or on hold, and one that is
 *     over the rate limit, without sending anything.
 */

// ── In-memory dataset the mock clients read/write ───────────────────────────
type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  reset() {
    this.tables = {
      firm_members: [],
      firm_signatures: [],
      firm_signing_requests: [],
      firm_documents: [],
      firms: [],
    };
  },
}));

class Query {
  private rows: Row[];
  private pending: Row | null = null;
  private op: 'select' | 'update' = 'select';
  constructor(private table: string) {
    this.rows = [...(db.tables[table] ?? [])];
  }
  select() {
    return this;
  }
  update(patch: Row) {
    this.op = 'update';
    this.pending = patch;
    return this;
  }
  eq(col: string, val: unknown) {
    if (this.op === 'update') {
      for (const r of db.tables[this.table] ?? []) {
        if (r[col] === val) Object.assign(r, this.pending);
      }
      return Promise.resolve({ data: null, error: null });
    }
    this.rows = this.rows.filter((r) => r[col] === val);
    return this;
  }
  maybeSingle() {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null });
  }
  then<T>(resolve: (v: { data: Row[]; error: null }) => T) {
    return Promise.resolve({ data: this.rows, error: null }).then(resolve);
  }
}

const client = {
  from(table: string) {
    return new Query(table);
  },
};

const session = vi.hoisted(() => ({ userId: 'user-1', email: 'partner@firm-a.test' }));
const mail = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; subject: string }>,
  // Per-subject outcome. 'code' matches the access-code email, 'link'
  // the branded sign link.
  fail: { link: false, code: false },
}));
const audit = vi.hoisted(() => ({ events: [] as Array<Record<string, unknown>> }));
const limiter = vi.hoisted(() => ({ allow: true }));

vi.mock('../lib/supabase/server', () => ({
  requireUser: async () => ({ id: session.userId, email: session.email }),
  getCurrentUser: async () => ({ id: session.userId, email: session.email }),
  createServerSupabase: () => client,
}));
vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => client,
}));
vi.mock('../lib/rate-limit', () => ({
  checkRateLimit: async () => limiter.allow,
}));
vi.mock('../lib/email', () => ({
  sendEmail: async (input: { to: string; subject: string }) => {
    const kind = input.subject.includes('access code') ? 'code' : 'link';
    if (mail.fail[kind]) return { ok: false, error: `provider refused the ${kind}` };
    mail.sent.push({ to: input.to, subject: input.subject });
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
const FIRM_A = 'firm-a';
const FIRM_B = 'firm-b';

function sigRow() {
  return db.tables.firm_signatures.find((r) => r.id === SIG_ID) as Row;
}

/** A signer of firm A's request, external (has a code), locked out. */
function seed(opts: { external?: boolean; requestFirm?: string; status?: string } = {}) {
  const external = opts.external ?? true;
  db.tables.firm_members.push({
    firm_id: FIRM_A,
    user_id: session.userId,
    role: 'attorney',
    display_name: 'A Partner',
  });
  db.tables.firms.push({ id: FIRM_A, name: 'Firm A', logo_url: null });
  db.tables.firm_documents.push({ id: 'doc-1', name: 'Engagement letter' });
  db.tables.firm_signing_requests.push({
    id: REQ_ID,
    firm_id: opts.requestFirm ?? FIRM_A,
    document_id: 'doc-1',
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
  audit.events = [];
  limiter.allow = true;
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
});

describe('resend leaves an audit trace', () => {
  it('appends reminder_sent for an external signer', async () => {
    seed();
    await mod.resendSigningEmailsAction(FIRM_A, SIG_ID);
    const types = audit.events.map((e) => e.eventType);
    expect(types).toContain('reminder_sent');
    expect(types).toContain('access_code_sent');
  });

  it('appends reminder_sent for an internal signer, who gets no code email', async () => {
    seed({ external: false });
    await mod.resendSigningEmailsAction(FIRM_A, SIG_ID);
    const types = audit.events.map((e) => e.eventType);
    // The whole reason resend was added was that reminder_sent had no
    // emitter. An internal-signer resend used to leave no record at all.
    expect(types).toContain('reminder_sent');
    expect(types).not.toContain('access_code_sent');
  });

  it('appends nothing when the provider accepted nothing', async () => {
    seed({ external: false });
    mail.fail.link = true;
    await mod.resendSigningEmailsAction(FIRM_A, SIG_ID);
    expect(audit.events).toHaveLength(0);
  });
});
