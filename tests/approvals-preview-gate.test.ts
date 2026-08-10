import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The reviewer's preview of the branded artifact, and the two properties that
 * make it safe rather than dangerous.
 *
 *   1. IT IS PINNED TO THE VERSION THE PAGE RENDERED. The decision itself is
 *      conditional on the revision the reviewer's own page carried. A preview
 *      that could render a different revision would be worse than the plain
 *      text it replaces: the reviewer would believe they had checked a
 *      document they had not. So the route refuses anything but the revision
 *      and the wording it was handed, and it always draws the STORED text, not
 *      the posted copy.
 *   2. IT IS A READ. A prettier read of an unreleased document is still a read
 *      of it, so it is gated on canReadSubmissionDocument, the same predicate
 *      that decides whether the page prints the wording at all. A member who
 *      may follow the queue but not release cannot use it to see the words.
 *
 * The route is exercised for real. Only the renderer is replaced, so the
 * assertions are about who gets bytes and which text those bytes were built
 * from, rather than about PDF internals.
 */

type Row = Record<string, unknown>;

let currentUser: { id: string; email: string } | null = null;
let role: string | null = null;
let stored: Row | null = null;

// Hoisted, because vi.mock's factory runs before the module body and a plain
// const would not exist yet when it does.
const { renderSubmissionPreview } = vi.hoisted(() => ({
  renderSubmissionPreview: vi.fn(),
}));

function makeAdmin() {
  return {
    from() {
      const api = {
        select: () => api,
        eq: () => api,
        maybeSingle: async () => ({ data: stored ? { ...stored } : null, error: null }),
      };
      return api;
    },
  };
}

vi.mock('../lib/supabase/server', () => ({
  getCurrentUser: async () => currentUser,
  createServerSupabase: async () => null,
  isSupabaseConfigured: () => true,
}));
vi.mock('../lib/supabase/admin', () => ({ createAdminSupabase: () => makeAdmin() }));
// The real module, so canReadSubmissionDocument is the shipped rule; only the
// database lookup behind the role is replaced.
vi.mock('../lib/firm-authz', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callerFirmRole: async () => role,
}));
vi.mock('../lib/template-fill', () => ({
  loadPublishedTemplate: async () => null,
  sanitizeTemplateValues: () => ({}),
}));
vi.mock('../lib/submission-preview', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  renderSubmissionPreview,
}));

const { POST } = await import('../app/api/counsel/approvals/preview/route');
const { submissionPreviewInput } = await import('../lib/submission-preview');

const WORDING = 'The supplier shall deliver on time.';

const post = (body: unknown) =>
  POST({ json: async () => body } as unknown as Parameters<typeof POST>[0]);

beforeEach(() => {
  currentUser = { id: 'attorney-a', email: 'a@firm.test' };
  role = 'attorney';
  renderSubmissionPreview.mockReset();
  renderSubmissionPreview.mockImplementation(
    async (_admin: unknown, row: { document_text: string }) =>
      new Uint8Array(Buffer.from(`PDF-OF:${row.document_text}`)),
  );
  stored = {
    id: 'sub-1',
    firm_id: 'firm-1',
    template_id: 'tpl-1',
    template_name: 'Mutual NDA',
    submitted_by: 'employee-1',
    recipient_email: 'other.side@example.test',
    document_text: WORDING,
    status: 'pending',
    revision: 3,
    signature_image_path: null,
    delivery_mode: 'share',
  };
});

describe('the preview is pinned to what the reviewer read', () => {
  it('renders when the revision and the wording match the stored row', async () => {
    const res = await post({ submissionId: 'sub-1', revision: 3, documentText: WORDING });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(renderSubmissionPreview).toHaveBeenCalledTimes(1);
  });

  it('refuses a revision the page did not render', async () => {
    // A colleague edited the wording, which bumped the row to 4. This reviewer
    // is still looking at 3, and must not be shown 4 under the impression it
    // is what they read.
    const res = await post({ submissionId: 'sub-1', revision: 2, documentText: WORDING });
    expect(res.status).toBe(409);
    expect(await res.text()).toMatch(/changed while this was open/i);
    expect(renderSubmissionPreview).not.toHaveBeenCalled();
  });

  it('refuses when the wording moved even if the revision number matches', async () => {
    const res = await post({
      submissionId: 'sub-1',
      revision: 3,
      documentText: 'Something else entirely.',
    });
    expect(res.status).toBe(409);
    expect(renderSubmissionPreview).not.toHaveBeenCalled();
  });

  it('refuses a call that states no revision at all', async () => {
    const res = await post({ submissionId: 'sub-1', documentText: WORDING });
    expect(res.status).toBe(409);
    expect(renderSubmissionPreview).not.toHaveBeenCalled();
  });

  it('draws the STORED wording, never the copy the caller posted', async () => {
    const res = await post({ submissionId: 'sub-1', revision: 3, documentText: WORDING });
    // What reached the renderer is the row, not the request. There is no path
    // by which a caller's own words get onto the firm's letterhead here: a
    // posted string that differs is refused above, and a posted string that
    // matches is discarded in favour of the stored one.
    const rendered = renderSubmissionPreview.mock.calls[0][1] as { document_text: string };
    expect(rendered.document_text).toBe(WORDING);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(`PDF-OF:${WORDING}`);
  });
});

