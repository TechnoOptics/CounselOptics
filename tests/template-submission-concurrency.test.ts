import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The reviewer actions, run for real against a fake table.
 *
 * The sibling file tests/template-submissions-authz.test.ts reads this module
 * as text, and that is a floor with a known ceiling: a structural assertion can
 * only pin the shape the author wrote, so when the author compares against the
 * wrong value the assertion pins the bug. That is exactly what happened here.
 * The edit's compare-and-swap read `.eq('document_text', row.document_text)`,
 * the test asserted that literal string, and both agreed with each other while
 * a second reviewer's work was being silently thrown away.
 *
 * So these run the actions. The Supabase client is a fake that holds one row
 * and applies an update only when every `.eq()` predicate matches the row as it
 * stands, which is what a conditional update does, and the assertions are about
 * what ends up in that row rather than about how the query was spelled. The
 * surrounding modules are stubbed because they are not what is under test: the
 * pure rules in lib/template-approval.ts and the shape work in
 * lib/template-submission-types.ts are the real thing.
 *
 * The scenario throughout is the one that costs a firm real work. Attorney A
 * opens a document at ten o'clock. Attorney B opens it at two past, adds a
 * confidentiality carve-out, and saves. A saves at five past, from what they
 * read at ten. B's carve-out must not vanish, and A must be told.
 */

type Row = Record<string, unknown>;

const store: { row: Row } = { row: {} };
let currentUser: { id: string; email: string } | null = null;
let currentRole: string | null = null;

/**
 * Runs once, immediately after the next read, and then clears itself.
 *
 * This is how the compare-and-swap gets exercised at all. Each action compares
 * what the reviewer sent against the row it has just read, and that pre-check
 * short-circuits before the write on every ordinary stale case, so the fake
 * table is never mutated between an action's own read and its own write and
 * the conditional predicate is never the thing that decides. Dropping the
 * predicate would leave this file green. With this hook the row moves in
 * exactly that gap: the pre-check passes on a snapshot that was true a moment
 * ago, and only the predicate on the write can still refuse.
 */
let mutateAfterNextRead: (() => void) | null = null;

/** Set to make the next write report a transport failure rather than a miss. */
let failNextWrite: string | null = null;

/**
 * One table, one row, and predicates that actually decide whether an update
 * lands or a read returns. That is the only database behaviour these tests
 * depend on, and it is the behaviour a compare-and-swap is built out of.
 *
 * `.in()` and `.not()` are here for the queue read, which is two status-filtered
 * queries rather than one read of everything. They filter for real, so a test
 * that puts the row in a settled status sees it come back from the settled
 * query and NOT from the open one. Left as no-ops they would have returned the
 * same row from both and quietly doubled every queue assertion.
 *
 * `.maybeSingle()` / `.single()` yield the row; awaiting the builder directly
 * yields an array, the way PostgREST itself does.
 */
function makeAdmin() {
  return {
    from() {
      let patch: Row | null = null;
      const preds: ((row: Row) => boolean)[] = [];
      const run = (asList: boolean) => {
        const matches = preds.every((p) => p(store.row));
        if (!matches) return { data: asList ? [] : null, error: null };
        if (patch) {
          if (failNextWrite) {
            const message = failNextWrite;
            failNextWrite = null;
            return { data: null, error: { message } };
          }
          store.row = { ...store.row, ...patch };
          return { data: asList ? [{ ...store.row }] : { ...store.row }, error: null };
        }
        const snapshot = { ...store.row };
        if (mutateAfterNextRead) {
          const hook = mutateAfterNextRead;
          mutateAfterNextRead = null;
          hook();
        }
        return { data: asList ? [snapshot] : snapshot, error: null };
      };
      const api = {
        select: () => api,
        update: (p: Row) => {
          patch = p;
          return api;
        },
        insert: () => api,
        eq: (col: string, val: unknown) => {
          preds.push((r) => r[col] === val);
          return api;
        },
        is: (col: string, val: unknown) => {
          preds.push((r) => r[col] === val);
          return api;
        },
        neq: (col: string, val: unknown) => {
          preds.push((r) => r[col] !== val);
          return api;
        },
        lte: (col: string, val: unknown) => {
          preds.push((r) => String(r[col] ?? '') <= String(val));
          return api;
        },
        in: (col: string, vals: unknown[]) => {
          preds.push((r) => vals.includes(r[col]));
          return api;
        },
        // `.not(col, 'in', '(a,b,c)')` and `.not(col, 'is', null)`, the two
        // forms the queue read and the failed-delivery count use.
        not: (col: string, op: string, val: unknown) => {
          if (op === 'in') {
            const list = String(val).replace(/^\(|\)$/g, '').split(',');
            preds.push((r) => !list.includes(String(r[col])));
          } else {
            preds.push((r) => r[col] !== val);
          }
          return api;
        },
        order: () => api,
        limit: () => api,
        maybeSingle: async () => run(false),
        single: async () => run(false),
        then: (resolve: (value: unknown) => void) => {
          resolve(run(true));
        },
      };
      return api;
    },
  };
}

