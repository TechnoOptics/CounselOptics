import { beforeEach, describe, expect, it, vi } from 'vitest';
import { documentSignatureHash } from '../lib/template-signature';

/**
 * The employee's mark, run for real against a fake table.
 *
 * The branch that built the signature pad could not persist anything: it was
 * told to leave lib/template-submissions.ts alone, so the mark was captured on
 * the approval-gated path and dropped on the floor server side. These are the
 * tests for the write that closes that, and they assert what ends up in the
 * row rather than how the query was spelled, for the reason the sibling file
 * tests/template-submission-concurrency.test.ts sets out at length: a
 * structural assertion pins the shape the author wrote, including when the
 * author wrote the wrong thing.
 *
 * The surrounding modules are stubbed because they are not what is under test.
 * lib/template-signature.ts is loaded for real apart from the one function that
 * needs a storage bucket, so the validation, the hashing and the column shaping
 * that decide what is recorded are the real thing.
 */

type Row = Record<string, unknown>;

const store: { row: Row } = { row: {} };
let currentUser: { id: string; email: string } | null = null;
let currentRole: string | null = null;
let mergedDocument = 'The supplier shall deliver on time.';

/**
 * Runs once, immediately after the next read or insert, then clears itself.
 *
 * This is how the compare-and-swap on the signature write gets exercised at
 * all. That write follows the write that created or updated the row, so the
 * only way another reviewer can land an edit in between is for the fake table
 * to move in exactly that gap.
 */
let mutateAfterNextRead: (() => void) | null = null;

/** Set to make storeSubmissionMark report a failed upload. */
let uploadFails = false;

const uploads: {
  firmId: string;
  submissionId: string;
  revision: number;
  bytes: Buffer;
}[] = [];

/**
 * One table, one row. `.eq()` predicates decide whether an update lands, which
 * is the only database behaviour these tests depend on and the behaviour a
 * compare-and-swap is built out of. An insert fills the row and supplies the
 * defaults the real column definitions carry.
 */
function makeAdmin() {
  return {
    from() {
      let patch: Row | null = null;
      let inserting = false;
      const preds: [string, unknown][] = [];
      const run = (asList: boolean) => {
        if (inserting && patch) {
          store.row = { id: 'sub-1', revision: 1, ...patch };
          const inserted = { ...store.row };
          if (mutateAfterNextRead) {
            const hook = mutateAfterNextRead;
            mutateAfterNextRead = null;
            hook();
          }
          return { data: asList ? [inserted] : inserted, error: null };
        }
        const matches = preds.every(([col, val]) => store.row[col] === val);
        if (!matches) return { data: asList ? [] : null, error: null };
        if (patch) {
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
        insert: (p: Row) => {
          patch = p;
          inserting = true;
          return api;
        },
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

const createNotification = vi.fn(async () => undefined);

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: () => ({
    get: (name: string) =>
      ({
        'x-forwarded-for': '203.0.113.7, 70.41.3.18',
        'user-agent': 'Mozilla/5.0 (a real browser)',
      })[name.toLowerCase()] ?? null,
  }),
}));
vi.mock('../lib/supabase/server', () => ({
  getCurrentUser: async () => currentUser,
  createServerSupabase: async () => null,
  isSupabaseConfigured: () => true,
}));
vi.mock('../lib/supabase/admin', () => ({ createAdminSupabase: () => makeAdmin() }));
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
  mergeTemplateDocument: () => mergedDocument,
}));
vi.mock('../lib/template-fill', () => ({
  loadPublishedTemplate: async () => ({
    id: 'tpl-1',
    firmId: 'firm-1',
    name: 'Mutual NDA',
    body: 'body',
    fields: [],
  }),
  sanitizeTemplateValues: (_fields: unknown, values: Record<string, string>) => values,
}));
vi.mock('../lib/template-release', () => ({
  releaseApprovedSubmission: vi.fn(async () => ({ ok: true as const })),
}));
// Everything that decides what is recorded stays real. Only the one function
// that needs a live storage bucket is replaced.
vi.mock('../lib/template-signature', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  storeSubmissionMark: async (
    _admin: unknown,
    input: { firmId: string; submissionId: string; revision: number; bytes: Buffer },
  ) => {
    if (uploadFails) return null;
    uploads.push(input);
    return `templates/${input.firmId}/${input.submissionId}/${input.revision}.png`;
  },
}));

const {
  editTemplateSubmissionAction,
  resubmitTemplateSubmissionAction,
  submitTemplateForApprovalAction,
} = await import('../lib/template-submissions');

