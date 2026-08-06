import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The gate, as wired.
 *
 * tests/template-approval.test.ts pins the rules; this pins the one function
 * that acts on them. releaseApprovedSubmission() is the only code in the
 * product that sends an employee's filled template to an outside party, so it
 * re-reads the stored row and refuses anything that is not an approval with an
 * approver recorded. Nothing is encrypted, stored, or emailed on a refusal.
 */

const store = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
  /** Runs once, right after a read resolves: our window for interleaving. */
  onRead: null as (() => void) | null,
  /** Makes the next write fail the way a dropped connection would. */
  failWrites: false,
  /** Makes the initial read fail rather than come back empty. */
  readError: false,
}));

type EmailResult = { ok: true } | { ok: false; error: string };
const sendEmail = vi.hoisted(() =>
  vi.fn(async (): Promise<EmailResult> => ({ ok: true })),
);
const storeShare = vi.hoisted(() => vi.fn(async () => true));
const buildPdf = vi.hoisted(() => vi.fn(async () => new Uint8Array([1, 2, 3])));

vi.mock('../lib/email', () => ({
  sendEmail,
  buildShareLinkEmailHtml: () => '<p></p>',
  buildShareKeyEmailHtml: () => '<p></p>',
}));
vi.mock('../lib/secure-share', () => ({
  storeShare,
  encryptDocument: () => ({ blob: Buffer.from('x'), key: 'ab'.repeat(32) }),
  newShareToken: () => 'token-123',
  formatKey: (k: string) => k,
}));
vi.mock('../lib/branded-document-pdf', () => ({ buildBrandedDocumentPdf: buildPdf }));
vi.mock('../lib/firm-storage', () => ({ getFirmByIdAdmin: async () => null }));
vi.mock('../lib/intake-notify', () => ({ siteUrl: () => 'https://advottic.test' }));

const { releaseApprovedSubmission } = await import('../lib/template-release');

/**
 * The narrow slice of the admin client the release helper uses: one read, one
 * conditional claim, and one rollback. The claim honours its own conditions
 * against the stored row, because the whole point of it is that a second
 * caller must come back empty-handed.
 */
type Cond = { col: string; value: unknown };

class Query {
  private conds: Cond[] = [];
  private patch: Record<string, unknown> | null = null;
  update(patch: Record<string, unknown>) {
    this.patch = patch;
    return this;
  }
  select() {
    return this;
  }
  eq(col: string, value: unknown) {
    this.conds.push({ col, value });
    return this;
  }
  is(col: string, value: unknown) {
    this.conds.push({ col, value });
    return this;
  }
  private matches(): boolean {
    const r = store.row;
    if (!r) return false;
    return this.conds.every((c) => (r[c.col] ?? null) === c.value);
  }
  async maybeSingle() {
    if (!this.patch) {
      if (store.readError) return { data: null, error: { message: 'connection lost' } };
      // The caller reads the row as it is NOW; anything the hook does after
      // this happens to a row they are already holding a snapshot of.
      const data = this.matches() ? store.row : null;
      const hook = store.onRead;
      store.onRead = null;
      hook?.();
      return { data, error: null };
    }
    if (store.failWrites) return { data: null, error: { message: 'connection lost' } };
    if (!this.matches()) return { data: null, error: null };
    store.row = { ...store.row, ...this.patch };
    store.updates.push(this.patch);
    return { data: store.row, error: null };
  }
  // An update with no .select() is awaited directly.
  then(resolve: (v: { data: null; error: { message: string } | null }) => void) {
    if (store.failWrites) {
      resolve({ data: null, error: { message: 'connection lost' } });
      return;
    }
    if (this.patch && this.matches()) {
      store.row = { ...store.row, ...this.patch };
      store.updates.push(this.patch);
    }
    resolve({ data: null, error: null });
  }
}

const admin = { from: () => new Query() } as never;

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    firm_id: 'firm-1',
    template_name: 'Mutual NDA',
    submitted_by: 'user-employee',
    submitter_name: 'Dana Employee',
    submitter_email: 'dana@example.com',
    recipient_email: 'counterparty@example.com',
    recipient_note: null,
    document_text: 'MUTUAL NON-DISCLOSURE AGREEMENT ...',
    status: 'approved',
    decided_by: 'user-attorney',
    decided_at: '2026-08-06T10:00:00.000Z',
    released_at: null,
    ...over,
  };
}

beforeEach(() => {
  store.row = null;
  store.updates = [];
  store.onRead = null;
  store.failWrites = false;
  store.readError = false;
  buildPdf.mockImplementation(async () => new Uint8Array([1, 2, 3]));
  storeShare.mockImplementation(async () => true);
  sendEmail.mockImplementation(async () => ({ ok: true }));
  sendEmail.mockClear();
  storeShare.mockClear();
  buildPdf.mockClear();
});