const releaseApprovedSubmission = vi.fn(async () => ({ ok: true as const }));
const createNotification = vi.fn(async () => undefined);

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../lib/supabase/server', () => ({
  getCurrentUser: async () => currentUser,
  createServerSupabase: async () => null,
  isSupabaseConfigured: () => true,
}));
vi.mock('../lib/supabase/admin', () => ({ createAdminSupabase: () => makeAdmin() }));
// Loaded for real so FIRM_MANAGE_ROLES stays the real role list; only the
// lookup that hits the database is replaced.
vi.mock('../lib/firm-authz', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callerFirmRole: async () => currentRole,
}));
vi.mock('../lib/portal-entitlements', () => ({
  authorizeFirmActor: async () => ({ ok: true }),
}));
vi.mock('../lib/firm-storage', () => ({
  getFirmByIdAdmin: async () => ({ name: 'A Firm' }),
  getActiveFirmContext: async () => null,
}));
vi.mock('../lib/intake-notify', () => ({
  hydratePeople: async () => new Map(),
  siteUrl: () => 'https://example.test',
}));
vi.mock('../lib/notifications', () => ({ createNotification }));
vi.mock('../lib/rate-limit', () => ({ checkRateLimit: async () => true }));
vi.mock('../lib/firm-template-placeholders', () => ({
  formatSignedOn: () => '1 January 2026',
  mergeTemplateDocument: () => 'merged',
}));
vi.mock('../lib/template-fill', () => ({
  loadPublishedTemplate: async () => null,
  sanitizeTemplateValues: () => ({}),
}));
vi.mock('../lib/template-release', () => ({ releaseApprovedSubmission }));

const {
  decideTemplateSubmissionAction,
  editTemplateSubmissionAction,
  getTemplateSubmissionAction,
  listFirmTemplateSubmissionsAction,
  withdrawTemplateSubmissionAction,
} = await import('../lib/template-submissions');

const V1 = 'The supplier shall deliver on time.';
const V2 = `${V1}\nNeither party may disclose the terms.`;
const V3 = 'The supplier shall deliver promptly.';

function pending(overrides: Row = {}): void {
  store.row = {
    id: 'sub-1',
    firm_id: 'firm-1',
    template_id: 'tpl-1',
    template_name: 'Mutual NDA',
    submitted_by: 'employee-1',
    submitter_name: 'A colleague',
    submitter_email: 'employee@example.test',
    recipient_name: null,
    recipient_email: 'other.side@example.test',
    recipient_note: null,
    field_values: {},
    signature_name: 'A Colleague',
    document_text: V1,
    status: 'pending',
    revision: 1,
    decided_by: null,
    decided_at: null,
    decision_note: null,
    original_document_text: null,
    edited_by: null,
    edited_at: null,
    edit_note: null,
    released_at: null,
    release_token: null,
    release_error: null,
    created_at: '2026-01-01T10:00:00.000Z',
    updated_at: '2026-01-01T10:00:00.000Z',
    submitted_at: '2026-01-01T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  currentUser = { id: 'attorney-a', email: 'a@firm.test' };
  currentRole = 'attorney';
  mutateAfterNextRead = null;
  failNextWrite = null;
  releaseApprovedSubmission.mockClear();
  createNotification.mockClear();
  pending();
});

