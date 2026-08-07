import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The end of the chain: the reverse lookup from a completed signing request
 * back to the submission that produced it, and the two notifications that
 * follow.
 *
 * Three properties are held here, and each of them is a defect this slice
 * exists to close.
 *
 * 1. THE EMPLOYEE IS SENT SOMEWHERE THEY CAN OPEN. The generic completion
 *    notice points every signer at /inbox/documents, which is the consumer
 *    inbox behind a Pro plan gate. An employee told their document is ready
 *    and pointed at a page they are not entitled to open has been dropped out
 *    of their own process at the moment it finished.
 *
 * 2. THE TWO NOTIFICATIONS ARE INDEPENDENT. If the employee cannot be told,
 *    the legal team is still told, and the other way round. Neither failure
 *    is allowed to take the other with it, and neither is allowed to escape
 *    into the signing path.
 *
 * 3. NOTHING IS ANNOUNCED THAT DID NOT HAPPEN. A request that is not
 *    completed produces no notice at all, and an unapplied migration produces
 *    exactly today's behaviour rather than an error on the signing path.
 */

type NotificationInput = { userId: string; title: string; body?: string; link?: string };
type EmailInput = { to: string; subject: string; html: string };

const createNotification = vi.hoisted(() =>
  vi.fn(async (_input: { userId: string; title: string; body?: string; link?: string }) => null),
);
const sendEmail = vi.hoisted(() =>
  vi.fn(async (_input: { to: string; subject: string; html: string }) => ({ ok: true })),
);

vi.mock('../lib/notifications', () => ({ createNotification }));
vi.mock('../lib/email', () => ({
  sendEmail,
  buildSubmissionSignedEmailHtml: (input: Record<string, unknown>) =>
    `<html>${String(input.counterparty)}</html>`,
}));
vi.mock('../lib/firm-authz', () => ({
  FIRM_MANAGE_ROLES: ['owner', 'admin', 'attorney'],
}));
vi.mock('../lib/intake-notify', () => ({ siteUrl: () => 'https://advottic.test' }));

const {
  notifySubmissionCompletion,
  submissionPortalPath,
  loadSubmissionSigning,
  submissionCategoriesForRequests,
} = await import('../lib/submission-completion');

// ── A narrow fake of the admin client ────────────────────────────────────

type Row = Record<string, unknown>;