describe('releaseApprovedSubmission', () => {
  it('sends an approved submission to its recipient', async () => {
    store.row = row();
    const res = await releaseApprovedSubmission(admin, 'sub-1');
    expect(res.ok).toBe(true);
    // The link in one email, the key in a second.
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(storeShare).toHaveBeenCalledTimes(1);
  });

  it('refuses every status that is not an approval, and sends nothing', async () => {
    for (const status of ['pending', 'changes_requested', 'sent', 'withdrawn']) {
      store.row = row({ status });
      const res = await releaseApprovedSubmission(admin, 'sub-1');
      expect(res.ok).toBe(false);
    }
    expect(sendEmail).not.toHaveBeenCalled();
    expect(storeShare).not.toHaveBeenCalled();
    expect(buildPdf).not.toHaveBeenCalled();
  });

  it('refuses a row marked approved that records no approver', async () => {
    store.row = row({ decided_by: null });
    expect((await releaseApprovedSubmission(admin, 'sub-1')).ok).toBe(false);
    store.row = row({ decided_at: null });
    expect((await releaseApprovedSubmission(admin, 'sub-1')).ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('does not send the same approval twice', async () => {
    store.row = row({ released_at: '2026-08-06T11:00:00.000Z' });
    expect((await releaseApprovedSubmission(admin, 'sub-1')).ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('claims the release before sending, so a second caller cannot send it again', async () => {
    store.row = row();
    const first = await releaseApprovedSubmission(admin, 'sub-1');
    expect(first.ok).toBe(true);
    // The claim is on the row now, exactly as a concurrent approver would find
    // it: same status, already released.
    expect(store.row?.released_at).toBeTruthy();

    sendEmail.mockClear();
    storeShare.mockClear();
    const second = await releaseApprovedSubmission(admin, 'sub-1');
    expect(second.ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(storeShare).not.toHaveBeenCalled();
  });

  it('treats a half-delivered release as a failure and leaves it retryable', async () => {
    store.row = row();
    // The link email goes; the key email is rate-limited. The recipient holds
    // a link they can never open, so this is not a delivery.
    sendEmail
      .mockImplementationOnce(async () => ({ ok: true }))
      .mockImplementationOnce(async () => ({ ok: false, error: 'rate limited' }));

    const res = await releaseApprovedSubmission(admin, 'sub-1');
    expect(res.ok).toBe(false);
    // Still approved, no longer claimed: an approver can send it again.
    expect(store.row?.status).toBe('approved');
    expect(store.row?.released_at).toBeNull();
    // The orphaned share is recorded so it can be traced and revoked.
    expect(store.row?.release_token).toBe('token-123');
  });

  it('leaves a failed storage attempt retryable', async () => {
    store.row = row();
    storeShare.mockImplementationOnce(async () => false);
    const res = await releaseApprovedSubmission(admin, 'sub-1');
    expect(res.ok).toBe(false);
    expect(store.row?.released_at).toBeNull();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sends nothing when another caller claims the row between the read and the claim', async () => {
    store.row = row();
    // The interleaving the claim exists for: a second approver read the row
    // while it was still unclaimed, so their gate check passed on a snapshot
    // that is already stale by the time they try to send.
    store.onRead = () => {
      store.row = { ...store.row, released_at: '2026-08-06T11:00:00.000Z' };
    };

    const res = await releaseApprovedSubmission(admin, 'sub-1');
    expect(res.ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(storeShare).not.toHaveBeenCalled();
    expect(buildPdf).not.toHaveBeenCalled();
    // The winner's claim is untouched.
    expect(store.row?.released_at).toBe('2026-08-06T11:00:00.000Z');
  });

  it('sends nothing when the row stops being approved between the read and the claim', async () => {
    store.row = row();
    store.onRead = () => {
      store.row = { ...store.row, status: 'changes_requested' };
    };
    const res = await releaseApprovedSubmission(admin, 'sub-1');
    expect(res.ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('gives the claim back when rendering the document throws', async () => {
    store.row = row();
    // A counterparty name outside cp1252 (a Polish l-stroke, Cyrillic, CJK)
    // makes pdf-lib's WinAnsi encoder throw. That must not brick the record.
    buildPdf.mockImplementationOnce(async () => {
      throw new Error('WinAnsi cannot encode 0x0142');
    });

    const res = await releaseApprovedSubmission(admin, 'sub-1');
    expect(res.ok).toBe(false);
    expect(store.row?.status).toBe('approved');
    expect(store.row?.released_at).toBeNull();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('gives the claim back when storing the ciphertext throws', async () => {
    store.row = row();
    storeShare.mockImplementationOnce(async () => {
      throw new Error('storage unreachable');
    });
    const res = await releaseApprovedSubmission(admin, 'sub-1');
    expect(res.ok).toBe(false);
    expect(store.row?.released_at).toBeNull();
  });

  it('does not send the key when the link email failed', async () => {
    store.row = row();
    sendEmail.mockImplementationOnce(async () => ({ ok: false, error: 'bounced' }));
    const res = await releaseApprovedSubmission(admin, 'sub-1');
    expect(res.ok).toBe(false);
    // A bare decryption key with no link to use it on is worse than silence.
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('says the record needs attention when it cannot give the claim back', async () => {
    store.row = row();
    // The claim lands, then the database goes away before it can be undone.
    buildPdf.mockImplementationOnce(async () => {
      store.failWrites = true;
      throw new Error('WinAnsi cannot encode 0x0142');
    });
    const res = await releaseApprovedSubmission(admin, 'sub-1');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/needs attention/i);
  });

  it('does not call a failed claim an already-sent document', async () => {
    store.row = row();
    // The claim write itself fails. Nothing was claimed and nothing was sent,
    // but "already sent" would be a lie the approver is shown as fact.
    store.onRead = () => {
      store.failWrites = true;
    };
    const res = await releaseApprovedSubmission(admin, 'sub-1');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).not.toMatch(/already been sent/i);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('tells a read failure apart from a row that is not there', async () => {
    store.row = null;
    store.readError = true;
    const failed = await releaseApprovedSubmission(admin, 'sub-1');
    expect(failed.ok).toBe(false);
    // Not "already sent" and not "not found": neither is true, and both would
    // be written into release_error and shown to the approver as fact.
    expect(failed.ok === false && failed.error).toMatch(/could not be read/i);
  });

  it('refuses when the row is gone', async () => {
    store.row = null;
    expect((await releaseApprovedSubmission(admin, 'sub-1')).ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