/**
 * The other side of the same race: the employee pulling a document back
 * while a reviewer is deciding on it.
 *
 * The write is `.eq('status', row.status)`, which is a compare-and-swap and
 * the right guard. What was missing is that nobody read the result. The
 * exact case the predicate exists to catch matched zero rows, came back
 * with `error: null`, and the employee was told the document was out of the
 * release queue while counsel could still approve it out to a third party.
 *
 * Mutations these are meant to catch:
 *   - drop `.select('id')` and go back to reporting `{ ok: true }`: both
 *     the race and the transport-failure cases go red.
 *   - drop `.eq('status', row.status)`: "loses the race" goes red, because
 *     the withdrawal then lands on top of the reviewer's approval.
 */
describe('withdrawing a document from review', () => {
  it('does not report a withdrawal when a reviewer decided in the gap', async () => {
    // The pre-check reads `pending` and allows the withdrawal. The reviewer
    // approves in the moment before the write, so only the conditional
    // predicate can still refuse, and only the row count can report it.
    mutateAfterNextRead = () => {
      store.row.status = 'approved';
      store.row.decided_by = 'attorney-a';
    };
    currentUser = { id: 'employee-1', email: 'employee@example.test' };

    const res = await withdrawTemplateSubmissionAction('sub-1');

    expect(res.ok).toBe(false);
    // Not a blanket apology: the true and useful sentence is that somebody
    // decided this while they were reading.
    expect(res.error).toMatch(/decided this while you were reading/i);
    // The reviewer's decision stands, and the employee knows it does.
    expect(store.row.status).toBe('approved');
    expect(store.row.decided_by).toBe('attorney-a');
  });

  it('does not report a withdrawal the database refused', async () => {
    failNextWrite = 'connection reset';
    currentUser = { id: 'employee-1', email: 'employee@example.test' };

    const res = await withdrawTemplateSubmissionAction('sub-1');

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/could not withdraw/i);
    expect(store.row.status).toBe('pending');
  });

  it('withdraws, and says so, when nothing moved underneath it', async () => {
    currentUser = { id: 'employee-1', email: 'employee@example.test' };

    const res = await withdrawTemplateSubmissionAction('sub-1');

    expect(res).toEqual({ ok: true });
    expect(store.row.status).toBe('withdrawn');
  });
});