const db = {
  requests: [] as Row[],
  submissions: [] as Row[],
  signatures: [] as Row[],
  members: [] as Row[],
  /** Tables whose columns 20260807_flow_join.sql has not added yet. */
  missingColumn: null as string | null,
  /** Paths the storage fake will mint a link for. */
  signable: [] as string[],
};

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private conds: Array<[string, unknown]> = [];
  private ins: Array<[string, readonly unknown[]]> = [];
  private selected = '';
  constructor(private rows: Row[], private table: string) {}
  select(cols = '') {
    this.selected = cols;
    return this;
  }
  eq(col: string, value: unknown) {
    this.conds.push([col, value]);
    return this;
  }
  in(col: string, values: readonly unknown[]) {
    this.ins.push([col, values]);
    return this;
  }
  limit() {
    return this;
  }
  private run(): { data: unknown; error: unknown } {
    // PostgREST refuses the whole statement when a filter or a projection
    // names a column the table does not have. That is what a firm running
    // without the migration gets, and it must not break the signing path.
    const named = [
      this.selected,
      ...this.conds.map(([c]) => c),
      ...this.ins.map(([c]) => c),
    ].join(',');
    if (db.missingColumn && named.includes(db.missingColumn)) {
      return { data: null, error: { code: '42703', message: 'column does not exist' } };
    }
    const hits = this.rows.filter(
      (r) =>
        this.conds.every(([c, v]) => r[c] === v) &&
        this.ins.every(([c, vs]) => vs.includes(r[c])),
    );
    return { data: hits, error: null };
  }
  maybeSingle() {
    const out = this.run();
    if (out.error) return Promise.resolve(out);
    return Promise.resolve({ data: (out.data as Row[])[0] ?? null, error: null });
  }
  then<A, B>(
    resolve?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null,
    reject?: ((r: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(resolve, reject);
  }
}

const admin = {
  from(table: string) {
    if (table === 'firm_signing_requests') return new Query(db.requests, table);
    if (table === 'firm_template_submissions') return new Query(db.submissions, table);
    if (table === 'firm_signatures') return new Query(db.signatures, table);
    if (table === 'firm_members') return new Query(db.members, table);
    throw new Error(`unexpected table ${table}`);
  },
  storage: {
    from() {
      return {
        async createSignedUrl(path: string) {
          if (!db.signable.includes(path)) {
            return { data: null, error: { message: 'not found' } };
          }
          return { data: { signedUrl: `https://storage.test/${path}?token=x` }, error: null };
        },
      };
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const REQUEST_ID = 'req-1';

beforeEach(() => {
  createNotification.mockClear();
  createNotification.mockImplementation(async () => null);
  sendEmail.mockClear();
  sendEmail.mockImplementation(async () => ({ ok: true }));
  db.missingColumn = null;
  db.requests = [
    {
      id: REQUEST_ID,
      firm_id: 'firm-1',
      status: 'completed',
      completed_at: '2026-08-07T15:04:00.000Z',
    },
  ];
  db.submissions = [
    {
      id: 'sub-1',
      firm_id: 'firm-1',
      signing_request_id: REQUEST_ID,
      submitted_by: 'employee-1',
      submitter_name: 'Sam Ortiz',
      submitter_email: 'sam@anderson.test',
      template_name: 'Mutual NDA',
      recipient_name: 'Dana Whitfield',
      recipient_email: 'dana@northwind.test',
      ticket_number: 'REQ-0000042',
      category: 'NDA',
    },
  ];
  db.signatures = [
    {
      signing_request_id: REQUEST_ID,
      signer_name: 'Dana Whitfield',
      signer_email: 'dana@northwind.test',
      signed_at: '2026-08-07T15:03:00.000Z',
    },
  ];
  db.signable = ['firm-1/req-1/Mutual NDA.signed.pdf'];
  db.members = [
    { firm_id: 'firm-1', user_id: 'owner-1', role: 'owner' },
    { firm_id: 'firm-1', user_id: 'attorney-1', role: 'attorney' },
    { firm_id: 'firm-1', user_id: 'staff-1', role: 'staff' },
    { firm_id: 'firm-other', user_id: 'outsider-1', role: 'owner' },
  ];
});

function notificationCalls(): NotificationInput[] {
  return createNotification.mock.calls.map((c) => c[0] as NotificationInput);
}

function notifiedUsers(): string[] {
  return notificationCalls().map((c) => c.userId);
}

function callFor(userId: string): NotificationInput | undefined {
  return notificationCalls().find((c) => c.userId === userId);
}

describe('notifySubmissionCompletion', () => {
  /**
   * THE DEFECT THIS SLICE EXISTS TO CLOSE. /inbox/documents is the consumer
   * inbox and it refuses anyone without a Pro plan, so an employee following
   * that link is told their document is ready and shown an upsell. The
   * portal submission page is a route every filing employee already holds.
   */
  it('sends the employee to their own portal record, never to the consumer inbox', async () => {
    await notifySubmissionCompletion(admin, REQUEST_ID);
    const employee = callFor('employee-1');
    expect(employee?.link).toBe('/portal/forms/submissions/sub-1');
    expect(submissionPortalPath('sub-1')).toBe('/portal/forms/submissions/sub-1');
    for (const call of notificationCalls()) {
      expect(call.link ?? '').not.toContain('/inbox/');
    }
  });

  /** The legal team as a group, not only whoever pressed approve. */
  it('tells every member who may act on documents, and nobody else', async () => {
    await notifySubmissionCompletion(admin, REQUEST_ID);
    const users = notifiedUsers();
    expect(users).toContain('owner-1');
    expect(users).toContain('attorney-1');
    expect(users).not.toContain('staff-1');
    expect(users).not.toContain('outsider-1');
    expect(callFor('owner-1')?.link).toBe(`/counsel/signing/${REQUEST_ID}`);
  });

  /**
   * The category is READ from the record, not derived again from the
   * template. Slice 2 copied it onto the row precisely so the template could
   * be recategorised later without changing what this document was filed
   * under, and a second derivation here would drift from the first.
   */
  it('quotes the category and the reference the record carries', async () => {
    await notifySubmissionCompletion(admin, REQUEST_ID);
    const legal = callFor('owner-1');
    expect(legal?.body).toContain('NDA');
    expect(legal?.body).toContain('REQ-0000042');
    expect(callFor('employee-1')?.body).toContain('REQ-0000042');
  });

  it('emails the employee as well as ringing their bell', async () => {
    await notifySubmissionCompletion(admin, REQUEST_ID);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0][0] as EmailInput;
    expect(mail.to).toBe('sam@anderson.test');
    expect(mail.subject).toBe('REQ-0000042: Mutual NDA is fully signed');
    expect(mail.html).toContain('Dana Whitfield');
  });

  // ── Independence ───────────────────────────────────────────────────────

  /**
   * A notification that cannot be written for one party must not silence the
   * other. This repo produced a bug on the same day this was written where a
   * failure on one side of a fan-out took the other side with it.
   */
  it('still tells the legal team when the employee cannot be told', async () => {
    createNotification.mockImplementation(async (input: NotificationInput) => {
      if (input.userId === 'employee-1') throw new Error('notification insert refused');
      return null;
    });
    await expect(notifySubmissionCompletion(admin, REQUEST_ID)).resolves.toBeTruthy();
    expect(notifiedUsers()).toContain('owner-1');
    expect(notifiedUsers()).toContain('attorney-1');
  });

  it('still tells the employee when the legal team cannot be told', async () => {
    createNotification.mockImplementation(async (input: NotificationInput) => {
      if (input.userId !== 'employee-1') throw new Error('notification insert refused');
      return null;
    });
    await notifySubmissionCompletion(admin, REQUEST_ID);
    expect(notifiedUsers()).toContain('employee-1');
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  /** The bell and the email are two deliveries, and one is not the other. */
  it('still rings the bell when the email will not send', async () => {
    sendEmail.mockRejectedValue(new Error('mail down') as never);
    await notifySubmissionCompletion(admin, REQUEST_ID);
    expect(notifiedUsers()).toContain('employee-1');
  });

  // ── Refusals ───────────────────────────────────────────────────────────

  /**
   * The outcome reports what the RECORD is, not what was delivered. The
   * caller uses it to decide where the employee's link should point, and
   * that answer does not change because a notification insert failed. This
   * repo has already shipped one audit event asserting a delivery that never
   * happened; this is the same mistake in a different shape and it is not
   * being made again.
   */
  it('reports the record, not the delivery', async () => {
    createNotification.mockRejectedValue(new Error('all notifications down') as never);
    sendEmail.mockRejectedValue(new Error('mail down') as never);
    const out = await notifySubmissionCompletion(admin, REQUEST_ID);
    expect(out).toEqual({ backed: true, submissionId: 'sub-1', submittedBy: 'employee-1' });
  });

  it('says nothing about a request no submission produced', async () => {
    db.submissions = [];
    const out = await notifySubmissionCompletion(admin, REQUEST_ID);
    expect(out).toEqual({ backed: false });
    expect(createNotification).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  /**
   * Announcing a completion the request itself does not claim would be a
   * false statement to both parties, so the request row is asked first.
   */
  it('refuses to announce a request that is not completed', async () => {
    db.requests[0].status = 'partial';
    const out = await notifySubmissionCompletion(admin, REQUEST_ID);
    expect(out).toEqual({ backed: false });
    expect(createNotification).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  /**
   * With 20260807_flow_join.sql unapplied there is no signing_request_id
   * column, so the lookup is refused by PostgREST rather than returning
   * nothing. A firm in that state must see exactly today's behaviour: no
   * notice, no throw, and nothing broken on the path that called this.
   */
  it('is silent and safe when the migration has not been applied', async () => {
    db.missingColumn = 'signing_request_id';
    const out = await notifySubmissionCompletion(admin, REQUEST_ID);
    expect(out).toEqual({ backed: false });
    expect(createNotification).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  /** No address on the record is a reason not to send, not a reason to fail. */
  it('skips the email but keeps the bell when there is no address on file', async () => {
    db.submissions[0].submitter_email = null;
    await notifySubmissionCompletion(admin, REQUEST_ID);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(notifiedUsers()).toContain('employee-1');
  });
});

/**
 * The employee's own view of the signature side.
 *
 * Before this, nothing on any portal surface read a signing request or a
 * signed_file_path, so the colleague who filed the document was told it had
 * gone out and then never heard about it again on their own pages.
 */
describe('loadSubmissionSigning', () => {
  const EXECUTED = 'firm-1/req-1/Mutual NDA.signed.pdf';

  beforeEach(() => {
    db.requests[0].signed_file_path = EXECUTED;
  });

  it('mints a short-lived link to the executed copy for a completed request', async () => {
    const signing = await loadSubmissionSigning(admin, REQUEST_ID, true);
    expect(signing?.status).toBe('completed');
    expect(signing?.executedUrl).toBe(`https://storage.test/${EXECUTED}?token=x`);
    expect(signing?.signers).toEqual([
      {
        name: 'Dana Whitfield',
        email: 'dana@northwind.test',
        signedAt: '2026-08-07T15:03:00.000Z',
      },
    ]);
  });

  /** The stored path itself never leaves the server. */
  it('carries a signed URL and never the storage path', async () => {
    const signing = await loadSubmissionSigning(admin, REQUEST_ID, true);
    expect(signing?.executedUrl).toContain('token=');
    expect(JSON.stringify(signing)).not.toContain(`"${EXECUTED}"`);
  });

  /**
   * A signed_file_path on a request that is not completed belongs to some
   * earlier state of it, and offering it would assert an execution the
   * request's own status denies. That rule is selectSigningArtifact's, reused
   * rather than restated, and this is what holds the reuse in place.
   */
  it('refuses an executed copy the request status does not claim', async () => {
    db.requests[0].status = 'partial';
    const signing = await loadSubmissionSigning(admin, REQUEST_ID, true);
    expect(signing?.status).toBe('partial');
    expect(signing?.executedUrl).toBeNull();
  });

  /**
   * The executed copy IS the document, in the form that is easiest to keep
   * and forward, so it cannot be more available than the wording. A reader
   * refused the text still learns where the signature has got to, because
   * that is a status and not a document.
   */
  it('withholds the file from a reader who may not read the wording', async () => {
    const signing = await loadSubmissionSigning(admin, REQUEST_ID, false);
    expect(signing?.executedUrl).toBeNull();
    expect(signing?.signers).toHaveLength(1);
  });

  /** A link that will not mint is a missing link, not a missing signature. */
  it('still reports the signatures when the link cannot be minted', async () => {
    db.signable = [];
    const signing = await loadSubmissionSigning(admin, REQUEST_ID, true);
    expect(signing?.status).toBe('completed');
    expect(signing?.executedUrl).toBeNull();
    expect(signing?.signers).toHaveLength(1);
  });

  /**
   * With 20260807_flow_join.sql unapplied there is no signing_request_id on
   * the submission at all, so the page is handed nothing and renders exactly
   * as it does today.
   */
  it('has nothing to report without a signing request to follow', async () => {
    expect(await loadSubmissionSigning(admin, null, true)).toBeNull();
    expect(await loadSubmissionSigning(admin, undefined, true)).toBeNull();
  });

  it('reports nothing for a signing request that is not there', async () => {
    expect(await loadSubmissionSigning(admin, 'no-such-request', true)).toBeNull();
  });
});

/**
 * The legal team's side of the same fact: what each executed request was
 * filed under, so the queue can group by it.
 */
describe('submissionCategoriesForRequests', () => {
  it('reads the category off the submission that produced each request', async () => {
    const map = await submissionCategoriesForRequests(admin, 'firm-1', [REQUEST_ID]);
    expect(map.get(REQUEST_ID)).toBe('NDA');
  });

  /**
   * A request with no submission behind it is simply absent, and the caller
   * groups it as unfiled. It is a plainly uploaded document and there is
   * nothing on the record that says what kind it is.
   */
  it('omits a request no submission produced', async () => {
    const map = await submissionCategoriesForRequests(admin, 'firm-1', ['req-other']);
    expect(map.size).toBe(0);
  });

  /**
   * The service-role client bypasses RLS, so scoping the read to the firm the
   * page has already established the caller belongs to is the whole of the
   * containment. A firm id that does not match reads nothing.
   */
  it('reads nothing outside the firm it was asked about', async () => {
    const map = await submissionCategoriesForRequests(admin, 'firm-other', [REQUEST_ID]);
    expect(map.size).toBe(0);
  });

  it('labels a submission with no category of its own as unfiled', async () => {
    db.submissions[0].category = null;
    const map = await submissionCategoriesForRequests(admin, 'firm-1', [REQUEST_ID]);
    expect(map.get(REQUEST_ID)).toBe('Unfiled');
  });

  /**
   * With the migration unapplied the whole statement is refused. The queue
   * must render, so this comes back empty and every request groups as
   * unfiled rather than the page failing.
   */
  it('comes back empty rather than throwing when the migration is unapplied', async () => {
    db.missingColumn = 'signing_request_id';
    const map = await submissionCategoriesForRequests(admin, 'firm-1', [REQUEST_ID]);
    expect(map.size).toBe(0);
  });

  it('asks nothing at all for an empty list', async () => {
    const map = await submissionCategoriesForRequests(admin, 'firm-1', []);
    expect(map.size).toBe(0);
  });
});