/** One 8-bit RGBA pixel: the smallest thing that is genuinely a PNG. */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);
const PNG_URL = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;

function input(overrides: Record<string, unknown> = {}) {
  return {
    recipientEmail: 'other.side@example.test',
    values: {},
    signatureName: 'A Colleague',
    signatureDataUrl: PNG_URL,
    signatureMode: 'drawn' as const,
    signatureIntentAt: '2026-01-01T10:00:00.000Z',
    ...overrides,
  };
}

function sentBack(overrides: Row = {}): void {
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
    document_text: 'The supplier shall deliver on time.',
    status: 'changes_requested',
    revision: 1,
    decided_by: 'attorney-a',
    decided_at: '2026-01-01T11:00:00.000Z',
    decision_note: 'Fix the term.',
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
    signature_image_path: 'templates/firm-1/sub-1/1.png',
    signature_mode: 'drawn',
    signature_captured_at: '2026-01-01T10:00:00.000Z',
    signature_intent_at: '2026-01-01T10:00:00.000Z',
    signature_ip: '203.0.113.7',
    signature_user_agent: 'Mozilla/5.0 (a real browser)',
    signed_document_sha256: documentSignatureHash('The supplier shall deliver on time.'),
    ...overrides,
  };
}

beforeEach(() => {
  currentUser = { id: 'employee-1', email: 'employee@example.test' };
  currentRole = 'attorney';
  mergedDocument = 'The supplier shall deliver on time.';
  mutateAfterNextRead = null;
  uploadFails = false;
  uploads.length = 0;
  createNotification.mockClear();
  store.row = {};
});

describe('submitting a filled template', () => {
  it('keeps the mark rather than dropping it', async () => {
    const res = await submitTemplateForApprovalAction('firm-1', 'tpl-1', input());

    expect(res.ok).toBe(true);
    // The bytes reached storage, under the firm, the submission and the
    // revision they belong to.
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({
      firmId: 'firm-1',
      submissionId: 'sub-1',
      revision: 1,
    });
    expect(uploads[0].bytes.equals(PNG_BYTES)).toBe(true);
    // And the row points at them.
    expect(store.row.signature_image_path).toBe('templates/firm-1/sub-1/1.png');
    expect(store.row.signature_mode).toBe('drawn');
    expect(store.row.signature_captured_at).toEqual(expect.any(String));
    expect(res.submission?.signatureImagePath).toBe('templates/firm-1/sub-1/1.png');
  });

  it('records the words that were signed, not the caller’s word for them', async () => {
    await submitTemplateForApprovalAction('firm-1', 'tpl-1', input());

    // The hash is over the document this server merged from the firm's own
    // template. Hashing anything that arrived in the request would undo the
    // reason the document is rebuilt server side at all.
    expect(store.row.signed_document_sha256).toBe(
      documentSignatureHash('The supplier shall deliver on time.'),
    );
    expect(store.row.signed_document_sha256).not.toBe(documentSignatureHash(''));
  });

  it('timestamps the intent from its own clock, so it cannot be backdated', async () => {
    await submitTemplateForApprovalAction(
      'firm-1',
      'tpl-1',
      input({ signatureIntentAt: '1999-01-01T00:00:00.000Z' }),
    );

    // The browser sends a time. It is read as "the box was ticked" and nothing
    // more: a time on an audit record that the signer chose is the signer's
    // word for when they signed.
    expect(store.row.signature_intent_at).not.toBe('1999-01-01T00:00:00.000Z');
    expect(
      new Date(String(store.row.signature_intent_at)).getFullYear(),
    ).toBeGreaterThan(2020);
  });

  it('leaves the intent unrecorded when the box was never ticked', async () => {
    await submitTemplateForApprovalAction(
      'firm-1',
      'tpl-1',
      input({ signatureIntentAt: undefined }),
    );

    expect(store.row.signature_intent_at).toBeNull();
  });

  it('records the address and the browser the mark came from', async () => {
    await submitTemplateForApprovalAction('firm-1', 'tpl-1', input());

    // The first hop of the forwarded chain, not the whole chain.
    expect(store.row.signature_ip).toBe('203.0.113.7');
    expect(store.row.signature_user_agent).toBe('Mozilla/5.0 (a real browser)');
  });

  it('drops a mode it does not recognise and keeps the rest of the record', async () => {
    await submitTemplateForApprovalAction(
      'firm-1',
      'tpl-1',
      input({ signatureMode: 'scribbled' as never }),
    );

    // The column carries a CHECK constraint, so an unrecognised value would
    // not be stored as an odd string, it would fail the whole update and take
    // the rest of the record with it.
    expect(store.row.signature_mode).toBeNull();
    expect(store.row.signature_image_path).toBe('templates/firm-1/sub-1/1.png');
    expect(store.row.signed_document_sha256).toEqual(expect.any(String));
  });

  it('still sends the document for review when the image will not upload', async () => {
    uploadFails = true;

    const res = await submitTemplateForApprovalAction('firm-1', 'tpl-1', input());

    // A document that reached the legal team without its squiggle is
    // recoverable. A document that vanished because a picture would not upload
    // is not.
    expect(res.ok).toBe(true);
    expect(store.row.status).toBe('pending');
    expect(store.row.signature_image_path).toBeNull();
    // Nothing was captured, so nothing claims to have been.
    expect(store.row.signature_captured_at).toBeNull();
    // The intent and the words signed are still on the record.
    expect(store.row.signature_intent_at).toEqual(expect.any(String));
    expect(store.row.signed_document_sha256).toEqual(expect.any(String));
  });

  it('still sends the document for review when the image is not an image', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');

    const res = await submitTemplateForApprovalAction(
      'firm-1',
      'tpl-1',
      input({ signatureDataUrl: `data:image/png;base64,${svg.toString('base64')}` }),
    );

    expect(res.ok).toBe(true);
    expect(uploads).toHaveLength(0);
    expect(store.row.signature_image_path).toBeNull();
  });

  it('does not attach the mark to a document that moved underneath it', async () => {
    // A reviewer edits in the gap between the submission landing and its mark
    // being stored. That edit bumps the revision and clears the signature
    // columns; without the predicate on the write, the mark would land on top
    // and claim the new wording had been signed.
    mutateAfterNextRead = () => {
      store.row.revision = 2;
      store.row.document_text = 'Rewritten by the legal team.';
    };

    const res = await submitTemplateForApprovalAction('firm-1', 'tpl-1', input());

    expect(res.ok).toBe(true);
    expect(store.row.revision).toBe(2);
    // Lost rather than misattached, which is the right way round.
    expect(store.row.signature_image_path ?? null).toBeNull();
    expect(store.row.signed_document_sha256 ?? null).toBeNull();
  });
});