describe('a reviewer edit', () => {
  it('does not throw away a change another reviewer made in the meantime', async () => {
    // B has already saved the carve-out. A is working from what they read
    // before that happened.
    store.row.document_text = V2;
    store.row.original_document_text = V1;
    store.row.edited_by = 'attorney-b';
    store.row.revision = 2;

    const res = await editTemplateSubmissionAction('sub-1', V3, 'tightened', V1, 1);

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/changed since you opened it/i);
    // B's wording survives, and A is told rather than left believing it saved.
    expect(store.row.document_text).toBe(V2);
    expect(store.row.edited_by).toBe('attorney-b');
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('refuses when the document moves between its own read and its own write', async () => {
    // The pre-check cannot see this one: A sends the wording and the version
    // that were true when the action read the row, and B lands their edit in
    // the gap before the write. Only the conditional predicate on the update
    // can still refuse it, so this is the test that fails if that predicate
    // goes away.
    mutateAfterNextRead = () => {
      store.row.document_text = V2;
      store.row.original_document_text = V1;
      store.row.edited_by = 'attorney-b';
      store.row.revision = 2;
    };

    const res = await editTemplateSubmissionAction('sub-1', V3, 'tightened', V1, 1);

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/changed since you opened it/i);
    expect(store.row.document_text).toBe(V2);
    expect(store.row.edited_by).toBe('attorney-b');
    expect(store.row.revision).toBe(2);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('saves when the reviewer is working from the current wording', async () => {
    const res = await editTemplateSubmissionAction('sub-1', V3, 'tightened', V1, 1);

    expect(res.ok).toBe(true);
    expect(store.row.document_text).toBe(V3);
    // The employee's own words are copied aside on the first edit.
    expect(store.row.original_document_text).toBe(V1);
    expect(store.row.edited_by).toBe('attorney-a');
    expect(store.row.edit_note).toBe('tightened');
    // A version signal, so anyone else holding this document can see it moved.
    expect(store.row.revision).toBe(2);
    expect(createNotification).toHaveBeenCalledTimes(1);
  });

  it('leaves the employee original alone on a second edit', async () => {
    store.row.document_text = V2;
    store.row.original_document_text = V1;
    store.row.revision = 2;

    const res = await editTemplateSubmissionAction('sub-1', V3, null as never, V2, 2);

    expect(res.ok).toBe(true);
    expect(store.row.document_text).toBe(V3);
    expect(store.row.original_document_text).toBe(V1);
    expect(store.row.revision).toBe(3);
  });

  it('refuses a role that cannot release, before it says anything about wording', async () => {
    // The order of these two checks is load-bearing. A caller who may not edit
    // this document must learn that and nothing else: if the staleness check
    // ran first it would tell a member who is not allowed to read the wording
    // whether a string they guessed matches the stored one, one guess at a
    // time. The baseline here is deliberately wrong so only the ordering can
    // decide which message comes back.
    currentRole = 'paralegal';

    const res = await editTemplateSubmissionAction('sub-1', V3, 'tightened', 'anything at all', 99);

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/cannot change a document/i);
    expect(res.error).not.toMatch(/changed since you opened it/i);
    expect(store.row.document_text).toBe(V1);
  });

  it('refuses an edit that names no baseline at all', async () => {
    // Every export here is a public endpoint, so the argument can simply be
    // missing. Missing must fail closed, not fall back to the stored text.
    const res = await editTemplateSubmissionAction('sub-1', V3, 'tightened');

    expect(res.ok).toBe(false);
    expect(store.row.document_text).toBe(V1);
  });

  it('refuses an edit that names the wording but no version', async () => {
    // The version is what the conditional write swaps on, so omitting it must
    // fail closed rather than matching whatever the row happens to hold.
    const res = await editTemplateSubmissionAction('sub-1', V3, 'tightened', V1);

    expect(res.ok).toBe(false);
    expect(store.row.document_text).toBe(V1);
    expect(store.row.revision).toBe(1);
  });

  it('refuses a version that is not a stored revision', async () => {
    for (const forged of [0, -1, 1.5, '1', null, {}]) {
      pending();
      const res = await editTemplateSubmissionAction(
        'sub-1',
        V3,
        'tightened',
        V1,
        forged as never,
      );
      expect(res.ok).toBe(false);
      expect(store.row.document_text).toBe(V1);
    }
  });
});

describe('a reviewer decision', () => {
  it('does not approve wording the approver never read', async () => {
    // B edited at one minute past. A is deciding on what they read at ten.
    store.row.document_text = V2;
    store.row.original_document_text = V1;
    store.row.revision = 2;

    const res = await decideTemplateSubmissionAction('sub-1', 'approve', '', V1, 1);

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/wording changed/i);
    expect(store.row.status).toBe('pending');
    expect(store.row.decided_by).toBeNull();
    expect(releaseApprovedSubmission).not.toHaveBeenCalled();
  });

  it('refuses when the document moves between its own read and its own write', async () => {
    // As on the edit: the pre-check passes on a snapshot that was true a moment
    // ago, so the conditional predicate on the update is the only thing left to
    // stop an approver releasing text a colleague wrote in the gap.
    mutateAfterNextRead = () => {
      store.row.document_text = V2;
      store.row.revision = 2;
    };

    const res = await decideTemplateSubmissionAction('sub-1', 'approve', '', V1, 1);

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already acted/i);
    expect(store.row.status).toBe('pending');
    expect(store.row.decided_by).toBeNull();
    expect(releaseApprovedSubmission).not.toHaveBeenCalled();
  });

  it('approves and releases when the approver read the current wording', async () => {
    const res = await decideTemplateSubmissionAction('sub-1', 'approve', '', V1, 1);

    expect(res.ok).toBe(true);
    expect(store.row.decided_by).toBe('attorney-a');
    expect(releaseApprovedSubmission).toHaveBeenCalledTimes(1);
    expect(store.row.status).toBe('sent');
  });

  it('holds a decline to the same document the reviewer read', async () => {
    store.row.document_text = V2;

    const res = await decideTemplateSubmissionAction('sub-1', 'decline', 'not our terms', V1, 1);

    expect(res.ok).toBe(false);
    expect(store.row.status).toBe('pending');
  });

  it('records a decline against the document the reviewer did read', async () => {
    const res = await decideTemplateSubmissionAction('sub-1', 'decline', 'not our terms', V1, 1);

    expect(res.ok).toBe(true);
    expect(store.row.status).toBe('declined');
    expect(releaseApprovedSubmission).not.toHaveBeenCalled();
  });

  it('refuses a role that cannot decide, before it says anything about wording', async () => {
    // Same load-bearing order as on the edit, and for the same reason: the
    // staleness message is a yes-or-no answer about the stored wording, so it
    // must never be reachable by a caller the role check would have turned
    // away. The baseline is deliberately wrong so only the ordering decides.
    currentRole = 'paralegal';

    const res = await decideTemplateSubmissionAction(
      'sub-1',
      'approve',
      '',
      'anything at all',
      99,
    );

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/cannot approve documents/i);
    expect(res.error).not.toMatch(/wording changed/i);
    expect(store.row.status).toBe('pending');
    expect(releaseApprovedSubmission).not.toHaveBeenCalled();
  });

  it('refuses a decision that names no version', async () => {
    const res = await decideTemplateSubmissionAction('sub-1', 'approve', '', V1);

    expect(res.ok).toBe(false);
    expect(store.row.status).toBe('pending');
    expect(releaseApprovedSubmission).not.toHaveBeenCalled();
  });

  it('does not report a failed write as a colleague having got there first', async () => {
    // Telling an approver that somebody beat them to it, when the write simply
    // did not go through, sends them away from a document that is still sitting
    // there waiting and leaves nothing on the record. The two have to read
    // differently.
    failNextWrite = 'connection reset';

    const res = await decideTemplateSubmissionAction('sub-1', 'approve', '', V1, 1);

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/could not be recorded/i);
    expect(res.error).not.toMatch(/already acted/i);
    expect(store.row.status).toBe('pending');
    expect(releaseApprovedSubmission).not.toHaveBeenCalled();
  });
});