describe('the preview is a read of the wording, and gated like one', () => {
  it('refuses a paralegal on a document that has not been released', async () => {
    role = 'paralegal';
    const res = await post({ submissionId: 'sub-1', revision: 3, documentText: WORDING });
    expect(res.status).toBe(403);
    expect(renderSubmissionPreview).not.toHaveBeenCalled();
  });

  it('refuses a staff member on a document that has not been released', async () => {
    role = 'staff';
    const res = await post({ submissionId: 'sub-1', revision: 3, documentText: WORDING });
    expect(res.status).toBe(403);
    expect(renderSubmissionPreview).not.toHaveBeenCalled();
  });

  it('refuses somebody with no role in the firm', async () => {
    role = null;
    const res = await post({ submissionId: 'sub-1', revision: 3, documentText: WORDING });
    expect(res.status).toBe(403);
    expect(renderSubmissionPreview).not.toHaveBeenCalled();
  });

  it('lets the colleague who filled it in see their own words', async () => {
    role = null;
    currentUser = { id: 'employee-1', email: 'employee@example.test' };
    const res = await post({ submissionId: 'sub-1', revision: 3, documentText: WORDING });
    expect(res.status).toBe(200);
  });

  it('lets any member see one the firm has agreed to send', async () => {
    role = 'paralegal';
    (stored as Row).status = 'sent';
    const res = await post({ submissionId: 'sub-1', revision: 3, documentText: WORDING });
    expect(res.status).toBe(200);
  });

  it('answers a reader who may not read with the READ refusal, never the staleness one', async () => {
    // ORDER. If the staleness comparison ran first, this caller would be told
    // whether a guessed string matches the stored wording, which turns the
    // narrowed read into an oracle. They must learn only that they may not
    // read it.
    role = 'paralegal';
    const res = await post({
      submissionId: 'sub-1',
      revision: 999,
      documentText: 'a guess at the wording',
    });
    expect(res.status).toBe(403);
    expect(await res.text()).not.toMatch(/changed while this was open/i);
  });

  it('refuses a caller with no session', async () => {
    currentUser = null;
    const res = await post({ submissionId: 'sub-1', revision: 3, documentText: WORDING });
    expect(res.status).toBe(401);
  });

  it('says so in words when there is nothing to render', async () => {
    renderSubmissionPreview.mockResolvedValueOnce(null as unknown as Uint8Array);
    const res = await post({ submissionId: 'sub-1', revision: 3, documentText: WORDING });
    expect(res.status).toBe(400);
    // A blank frame on an approvals screen reads as "the document is empty".
    expect((await res.text()).trim().length).toBeGreaterThan(10);
  });
});

describe('the preview draws the delivery that approving would actually perform', () => {
  const base = {
    documentText: WORDING,
    templateName: 'Mutual NDA',
    firmName: 'A Firm',
    accent: '#123456',
    letterheadUrl: null,
    letterheadDesign: undefined as never,
    logoUrl: null,
    layout: {} as never,
  };
  const mark = new Uint8Array([1, 2, 3]);

  it('matches the signature dispatch: no mark drawn, state signed', () => {
    // lib/submission-document.ts files the instrument with no mark on it; the
    // counterparty's values and marks are stamped onto those bytes later.
    const input = submissionPreviewInput({ ...base, markBytes: null, mode: 'signature' });
    expect(input.signatureImage).toBeUndefined();
    expect(input.state).toBe('signed');
  });

  it('draws no mark in signature mode even when the submission has one', () => {
    // The row usually carries a mark, and the caller of this function happens
    // not to load it for a signature dispatch. The rule has to hold here too,
    // or it is only ever enforced by its caller remembering to. This is the
    // case the first version of this test missed, and a mutation that deleted
    // the mode check passed because of it.
    const input = submissionPreviewInput({ ...base, markBytes: mark, mode: 'signature' });
    expect(input.signatureImage).toBeUndefined();
    expect(input.state).toBe('signed');
  });

  it('matches the share delivery: the mark drawn, state copy', () => {
    const input = submissionPreviewInput({ ...base, markBytes: mark, mode: 'share' });
    expect(input.signatureImage).toEqual({ png: mark });
    expect(input.state).toBe('copy');
  });

  it('calls an unsigned share unsigned rather than a copy', () => {
    const input = submissionPreviewInput({ ...base, markBytes: null, mode: 'share' });
    expect(input.signatureImage).toBeUndefined();
    expect(input.state).toBe('unsigned');
  });

  it('never draws a DRAFT mark over the artifact that is going out', () => {
    for (const mode of ['share', 'signature'] as const) {
      for (const markBytes of [null, mark]) {
        expect(submissionPreviewInput({ ...base, markBytes, mode }).state).not.toBe('draft');
      }
    }
  });

  it('takes the wording and the title from the record, not from anywhere else', () => {
    const input = submissionPreviewInput({ ...base, markBytes: null, mode: 'share' });
    expect(input.document).toBe(WORDING);
    expect(input.title).toBe('Mutual NDA');
    expect(input.brandName).toBe('A Firm');
  });
});
