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

const store = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }));

const sendEmail = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
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

/** The narrow slice of the admin client the release helper uses. */
const admin = {
  from() {
    return {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: store.row }) }),
      }),
    };
  },
} as never;

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

  it('refuses when the row is gone', async () => {
    store.row = null;
    expect((await releaseApprovedSubmission(admin, 'sub-1')).ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