describe('reading a submission', () => {
  it('withholds the wording of a waiting document from a member who cannot release it', async () => {
    currentRole = 'paralegal';
    currentUser = { id: 'paralegal-1', email: 'p@firm.test' };

    const res = await getTemplateSubmissionAction('sub-1');

    expect(res.ok).toBe(true);
    expect(res.submission?.documentVisible).toBe(false);
    expect(res.submission?.documentText).toBe('');
    // The queue is still legible: who it is from, who it is for, where it got to.
    expect(res.submission?.recipientEmail).toBe('other.side@example.test');
    expect(res.submission?.status).toBe('pending');
  });

  it('withholds the employee original too, not just the current wording', async () => {
    currentRole = 'staff';
    currentUser = { id: 'staff-1', email: 's@firm.test' };
    store.row.original_document_text = V1;
    store.row.document_text = V2;

    const res = await getTemplateSubmissionAction('sub-1');

    expect(res.submission?.originalDocumentText).toBeNull();
  });

  it('opens the wording to the same member once the document has gone out', async () => {
    currentRole = 'paralegal';
    currentUser = { id: 'paralegal-1', email: 'p@firm.test' };
    store.row.status = 'sent';

    const res = await getTemplateSubmissionAction('sub-1');

    expect(res.submission?.documentVisible).toBe(true);
    expect(res.submission?.documentText).toBe(V1);
  });

  it('always shows the colleague who filled it in their own words', async () => {
    currentRole = null;
    currentUser = { id: 'employee-1', email: 'employee@example.test' };

    const res = await getTemplateSubmissionAction('sub-1');

    expect(res.submission?.documentVisible).toBe(true);
    expect(res.submission?.documentText).toBe(V1);
  });

  it('shows a reviewer who can release it the document they have to decide on', async () => {
    const res = await getTemplateSubmissionAction('sub-1');

    expect(res.submission?.documentVisible).toBe(true);
    expect(res.submission?.documentText).toBe(V1);
  });

  /**
   * The reviewer is told which of the two deliveries approving will perform,
   * and it has to be the one that will actually happen. Approving is the
   * moment they take responsibility for the document, so a page that named
   * the wrong mechanism there would be wrong at the only moment it matters.
   *
   * Resolved by the rule dispatch itself uses (resolveDispatchMode), not by a
   * second reading of the template, so the sentence and the send cannot
   * disagree.
   */
  it('says which delivery approving will perform', async () => {
    store.row.delivery_mode = 'signature';
    const res = await getTemplateSubmissionAction('sub-1');
    expect(res.deliveryMode).toBe('signature');
  });

  it('says a share for a row that records no mode of its own', async () => {
    // loadPublishedTemplate is null in this harness, which is the archived
    // template case, and 'share' is what that has always meant.
    const res = await getTemplateSubmissionAction('sub-1');
    expect(res.deliveryMode).toBe('share');
  });
});

