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
 * One table, one row, and `.eq()` predicates that actually decide whether an
 * update lands. That is the only database behaviour these tests depend on, and
 * it is the behaviour a compare-and-swap is built out of.
 */
function makeAdmin() {
  return {
    from() {
      let patch: Row | null = null;
      const preds: [string, unknown][] = [];
      const run = () => {
        const matches = preds.every(([col, val]) => store.row[col] === val);
        if (!matches) return { data: null, error: null };
        if (patch) store.row = { ...store.row, ...patch };
        return { data: { ...store.row }, error: null };
      };
      const api = {
        select: () => api,
        update: (p: Row) => {
          patch = p;
          return api;
        },
        insert: () => api,
        eq: (col: string, val: unknown) => {
          preds.push([col, val]);
          return api;
        },
        is: (col: string, val: unknown) => {
          preds.push([col, val]);
          return api;
        },
        order: () => api,
        limit: () => api,
        maybeSingle: async () => run(),
        single: async () => run(),
        then: (resolve: (value: unknown) => void) => {
          resolve(run());
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
  releaseApprovedSubmission.mockClear();
  createNotification.mockClear();
  pending();
});

describe('a reviewer edit', () => {
  it('does not throw away a change another reviewer made in the meantime', async () => {
    // B has already saved the carve-out. A is working from what they read
    // before that happened.
    store.row.document_text = V2;
    store.row.original_document_text = V1;
    store.row.edited_by = 'attorney-b';
    store.row.revision = 2;

    const res = await editTemplateSubmissionAction('sub-1', V3, 'tightened', V1);

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/changed since you opened it/i);
    // B's wording survives, and A is told rather than left believing it saved.
    expect(store.row.document_text).toBe(V2);
    expect(store.row.edited_by).toBe('attorney-b');
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('saves when the reviewer is working from the current wording', async () => {
    const res = await editTemplateSubmissionAction('sub-1', V3, 'tightened', V1);

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

    const res = await editTemplateSubmissionAction('sub-1', V3, null as never, V2);

    expect(res.ok).toBe(true);
    expect(store.row.document_text).toBe(V3);
    expect(store.row.original_document_text).toBe(V1);
    expect(store.row.revision).toBe(3);
  });

  it('refuses a role that cannot release, before it says anything about wording', async () => {
    currentRole = 'paralegal';

    const res = await editTemplateSubmissionAction('sub-1', V3, 'tightened', 'anything at all');

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/cannot change a document/i);
    expect(store.row.document_text).toBe(V1);
  });

  it('refuses an edit that names no baseline at all', async () => {
    // Every export here is a public endpoint, so the argument can simply be
    // missing. Missing must fail closed, not fall back to the stored text.
    const res = await editTemplateSubmissionAction('sub-1', V3, 'tightened');

    expect(res.ok).toBe(false);
    expect(store.row.document_text).toBe(V1);
  });
});

describe('a reviewer decision', () => {
  it('does not approve wording the approver never read', async () => {
    // B edited at one minute past. A is deciding on what they read at ten.
    store.row.document_text = V2;
    store.row.original_document_text = V1;
    store.row.revision = 2;

    const res = await decideTemplateSubmissionAction('sub-1', 'approve', '', V1);

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/wording changed/i);
    expect(store.row.status).toBe('pending');
    expect(store.row.decided_by).toBeNull();
    expect(releaseApprovedSubmission).not.toHaveBeenCalled();
  });

  it('approves and releases when the approver read the current wording', async () => {
    const res = await decideTemplateSubmissionAction('sub-1', 'approve', '', V1);

    expect(res.ok).toBe(true);
    expect(store.row.decided_by).toBe('attorney-a');
    expect(releaseApprovedSubmission).toHaveBeenCalledTimes(1);
    expect(store.row.status).toBe('sent');
  });

  it('holds a decline to the same document the reviewer read', async () => {
    store.row.document_text = V2;

    const res = await decideTemplateSubmissionAction('sub-1', 'decline', 'not our terms', V1);

    expect(res.ok).toBe(false);
    expect(store.row.status).toBe('pending');
  });

  it('records a decline against the document the reviewer did read', async () => {
    const res = await decideTemplateSubmissionAction('sub-1', 'decline', 'not our terms', V1);

    expect(res.ok).toBe(true);
    expect(store.row.status).toBe('declined');
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
});
