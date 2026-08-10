import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { FirmContext, FirmRole } from '../lib/firm-types';
import type { BrandedDocumentInput } from '../lib/branded-document-pdf';
import type { FieldBox } from '../lib/template-field-boxes';

/**
 * The PDF renderer, as the second way out of the building.
 *
 * lib/template-release.ts is the only code that MAILS an employee's filled
 * template, but it was never the only way one could leave: the branded PDF
 * route handed a finished, letterheaded document to any signed-in caller who
 * posted some text at it, and a file in an employee's hands is a file they can
 * forward. The employee page hiding its Download button did nothing about
 * that, because a hidden control is not a gate.
 *
 * The rule itself is a pure function and is tested against every role in
 * tests/template-approval.test.ts. This file covers the route in two ways, and
 * the difference between them matters.
 *
 * The last two blocks RUN the route, once per branch. Everything the handler
 * needs is stubbed except the gate, which is loaded for real, and the
 * assertions are about what the caller gets back and whether a PDF was built
 * at all. That is the only kind of assertion that can fail when the gate is
 * asked and its answer then ignored, which is the one way this could break
 * while looking correct: an earlier version of this file asserted that the
 * gate was CALLED, and deleting the line that acted on its answer left the
 * suite green.
 *
 * The first blocks read the route and the fill page as text. What is left
 * there is what no single request can show: that document content is never
 * read from the body anywhere in the employee branch, whatever a request
 * happens to send, and that the fill page offers no preview button for a gated
 * template. They are a floor under the behavioural tests, not a substitute.
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const ROUTE = read('../app/api/counsel/draft-template/pdf/route.ts');
const FILL = read('../app/portal/forms/[id]/form-fill-client.tsx');

describe('the branded PDF route', () => {
  it('asks the approval gate before rendering a named template', () => {
    expect(ROUTE).toMatch(/canRenderFilledTemplate\(/);
    expect(ROUTE).toMatch(/requiresApproval:\s*template\.requiresApproval/);
    // The role is resolved from the caller's own membership, never taken from
    // the request body.
    expect(ROUTE).toMatch(/role:\s*await callerFirmRole\(firmId\)/);
  });

  it('builds the employee document from the firm template, not from the request', () => {
    // The renderTemplate branch must never read body.document: if it did, a
    // caller could post a gated template's text under an ungated template's
    // id and the gate would pass on the wrong document.
    const branch = ROUTE.slice(
      ROUTE.indexOf('async function renderTemplate'),
      ROUTE.indexOf('async function renderFreeText'),
    );
    expect(branch.length).toBeGreaterThan(0);
    // No property read of `document` off anything, and no `document` on the
    // parameter type either, however the read is spelled or cast.
    expect(branch).not.toMatch(/\.document\b/);
    expect(branch).not.toMatch(/document\s*\?\s*:/);
    expect(branch).toMatch(/mergeTemplateDocument\(/);
    expect(branch).toMatch(/body:\s*template\.body/);
  });

  it('refuses free-text rendering to anyone who is not a firm member', () => {
    // Being signed in used to be the whole check. The counsel studios draft
    // their own text, which is theirs to draft; nobody else may.
    const branch = ROUTE.slice(ROUTE.indexOf('async function renderFreeText'));
    expect(branch).toMatch(/getActiveFirmContext\(\)/);
    expect(branch).toMatch(/if \(!ctx\) return \{ error:/);
  });
});

describe('the employee fill page', () => {
  it('sends the template identity and its values, never a finished document', () => {
    const build = FILL.slice(FILL.indexOf('const buildPdf'), FILL.indexOf('const sendForReview'));
    expect(build).toMatch(/templateId: template\.id/);
    expect(build).not.toMatch(/document:\s*merged/);
  });

  it('offers no PDF preview for a template that needs review', () => {
    // The preview dialog carries Print, Download, and Open in a new tab, so
    // opening it for a gated template is a send.
    expect(FILL).toMatch(/\{!needsApproval && \(\s*<button/);
  });
});

/*
 * The route, run.
 *
 * Everything the handler reaches for is stubbed except lib/template-approval,
 * which is the thing under test and is loaded for real, and lib/firm-authz,
 * which is loaded for real so the gate reads the real list of roles that may
 * release a document. What varies between the cases below is only the two
 * inputs the gate takes: whether the template requires approval, and what the
 * caller's own firm role is.
 *
 * The assertion that carries the weight is that no PDF is produced. A route
 * that asks the gate and then renders anyway would satisfy any check that the
 * gate was called; it cannot satisfy this one.
 */