/**
 * The queue is the wider half of the same narrowing, and it was pinned by
 * nothing. It is a public server action any firm member can call directly for
 * up to two hundred rows at a time, so a member who cannot release documents
 * could have pulled every waiting document in the firm out of it in one call.
 * The detail action returns one row and is reached through a page; this one is
 * the bulk read.
 */
describe('the firm review queue', () => {
  it('withholds the wording of every waiting document from a member who cannot release', async () => {
    currentRole = 'paralegal';
    currentUser = { id: 'paralegal-1', email: 'p@firm.test' };

    const res = await listFirmTemplateSubmissionsAction('firm-1');

    expect(res.ok).toBe(true);
    expect(res.canApprove).toBe(false);
    expect(res.submissions).toHaveLength(1);
    expect(res.submissions?.[0].documentVisible).toBe(false);
    expect(res.submissions?.[0].documentText).toBe('');
    // The queue is still legible: who it is from, who it is for, where it got to.
    expect(res.submissions?.[0].recipientEmail).toBe('other.side@example.test');
    expect(res.submissions?.[0].status).toBe('pending');
  });

  it('withholds the employee original in the queue too, not just the current wording', async () => {
    currentRole = 'staff';
    currentUser = { id: 'staff-1', email: 's@firm.test' };
    store.row.original_document_text = V1;
    store.row.document_text = V2;

    const res = await listFirmTemplateSubmissionsAction('firm-1');

    expect(res.submissions?.[0].originalDocumentText).toBeNull();
  });

  it('opens the wording to the same member once the document has gone out', async () => {
    currentRole = 'paralegal';
    currentUser = { id: 'paralegal-1', email: 'p@firm.test' };
    store.row.status = 'sent';

    const res = await listFirmTemplateSubmissionsAction('firm-1');

    expect(res.submissions?.[0].documentVisible).toBe(true);
    expect(res.submissions?.[0].documentText).toBe(V1);
  });

  it('always shows the colleague who filled it in their own words', async () => {
    currentRole = 'staff';
    currentUser = { id: 'employee-1', email: 'employee@example.test' };

    const res = await listFirmTemplateSubmissionsAction('firm-1');

    expect(res.submissions?.[0].documentVisible).toBe(true);
    expect(res.submissions?.[0].documentText).toBe(V1);
  });

  it('shows a reviewer who can release it the documents they have to decide on', async () => {
    const res = await listFirmTemplateSubmissionsAction('firm-1');

    expect(res.canApprove).toBe(true);
    expect(res.submissions?.[0].documentVisible).toBe(true);
    expect(res.submissions?.[0].documentText).toBe(V1);
  });
});