describe('resubmitting after the legal team sent it back', () => {
  it('signs the new wording, under the new revision', async () => {
    sentBack();
    mergedDocument = 'The supplier shall deliver within five days.';

    const res = await resubmitTemplateSubmissionAction('sub-1', input());

    expect(res.ok).toBe(true);
    expect(store.row.revision).toBe(2);
    // A new revision is a new document, so it gets a new mark beside the old
    // one rather than over it, and a hash of the words actually resubmitted.
    expect(uploads).toHaveLength(1);
    expect(uploads[0].revision).toBe(2);
    expect(store.row.signature_image_path).toBe('templates/firm-1/sub-1/2.png');
    expect(store.row.signed_document_sha256).toBe(
      documentSignatureHash('The supplier shall deliver within five days.'),
    );
  });
});

describe('a reviewer editing the wording', () => {
  it('clears the signature, because it was affirmed against other words', async () => {
    sentBack({ status: 'pending' });
    currentUser = { id: 'attorney-a', email: 'a@firm.test' };

    const res = await editTemplateSubmissionAction(
      'sub-1',
      'The supplier shall deliver within five days.',
      'tightened',
      'The supplier shall deliver on time.',
      1,
    );

    expect(res.ok).toBe(true);
    expect(store.row.document_text).toBe('The supplier shall deliver within five days.');
    // Every one of the seven, including the hash. A hash left pointing at the
    // previous wording would say the current document had been signed.
    for (const col of [
      'signature_image_path',
      'signature_mode',
      'signature_captured_at',
      'signature_intent_at',
      'signature_ip',
      'signature_user_agent',
      'signed_document_sha256',
    ]) {
      expect(store.row[col]).toBeNull();
    }
  });

  it('leaves the signature alone when the edit is refused', async () => {
    sentBack({ status: 'pending' });
    currentUser = { id: 'attorney-a', email: 'a@firm.test' };
    const before = { ...store.row };

    const res = await editTemplateSubmissionAction(
      'sub-1',
      'The supplier shall deliver within five days.',
      'tightened',
      'Something nobody wrote.',
      1,
    );

    expect(res.ok).toBe(false);
    expect(store.row.signed_document_sha256).toBe(before.signed_document_sha256);
    expect(store.row.signature_image_path).toBe(before.signature_image_path);
  });
});
