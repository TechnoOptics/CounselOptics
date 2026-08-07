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
vi.mock('../lib/supabase/admin', () => ({ createAdminSupabase: () => ({}) }));
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
  }),
  sanitizeTemplateValues: () => ({}),
}));
vi.mock('../lib/firm-template-placeholders', () => ({
  formatSignedOn: () => '1 January 2026',
  // The real merge is tested elsewhere. Here it stands in for "the firm's own
  // template", so an assertion on what reached the renderer can tell that
  // apart from anything the request sent.
  mergeTemplateDocument: () => TEMPLATE_BODY,
}));

const { POST } = await import('../app/api/counsel/draft-template/pdf/route');

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
    // letterhead is the firm's identity, and reading it from the request would
    // let any member of any firm render a document on someone else's
    // stationery. Now that the stub is a real FirmContext, that distinction is
    // something a test can actually see.
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