let currentUser: { id: string; email: string } | null = null;
let currentRole: FirmRole | null = null;
let requiresApproval = true;
/** The template's own delivery mode, which the route has to pass on. */
let templateDeliveryMode = 'share';
/**
 * The caller's active firm, in the shape getActiveFirmContext actually
 * returns.
 *
 * This used to be `{ firmId: 'firm-1' }`, which is not a FirmContext and has
 * no `firm` on it at all. Nothing caught that, because a stub is only ever
 * checked against what the code under test happened to read at the time, and
 * the route only read the context for truthiness. It stopped being harmless
 * the moment the route reached into `ctx.firm`: the honest line failed against
 * the fake, and the fix that presents itself at that point is to weaken the
 * route to `ctx.firm?.metadata`, which puts a type hole in production code so
 * a test double can keep lying. Typed as FirmContext instead, so the compiler
 * is the thing that keeps this fake honest.
 */
let activeFirm: FirmContext | null = null;

function firmContext(metadata: Record<string, unknown> = {}): FirmContext {
  return {
    firm: {
      id: 'firm-1',
      slug: 'a-firm',
      name: 'A Firm',
      firmType: 'firm',
      metadata,
      logoUrl: null,
      letterheadUrl: null,
      accentColor: '#0f2d24',
      jurisdictions: [],
      practiceAreas: [],
      subdomainEnabled: false,
      createdBy: 'someone-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    membership: {
      id: 'member-1',
      firmId: 'firm-1',
      userId: 'someone-1',
      role: 'attorney',
      displayName: null,
      email: 'someone@example.test',
      joinedAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

const TEMPLATE_BODY = 'The parties agree to keep this confidential.';

// Declared with the renderer's real parameter type, for the same reason the
// context above is a real FirmContext: a double that takes `()` records its
// calls as an empty tuple, so nothing can ever assert on WHAT the route sent
// it, only that it sent something.
const buildBrandedDocumentPdf = vi.fn(async (_input: BrandedDocumentInput) => ({
  bytes: new Uint8Array([1, 2, 3]),
  fieldBoxes: [] as FieldBox[],
}));

vi.mock('../lib/supabase/server', () => ({
  getCurrentUser: async () => currentUser,
  isSupabaseConfigured: () => true,
}));
/**
 * A spy, not a stub, because one of the cases below is about a branch that
 * must never reach the database at all. The service-role client is the only
 * way any write in this codebase happens, so "never asked for one" is a
 * checkable statement of "wrote nothing".
 */
const createAdminSupabase = vi.fn(() => ({}));
vi.mock('../lib/supabase/admin', () => ({ createAdminSupabase }));
// Loaded for real so FIRM_MANAGE_ROLES stays the real role list; only the
// lookup that hits the database is replaced.
vi.mock('../lib/firm-authz', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callerFirmRole: async () => currentRole,
}));
vi.mock('../lib/portal-entitlements', () => ({
  authorizeFirmActor: async () => ({ ok: true }),
}));
/**
 * The firm record, which is where a document's IDENTITY comes from on every
 * branch but the free-text one. Mutable so a case can give the firm a
 * letterhead of its own and then check whose letterhead reached the renderer.
 */
let firmRecord: Record<string, unknown> = { name: 'A Firm' };

vi.mock('../lib/firm-storage', () => ({
  getFirmByIdAdmin: async () => firmRecord,
  getActiveFirmContext: async () => activeFirm,
}));
vi.mock('../lib/branded-document-pdf', () => ({ buildBrandedDocumentPdf }));
vi.mock('../lib/template-fill', () => ({
  loadPublishedTemplate: async () => ({
    id: 'tpl-1',
    firmId: 'firm-1',
    name: 'Mutual NDA',
    body: TEMPLATE_BODY,
    fields: [],
    status: 'published',
    requiresApproval,
    deliveryMode: templateDeliveryMode,
  }),
  sanitizeTemplateValues: () => ({}),
}));
/** Every input the route handed the merge, so the last one can be inspected. */
const mergeTemplateDocument = vi.fn((input: Record<string, unknown>) => {
  void input;
  return TEMPLATE_BODY;
});

vi.mock('../lib/firm-template-placeholders', async (importOriginal) => ({
  // The real module first, so TEMPLATE_BODY_MAX is the number the SAVE path
  // truncates to rather than a number this file made up. A preview capped at
  // a different length would show a page that cannot be saved.
  ...(await importOriginal<Record<string, unknown>>()),
  formatSignedOn: () => '1 January 2026',
  // The real merge is tested elsewhere. Here it stands in for "the firm's own
  // template", so an assertion on what reached the renderer can tell that
  // apart from anything the request sent.
  mergeTemplateDocument,
}));

const { POST } = await import('../app/api/counsel/draft-template/pdf/route');

/**
 * The real cap, taken past the mock above. A number written out here instead
 * would pass while the save truncated somewhere else entirely, which is the
 * one thing the truncation case is for.
 */
const { TEMPLATE_BODY_MAX } = await vi.importActual<
  typeof import('../lib/firm-template-placeholders')
>('../lib/firm-template-placeholders');

const post = (body: Record<string, unknown>) =>
  POST({ json: async () => body } as unknown as NextRequest);

const FILL_A_GATED_TEMPLATE = {
  templateId: 'tpl-1',
  firmId: 'firm-1',
  values: { name: 'A Colleague' },
  signatureName: 'A Colleague',
};

describe('POST /api/counsel/draft-template/pdf, driven', () => {
  beforeEach(() => {
    currentUser = { id: 'employee-1', email: 'employee@example.test' };
    currentRole = 'staff';
    requiresApproval = true;
    activeFirm = null;
    buildBrandedDocumentPdf.mockClear();
    mergeTemplateDocument.mockClear();
    templateDeliveryMode = 'share';
  });

  it('refuses a gated template to an employee, and renders nothing', async () => {
    const res = await post(FILL_A_GATED_TEMPLATE);
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Type')).not.toBe('application/pdf');
    expect(buildBrandedDocumentPdf).not.toHaveBeenCalled();
    // The caller is told what to do next, not just refused.
    await expect(res.text()).resolves.toMatch(/send it for review/i);
  });

  it('refuses a gated template to a paralegal, who cannot release one either', async () => {
    currentRole = 'paralegal';
    const res = await post(FILL_A_GATED_TEMPLATE);
    expect(res.status).toBe(403);
    expect(buildBrandedDocumentPdf).not.toHaveBeenCalled();
  });

  it('refuses a gated template when the caller holds no role at this firm', async () => {
    currentRole = null;
    const res = await post(FILL_A_GATED_TEMPLATE);
    expect(res.status).toBe(403);
    expect(buildBrandedDocumentPdf).not.toHaveBeenCalled();
  });

  it('renders a gated template for someone who could release it', async () => {
    // Without this the refusals above would also pass on a route that refused
    // every template, which would be a broken feature rather than a gate.
    currentRole = 'attorney';
    const res = await post(FILL_A_GATED_TEMPLATE);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(buildBrandedDocumentPdf).toHaveBeenCalledTimes(1);
  });

  it('renders an ungated template for an employee', async () => {
    requiresApproval = false;
    const res = await post(FILL_A_GATED_TEMPLATE);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(buildBrandedDocumentPdf).toHaveBeenCalledTimes(1);
  });

  it('renders the firm template, not the text the request carried', async () => {
    requiresApproval = false;
    const res = await post({
      ...FILL_A_GATED_TEMPLATE,
      document: 'Text the employee wrote for themselves.',
      title: 'A title of their choosing',
    });
    expect(res.status).toBe(200);
    expect(buildBrandedDocumentPdf).toHaveBeenCalledWith(
      expect.objectContaining({ document: TEMPLATE_BODY, title: 'Mutual NDA' }),
    );
  });
});

describe('POST /api/counsel/draft-template/pdf, free text, driven', () => {
  // No templateId, so this is the counsel studios drafting their own letter.
  // The document is theirs to write; the check is that they are a firm member
  // at all, which being signed in used to satisfy on its own.
  const draft = { document: 'Dear Sir or Madam,', title: 'A letter' };

  beforeEach(() => {
    currentUser = { id: 'someone-1', email: 'someone@example.test' };
    currentRole = null;
    activeFirm = null;
    buildBrandedDocumentPdf.mockClear();
  });

  it('refuses a signed-in caller who has no firm', async () => {
    const res = await post(draft);
    expect(res.status).toBe(403);
    expect(buildBrandedDocumentPdf).not.toHaveBeenCalled();
  });

  it('renders for a member of a firm', async () => {
    activeFirm = firmContext();
    const res = await post(draft);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(buildBrandedDocumentPdf).toHaveBeenCalledTimes(1);
  });

  it('takes the designed letterhead from the active firm, never from the body', async () => {
    // The body is the studio's draft text, which is theirs to write. The
    // DESIGN is the firm's identity and is read off the active firm, which is
    // what this pins. Note what it does not pin: letterheadUrl and logoUrl on
    // the same call still come from the body, and the image outranks the
    // design, so a caller can still suppress a firm's designed letterhead on
    // this route by posting any URL. That hole predates the design and is
    // tracked separately; this assertion must not be read as covering it.
    activeFirm = firmContext({
      letterhead_design: { firmName: 'Hartley and Vance LLP' },
    });
    await post({
      ...draft,
      letterheadDesign: { firmName: 'Somebody Else LLP' },
    });
    expect(buildBrandedDocumentPdf).toHaveBeenCalledTimes(1);
    expect(buildBrandedDocumentPdf.mock.calls[0][0].letterheadDesign).toMatchObject({
      firmName: 'Hartley and Vance LLP',
    });
  });
});

/**
 * The third caller of mergeTemplateDocument, which is why deliveryMode is a
 * required input rather than an inference.
 *
 * The counterparty branch used to key off counterpartyName, defended with
 * "counterpartyName is the mode". That holds for the two callers that compute
 * the name through counterpartyLabel. It is false here: this route renders a
 * template for a firm member with NOBODY addressed, so the name is null
 * whatever the mode, and every template exported through it lost its
 * recipient's blank. An invariant satisfied at two of three call sites is not
 * enforced.
 *
 * Asserted on what the route PASSED rather than on the presence of a call. A
 * required argument makes the omission a compile error; only this makes
 * passing the wrong one a failing test.
 */
describe('the route states the template mode it is rendering', () => {
  const RENDERABLE = {
    templateId: 'tpl-1',
    firmId: 'firm-1',
    values: {},
    signatureName: 'A Colleague',
  };

  beforeEach(() => {
    mergeTemplateDocument.mockClear();
    currentUser = { id: 'attorney-1', email: 'legal@example.test' };
    currentRole = 'attorney';
    requiresApproval = false;
  });

  for (const mode of ['share', 'signature']) {
    it(`passes ${mode} through from the template`, async () => {
      templateDeliveryMode = mode;
      await post(RENDERABLE);
      expect(mergeTemplateDocument).toHaveBeenCalledTimes(1);
      expect(mergeTemplateDocument.mock.calls[0][0]).toMatchObject({ deliveryMode: mode });
    });
  }
});

/*
 * TEMPLATE-DRAFT MODE: the editor previewing something that has never been
 * saved.
 *
 * The draft body is the caller's own unsaved work and has to come from the
 * request; there is nowhere else it could come from. That makes two questions
 * load-bearing, and they are the two this block asks.
 *
 * WHO. Rendering a draft hands back a finished PDF on the firm's letterhead,
 * so the set who may ask for one has to be the set who may save one. The role
 * is read off the caller's own membership and checked against
 * FIRM_TEMPLATE_AUTHOR_ROLES, which lib/firm-templates.ts also gates its writes
 * on. lib/firm-authz is loaded for real here so that list is the real list.
 *
 * WHAT ELSE THE REQUEST GETS TO DECIDE, which is nothing. The identity of the
 * document, its letterhead and its page defaults are read off the firm record.
 * The free-text branch above still takes letterheadUrl and logoUrl from the
 * body, and a case below posts both to make sure this branch does not.
 */
describe('POST /api/counsel/draft-template/pdf, an unsaved template draft', () => {
  const DRAFT = {
    firmId: 'firm-1',
    draftTemplate: {
      name: 'Mutual NDA',
      body: 'The parties agree to keep {{topic}} confidential.',
      fields: [{ key: 'topic', label: 'Topic', type: 'text', required: true }],
      deliveryMode: 'share',
      documentLayout: null,
    },
  };

  beforeEach(() => {
    currentUser = { id: 'author-1', email: 'author@example.test' };
    currentRole = 'attorney';
    activeFirm = null;
    firmRecord = { name: 'A Firm' };
    buildBrandedDocumentPdf.mockClear();
    mergeTemplateDocument.mockClear();
    createAdminSupabase.mockClear();
  });

  it('refuses a signed-in caller who holds no role at this firm, and renders nothing', async () => {
    currentRole = null;
    const res = await post(DRAFT);
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Type')).not.toBe('application/pdf');
    expect(buildBrandedDocumentPdf).not.toHaveBeenCalled();
  });

  it('refuses staff, who cannot save a template either', async () => {
    currentRole = 'staff';
    const res = await post(DRAFT);
    expect(res.status).toBe(403);
    expect(buildBrandedDocumentPdf).not.toHaveBeenCalled();
  });

  for (const role of ['owner', 'admin', 'attorney', 'paralegal'] as const) {
    it(`renders for ${role}, who can save one`, async () => {
      // Without these the refusals above would also pass on a route that
      // refused everybody, which is a broken feature rather than a gate.
      currentRole = role;
      const res = await post(DRAFT);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
      expect(buildBrandedDocumentPdf).toHaveBeenCalledTimes(1);
    });
  }

  it('refuses an empty draft rather than returning an empty page', async () => {
    const res = await post({ ...DRAFT, draftTemplate: { ...DRAFT.draftTemplate, body: '   ' } });
    expect(res.status).toBe(400);
    expect(buildBrandedDocumentPdf).not.toHaveBeenCalled();
  });

  it('takes the letterhead and the logo from the firm, never from the body', async () => {
    firmRecord = {
      name: 'A Firm',
      letterheadUrl: 'https://cdn.example.test/a-firm.png',
      logoUrl: 'https://cdn.example.test/a-firm-logo.png',
      accentColor: '#0f2d24',
    };
    const res = await post({
      ...DRAFT,
      letterheadUrl: 'https://elsewhere.example.test/someone-elses-banner.png',
      logoUrl: 'https://elsewhere.example.test/someone-elses-logo.png',
      brandName: 'Someone Else LLP',
      accent: '#ff0000',
    });
    expect(res.status).toBe(200);
    const input = buildBrandedDocumentPdf.mock.calls[0][0];
    expect(input.letterheadUrl).toBe('https://cdn.example.test/a-firm.png');
    expect(input.logoUrl).toBe('https://cdn.example.test/a-firm-logo.png');
    expect(input.brandName).toBe('A Firm');
    expect(input.accent).toBe('#0f2d24');
  });

  it('renders the draft unsigned, which is what it is', async () => {
    await post(DRAFT);
    expect(buildBrandedDocumentPdf.mock.calls[0][0].state).toBe('unsigned');
  });

  it('lays the draft out on the firm layout with this template’s override on top', async () => {
    firmRecord = {
      name: 'A Firm',
      metadata: { document_layout: { margins: { topPt: 90 } } },
    };
    await post({
      ...DRAFT,
      draftTemplate: {
        ...DRAFT.draftTemplate,
        documentLayout: { footer: { show: false } },
      },
    });
    const layout = buildBrandedDocumentPdf.mock.calls[0][0].layout;
    // The band the template took over.
    expect(layout?.footer.show).toBe(false);
    // And the band it left alone, which still follows the firm.
    expect(layout?.margins.topPt).toBe(90);
  });

  for (const mode of ['share', 'signature']) {
    it(`passes the draft's ${mode} mode to the merge`, async () => {
      // The mode decides whether a counterparty field is a blank at all, so a
      // preview that guessed it would show a different document from the one
      // this template will produce.
      await post({
        ...DRAFT,
        draftTemplate: { ...DRAFT.draftTemplate, deliveryMode: mode },
      });
      expect(mergeTemplateDocument.mock.calls[0][0]).toMatchObject({ deliveryMode: mode });
    });
  }

  it('merges with no answers and no signer, because nobody has filled it in', async () => {
    await post(DRAFT);
    const merged = mergeTemplateDocument.mock.calls[0][0];
    expect(merged).toMatchObject({ signatureName: '', signerEmail: '' });
    // toEqual, not toMatchObject: an empty object is a subset of EVERY object,
    // so `toMatchObject({ values: {} })` passes for a preview that invented an
    // answer. It did, until a mutation that put a value in there stayed green.
    expect(merged.values).toEqual({});
  });

  it('truncates the body to the length the save would store', async () => {
    const over = 'x'.repeat(TEMPLATE_BODY_MAX + 500);
    await post({ ...DRAFT, draftTemplate: { ...DRAFT.draftTemplate, body: over } });
    const merged = mergeTemplateDocument.mock.calls[0][0] as { body: string };
    expect(merged.body).toHaveLength(TEMPLATE_BODY_MAX);
  });

  it('never asks for the service-role client, so a preview cannot write', async () => {
    // The only way anything in this codebase writes past RLS. A preview that
    // moved a template, a submission, or the revision an approval is pinned to
    // would have to come through here first.
    await post(DRAFT);
    expect(buildBrandedDocumentPdf).toHaveBeenCalledTimes(1);
    expect(createAdminSupabase).not.toHaveBeenCalled();
  });

  it('reads no table and writes none, in the branch itself', () => {
    // The behavioural check above covers the route as it runs. This covers
    // what a future edit could add to the branch without any request showing
    // it: a PostgREST call of any kind, on any client.
    // The anchor first. renderTemplateDraft is the LAST function in the
    // route, so a rename made indexOf return -1, slice(-1) return the file's
    // final character, and all six assertions below pass against it. A length
    // floor of zero did not help: one character is greater than zero. Every
    // assertion after this point is negative, which is precisely the shape
    // that cannot notice it is looking at nothing.
    const at = ROUTE.indexOf('async function renderTemplateDraft');
    expect(
      at,
      'renderTemplateDraft is no longer in this route; this guard was measuring the file\'s last character',
    ).toBeGreaterThan(-1);
    const branch = ROUTE.slice(at);
    expect(branch.length).toBeGreaterThan(200);
    // Two positives from opposite ends of the function, so the slice is
    // known to hold the whole branch and not a fragment of one.
    expect(branch).toContain('callerFirmRole(firmId)');
    expect(branch).toContain('mergeTemplateDocument(');
    // Written without the opening parenthesis on purpose: `.from?.(` is the
    // same call and would slip past `.from(`. createAdminSupabase leads the
    // list because it is the door, and everything else is what comes through
    // it. None of these appears in prose in this branch.
    for (const write of [
      'createAdminSupabase',
      '.from',
      '.insert',
      '.update',
      '.upsert',
      '.delete',
    ]) {
      expect(branch).not.toContain(write);
    }
  });
});
