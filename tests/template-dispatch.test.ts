import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two-mode dispatcher, as wired.
 *
 * tests/submission-dispatch.test.ts pins the rules and
 * tests/submission-document.test.ts pins render-once. This file pins the one
 * function that acts on both, driven through retryTemplateReleaseAction
 * because that is the smallest public door onto it and because a gate that is
 * asked and then ignored is the failure mode a structural assertion cannot
 * catch.
 *
 * Four things are held here:
 *
 *   - the share mode is untouched, which matters because it is what every
 *     template in production does today;
 *   - nothing is dispatched for a submission that is not approved, in either
 *     mode, which is the client's requirement and the reason the approval gate
 *     exists at all;
 *   - the signature mode claims the row BEFORE it renders or creates
 *     anything, so a second approver in a second tab cannot produce a second
 *     executed PDF and a second audit chain for one instrument;
 *   - a failure after the claim gives the claim back, so the record stays
 *     approved and retryable rather than looking sent.
 */

type Result = { ok: boolean; error?: string; requestId?: string; emailFailures?: unknown[] };

const releaseApprovedSubmission = vi.hoisted(() =>
  vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
);
const materializeSubmissionDocument = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true as const, documentId: 'doc-1', sha256: 'abc' })),
);
const createSigningRequestAction = vi.hoisted(() =>
  vi.fn(async (): Promise<Result> => ({ ok: true, requestId: 'req-1' })),
);
const loadPublishedTemplate = vi.hoisted(() =>
  vi.fn(async (): Promise<{ deliveryMode: string } | null> => ({ deliveryMode: 'share' })),
);

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('../lib/supabase/server', () => ({
  getCurrentUser: async () => ({ id: 'reviewer-1', email: 'legal@anderson.test' }),
}));
vi.mock('../lib/supabase/admin', () => ({ createAdminSupabase: () => admin }));
vi.mock('../lib/portal-entitlements', () => ({
  authorizeFirmActor: async () => ({ ok: true }),
}));
vi.mock('../lib/firm-authz', () => ({
  callerFirmRole: async () => 'owner',
  FIRM_MANAGE_ROLES: ['owner', 'admin', 'attorney'],
}));
vi.mock('../lib/firm-storage', () => ({ getFirmByIdAdmin: async () => ({ name: 'Anderson' }) }));
vi.mock('../lib/intake-notify', () => ({ hydratePeople: async () => new Map() }));
vi.mock('../lib/notifications', () => ({ createNotification: async () => {} }));
vi.mock('../lib/rate-limit', () => ({ checkRateLimit: async () => true }));
vi.mock('../lib/template-fill', () => ({
  loadPublishedTemplate,
  sanitizeTemplateValues: () => ({}),
}));
vi.mock('../lib/template-release', () => ({ releaseApprovedSubmission }));
vi.mock('../lib/submission-document', () => ({ materializeSubmissionDocument }));
vi.mock('../lib/firm-actions', () => ({ createSigningRequestAction }));

const { retryTemplateReleaseAction } = await import('../lib/template-submissions');

// ── A narrow fake of the admin client, over one table ─────────────────────

const db = {
  row: {} as Record<string, unknown>,
  /** Every update the module made, in order, with the conditions it carried. */
  writes: [] as Array<{ patch: Record<string, unknown>; conds: Array<[string, unknown]> }>,
  /** Runs once just before an update executes: the interleaving window. */
  onWrite: null as (() => void) | null,
};

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private conds: Array<[string, unknown]> = [];
  private nulls: string[] = [];
  private patch: Record<string, unknown> | null = null;
  select() {
    return this;
  }
  update(patch: Record<string, unknown>) {
    this.patch = patch;
    return this;
  }
  eq(col: string, value: unknown) {
    this.conds.push([col, value]);
    return this;
  }
  is(col: string, value: unknown) {
    if (value === null) this.nulls.push(col);
    return this;
  }
  private run(): { data: unknown; error: unknown } {
    if (!this.patch) return { data: { ...db.row }, error: null };
    db.onWrite?.();
    const matches =
      this.conds.every(([c, v]) => db.row[c] === v) && this.nulls.every((c) => db.row[c] == null);
    db.writes.push({ patch: this.patch, conds: [...this.conds] });
    if (!matches) return { data: null, error: null };
    Object.assign(db.row, this.patch);
    return { data: { ...db.row }, error: null };
  }
  maybeSingle() {
    return Promise.resolve(this.run());
  }
  then<A, B>(
    resolve?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null,
    reject?: ((r: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(resolve, reject);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = { from: () => new Query() } as any;

const SUBMISSION_ID = 'sub-1';

function approvedRow(extra: Record<string, unknown> = {}) {
  return {
    id: SUBMISSION_ID,
    firm_id: 'firm-1',
    template_id: 'tpl-1',
    template_name: 'Mutual NDA',
    submitted_by: 'employee-1',
    submitter_name: 'Priya Raman',
    submitter_email: 'priya@firm.test',
    recipient_name: 'Wren Supply Co.',
    recipient_email: 'buyer@wren.test',
    recipient_note: 'For your review.',
    document_text: 'A document with enough words in it to be worth sending.',
    status: 'approved',
    decided_by: 'reviewer-1',
    decided_at: '2026-08-07T10:00:00.000Z',
    released_at: null,
    release_error: null,
    document_id: null,
    signing_request_id: null,
    ...extra,
  };
}

beforeEach(() => {
  releaseApprovedSubmission.mockClear();
  releaseApprovedSubmission.mockResolvedValue({ ok: true });
  materializeSubmissionDocument.mockClear();
  materializeSubmissionDocument.mockResolvedValue({
    ok: true,
    documentId: 'doc-1',
    sha256: 'abc',
  });
  createSigningRequestAction.mockClear();
  createSigningRequestAction.mockResolvedValue({ ok: true, requestId: 'req-1' });
  loadPublishedTemplate.mockClear();
  loadPublishedTemplate.mockResolvedValue({ deliveryMode: 'share' });
  db.row = approvedRow();
  db.writes = [];
  db.onWrite = null;
});

describe('the share mode', () => {
  it('still goes through the release helper and marks the row sent', async () => {
    const out = await retryTemplateReleaseAction(SUBMISSION_ID);
    expect(out.ok).toBe(true);
    expect(releaseApprovedSubmission).toHaveBeenCalledTimes(1);
    // The whole of the signature path is untouched.
    expect(materializeSubmissionDocument).not.toHaveBeenCalled();
    expect(createSigningRequestAction).not.toHaveBeenCalled();
    expect(db.row.status).toBe('sent');
  });

  /**
   * A template that has since been archived cannot be read, and the mode then
   * falls back to a share, which is what the product did before this column
   * existed. Refusing instead would strand approved submissions whose template
   * was tidied away while they sat in the queue.
   */
  it('falls back to a share when the template can no longer be read', async () => {
    loadPublishedTemplate.mockResolvedValue(null);
    const out = await retryTemplateReleaseAction(SUBMISSION_ID);
    expect(out.ok).toBe(true);
    expect(releaseApprovedSubmission).toHaveBeenCalledTimes(1);
    expect(createSigningRequestAction).not.toHaveBeenCalled();
  });

  it('records the reason and leaves the row approved when the release fails', async () => {
    releaseApprovedSubmission.mockResolvedValue({ ok: false, error: 'The mail did not go.' });
    const out = await retryTemplateReleaseAction(SUBMISSION_ID);
    expect(out).toEqual({ ok: false, error: 'The mail did not go.' });
    expect(db.row.status).toBe('approved');
    expect(db.row.release_error).toBe('The mail did not go.');
  });
});

/**
 * The mode the document text was MERGED under is the mode it is delivered
 * under, whatever the template says by the time an approver gets to it.
 *
 * document_text is frozen at submit time, and the counterparty signature block
 * inside it is put there by counterpartyLabel, which returns null for any mode
 * but 'signature'. A template flipped while the submission sat in the queue
 * therefore desynchronises the mode from the words: dispatching for signature
 * over share-merged text sends a counterparty an instrument with no block for
 * them to sign, and dispatching a signature-merged text as a share puts our
 * own field markers on an outside recipient's document.
 *
 * The submission carries its own mode for exactly that reason, and it wins.
 * Re-merging at dispatch is not the alternative: that would change the
 * document after the reviewer approved it.
 */
describe('a template whose mode changed while the submission waited', () => {
  it('dispatches for signature when the row was merged for signature', async () => {
    db.row = approvedRow({ delivery_mode: 'signature' });
    loadPublishedTemplate.mockResolvedValue({ deliveryMode: 'share' });
    const out = await retryTemplateReleaseAction(SUBMISSION_ID);
    expect(out.ok).toBe(true);
    expect(createSigningRequestAction).toHaveBeenCalledTimes(1);
    expect(releaseApprovedSubmission).not.toHaveBeenCalled();
  });

  it('releases as a share when the row was merged as a share', async () => {
    db.row = approvedRow({ delivery_mode: 'share' });
    loadPublishedTemplate.mockResolvedValue({ deliveryMode: 'signature' });
    const out = await retryTemplateReleaseAction(SUBMISSION_ID);
    expect(out.ok).toBe(true);
    expect(releaseApprovedSubmission).toHaveBeenCalledTimes(1);
    expect(createSigningRequestAction).not.toHaveBeenCalled();
  });

  /**
   * A row filed before the column existed, and every row on a database that
   * has not had 20260807_flow_join.sql applied, carries no mode of its own.
   * The template's mode is then still the only answer there is, which is
   * exactly today's behaviour.
   */
  it('falls back to the template when the row carries no mode', async () => {
    db.row = approvedRow();
    loadPublishedTemplate.mockResolvedValue({ deliveryMode: 'signature' });
    const out = await retryTemplateReleaseAction(SUBMISSION_ID);
    expect(out.ok).toBe(true);
    expect(createSigningRequestAction).toHaveBeenCalledTimes(1);
  });
});

describe('the signature mode', () => {
  beforeEach(() => {
    loadPublishedTemplate.mockResolvedValue({ deliveryMode: 'signature' });
  });

  it('files the document, creates the request, stores the pointer and marks it sent', async () => {
    const out = await retryTemplateReleaseAction(SUBMISSION_ID);
    expect(out.ok).toBe(true);
    expect(releaseApprovedSubmission).not.toHaveBeenCalled();
    expect(materializeSubmissionDocument).toHaveBeenCalledTimes(1);
    expect(createSigningRequestAction).toHaveBeenCalledTimes(1);
    // The signing request is created over the document that was just filed,
    // and over the recipient the employee named. Nothing here is taken from a
    // request body.
    expect(createSigningRequestAction).toHaveBeenCalledWith(
      'firm-1',
      'doc-1',
      // Two signers on ONE request, numbered. The counterparty signs what the
      // firm approved and the employee counter-signs what the counterparty
      // agreed to, which is why the employee is second and not merely also
      // present. A second REQUEST for the employee would give one agreement
      // two executed PDFs and two audit chains.
      [
        { email: 'buyer@wren.test', name: 'Wren Supply Co.', order: 1 },
        { email: 'priya@firm.test', name: 'Priya Raman', order: 2 },
      ],
      'For your review.',
      { signerCanDownload: true },
    );
    expect(db.row.signing_request_id).toBe('req-1');
    expect(db.row.status).toBe('sent');
  });

  it('sends a single signer when the record names no employee address', () => {
    // Submissions filed before submitter_email was populated have nobody to
    // counter-sign, and that is today's behaviour rather than a reason to
    // refuse an approved document. Asserted through the dispatch path and not
    // only over the pure rule, because the wiring is what would go missing.
    db.row = approvedRow({ submitter_email: null });
    return retryTemplateReleaseAction(SUBMISSION_ID).then((out) => {
      expect(out.ok).toBe(true);
      expect(createSigningRequestAction).toHaveBeenCalledWith(
        'firm-1',
        'doc-1',
        [{ email: 'buyer@wren.test', name: 'Wren Supply Co.', order: 1 }],
        'For your review.',
        { signerCanDownload: true },
      );
    });
  });

  /**
   * The claim is the whole of the concurrency design, and it has to come
   * first: a render or a signing request created before it would be work a
   * loser had already done and could not take back.
   */
  it('claims the row before it renders or creates anything', async () => {
    // What the row looked like at the moment the renderer was reached, rather
    // than at the end. A claim written afterwards would leave this null and
    // the whole guard would be decorative.
    let claimedWhenFiled: unknown = 'never called';
    let claimedWhenRequested: unknown = 'never called';
    materializeSubmissionDocument.mockImplementation(async () => {
      claimedWhenFiled = db.row.released_at;
      return { ok: true as const, documentId: 'doc-1', sha256: 'abc' };
    });
    createSigningRequestAction.mockImplementation(async () => {
      claimedWhenRequested = db.row.released_at;
      return { ok: true, requestId: 'req-1' };
    });

    await retryTemplateReleaseAction(SUBMISSION_ID);

    expect(claimedWhenFiled).toEqual(expect.any(String));
    expect(claimedWhenRequested).toEqual(expect.any(String));
    // And it is the same compare-and-swap the share path uses: approved, and
    // not already claimed.
    const claim = db.writes[0];
    expect(claim.patch).toHaveProperty('released_at');
    expect(claim.conds).toContainEqual(['status', 'approved']);
  });

  it('sends nothing when another caller claimed the row first', async () => {
    db.onWrite = () => {
      db.onWrite = null;
      db.row.released_at = '2026-08-07T11:00:00.000Z';
    };
    const out = await retryTemplateReleaseAction(SUBMISSION_ID);
    expect(out.ok).toBe(false);
    expect(materializeSubmissionDocument).not.toHaveBeenCalled();
    expect(createSigningRequestAction).not.toHaveBeenCalled();
  });

  it('gives the claim back when the document cannot be filed', async () => {
    materializeSubmissionDocument.mockResolvedValue({
      ok: false,
      error: 'The document could not be stored. Try again shortly.',
    } as never);
    const out = await retryTemplateReleaseAction(SUBMISSION_ID);
    expect(out.ok).toBe(false);
    expect(createSigningRequestAction).not.toHaveBeenCalled();
    // Approved, unclaimed and retryable, which is the state the retry path
    // expects and the state the share path also leaves behind.
    expect(db.row.status).toBe('approved');
    expect(db.row.released_at).toBeNull();
    expect(db.row.release_error).toMatch(/could not be stored/);
  });

  it('gives the claim back when the signing request cannot be created', async () => {
    createSigningRequestAction.mockResolvedValue({ ok: false, error: 'Document not found.' });
    const out = await retryTemplateReleaseAction(SUBMISSION_ID);
    expect(out.ok).toBe(false);
    expect(db.row.status).toBe('approved');
    expect(db.row.released_at).toBeNull();
    expect(db.row.signing_request_id).toBeNull();
  });

  /**
   * The one case that must NOT give the claim back. The request exists and the
   * recipient may already hold the link, so retrying would send a second copy
   * of the same agreement. The record says sent, and says why it is not a
   * clean send.
   */
  it('keeps the dispatch and reports it when the email did not reach anyone', async () => {
    createSigningRequestAction.mockResolvedValue({
      ok: true,
      requestId: 'req-1',
      emailFailures: [{ email: 'buyer@wren.test', error: 'refused' }],
    });
    const out = await retryTemplateReleaseAction(SUBMISSION_ID);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/did not reach the recipient/);
    expect(db.row.signing_request_id).toBe('req-1');
    expect(db.row.status).toBe('sent');
    expect(db.row.released_at).not.toBeNull();
  });
});

describe('the gate in front of both modes', () => {
  for (const mode of ['share', 'signature'] as const) {
    it(`dispatches nothing for a submission that is not approved in ${mode} mode`, async () => {
      loadPublishedTemplate.mockResolvedValue({ deliveryMode: mode });
      db.row = approvedRow({ status: 'pending', decided_by: null, decided_at: null });
      const out = await retryTemplateReleaseAction(SUBMISSION_ID);
      expect(out).toEqual({
        ok: false,
        error: 'This document has not been approved for release.',
      });
      expect(releaseApprovedSubmission).not.toHaveBeenCalled();
      expect(materializeSubmissionDocument).not.toHaveBeenCalled();
      expect(createSigningRequestAction).not.toHaveBeenCalled();
      expect(db.row.status).toBe('pending');
    });

    it(`dispatches nothing for an approval with no approver in ${mode} mode`, async () => {
      loadPublishedTemplate.mockResolvedValue({ deliveryMode: mode });
      db.row = approvedRow({ decided_by: null });
      const out = await retryTemplateReleaseAction(SUBMISSION_ID);
      expect(out.ok).toBe(false);
      expect(releaseApprovedSubmission).not.toHaveBeenCalled();
      expect(materializeSubmissionDocument).not.toHaveBeenCalled();
      expect(createSigningRequestAction).not.toHaveBeenCalled();
    });
  }

  it('refuses a second signature dispatch for a submission that already has one', async () => {
    loadPublishedTemplate.mockResolvedValue({ deliveryMode: 'signature' });
    db.row = approvedRow({ signing_request_id: 'req-1' });
    const out = await retryTemplateReleaseAction(SUBMISSION_ID);
    expect(out).toEqual({
      ok: false,
      error: 'This document has already been sent for signature.',
    });
    expect(materializeSubmissionDocument).not.toHaveBeenCalled();
    expect(createSigningRequestAction).not.toHaveBeenCalled();
  });
});
