import { type NextRequest } from 'next/server';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getActiveFirmContext, getFirmByIdAdmin } from '@/lib/firm-storage';
import { callerFirmRole, FIRM_TEMPLATE_AUTHOR_ROLES } from '@/lib/firm-authz';
import { authorizeFirmActor } from '@/lib/portal-entitlements';
import { buildBrandedDocumentPdf } from '@/lib/branded-document-pdf';
import { firmLetterheadDesign } from '@/lib/letterhead-design';
import {
  firmDocumentLayoutInput,
  resolveDocumentLayout,
  sanitizeDocumentLayoutOverride,
} from '@/lib/document-layout';
import { canRenderFilledTemplate } from '@/lib/template-approval';
import { loadPublishedTemplate, sanitizeTemplateValues } from '@/lib/template-fill';
import { parseTemplateFields } from '@/lib/counterparty-fields';
import { parseDeliveryMode } from '@/lib/submission-dispatch';
import {
  formatSignedOn,
  mergeTemplateDocument,
  TEMPLATE_BODY_MAX,
} from '@/lib/firm-template-placeholders';
import { decodeSignaturePng } from '@/lib/template-signature';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The firm-branded PDF renderer, for two callers with two different trust
 * levels.
 *
 * It used to take any text from any signed-in user and hand back a finished,
 * letterheaded PDF. That made the approval gate on employee templates
 * decorative: the employee page hid its Download and Print buttons for a gated
 * template, but the document was still one fetch away, and a file in their
 * hands is a file they can forward. A gate that only hides a button is not a
 * gate.
 *
 * So there are three modes now, chosen by what the body names:
 *
 *   Template-draft mode (draftTemplate + firmId). The template editor, showing
 *   an author the page their template becomes before they save it. The draft
 *   is the caller's own unsaved work, so it comes from the body; the gate is
 *   the role list that may save that draft.
 *
 *   Employee mode (templateId + firmId). The server loads the firm's own
 *   published template and merges it with the submitted values itself; the
 *   `document` field in the body is ignored entirely, so a caller cannot pass
 *   off one template's text under another template's id. If that template
 *   requires approval, the render is refused for anyone who could not release
 *   the document anyway.
 *
 *   Counsel mode (no templateId). The letter and template studios draft free
 *   text, which is theirs to draft. The caller must be a member of their
 *   active firm.
 *
 * A signed-in user who is neither gets nothing, which is the change: being
 * signed in is no longer sufficient on its own.
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return new Response('Not available.', { status: 400 });
  }
  const user = await getCurrentUser();
  if (!user) return new Response('Sign in first.', { status: 401 });

  let body: {
    document?: string;
    title?: string;
    brandName?: string;
    firmName?: string;
    accent?: string;
    /** Optional public URL of the firm's letterhead image (PNG/JPG/
     *  WebP). Painted across the top of page 1 in place of the text-
     *  only "BRAND NAME" + title strip. Tier-2 Bella branding. */
    letterheadUrl?: string;
    /** Optional public URL of the firm's logo. When no letterhead is
     *  set, Advottic synthesizes a letterhead from the logo + brand
     *  name (#13 "Advottic can customize one using their logo"). */
    logoUrl?: string;
    /** Employee mode: render this firm's published template, server-side. */
    templateId?: string;
    firmId?: string;
    values?: Record<string, string>;
    signatureName?: string;
    /** Employee mode: the mark the employee drew, typed or uploaded. */
    signatureDataUrl?: string;
    /** Template-draft mode: an unsaved template, as the editor holds it. */
    draftTemplate?: {
      name?: string;
      body?: string;
      fields?: unknown;
      deliveryMode?: string;
      documentLayout?: unknown;
    };
  };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid body.', { status: 400 });
  }

  const templateId = String(body.templateId ?? '').trim();
  const firmId = String(body.firmId ?? '').trim();

  const draftTemplate = body.draftTemplate;
  const rendered = draftTemplate
    ? await renderTemplateDraft(firmId, draftTemplate)
    : templateId
      ? await renderTemplate(user.id, user.email ?? '', firmId, templateId, body)
      : await renderFreeText(body);
  if ('error' in rendered) {
    return new Response(rendered.error, { status: rendered.status });
  }

  // The recorded counterparty blanks are deliberately dropped here. This
  // route is the legal team's own preview of a draft, not the instrument that
  // goes out: the bytes it returns are never stored, never hashed into the
  // audit chain, and never served to a signer, so there is nothing for a
  // recorded geometry to belong to. lib/submission-document.ts is the render
  // whose boxes are kept.
  const rendering = await buildBrandedDocumentPdf(rendered.input);
  if (!rendering) return new Response('Nothing to export.', { status: 400 });
  const bytes = rendering.bytes;

  const safe =
    rendered.input.title.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '') || 'document';
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safe}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}

type DocumentInput = Parameters<typeof buildBrandedDocumentPdf>[0] & { title: string };
type Rendered = { input: DocumentInput } | { error: string; status: number };

/**
 * Employee mode. Nothing the caller sent is used as document content: the body
 * comes from the firm's stored template, the brand comes from the firm record,
 * and only the field values and the typed signature are the caller's, trimmed
 * to the fields the firm actually declared.
 */
async function renderTemplate(
  userId: string,
  userEmail: string,
  firmId: string,
  templateId: string,
  body: {
    values?: Record<string, string>;
    signatureName?: string;
    signatureDataUrl?: string;
  },
): Promise<Rendered> {
  const admin = createAdminSupabase();
  if (!admin) return { error: 'Not available.', status: 400 };

  const actor = await authorizeFirmActor(admin, firmId, userId, 'requests.view');
  if (!actor.ok) return { error: 'You do not have access to this form.', status: 403 };

  const template = await loadPublishedTemplate(admin, firmId, templateId);
  if (!template) return { error: 'That form is no longer available.', status: 404 };

  const gate = canRenderFilledTemplate({
    requiresApproval: template.requiresApproval,
    role: await callerFirmRole(firmId),
  });
  if (!gate.ok) return { error: gate.reason, status: 403 };

  // The mark is the caller's to supply, exactly as their typed name already
  // is: it is their own signature, not document content. Nothing about the
  // document body comes from the request, so this does not widen the trust
  // model. A mark that fails validation renders the document without one
  // rather than failing the request, because the printed name is a valid
  // signature on its own and refusing the export would be the worse outcome.
  const decoded = decodeSignaturePng(body.signatureDataUrl);

  const firm = await getFirmByIdAdmin(firmId);
  const document = mergeTemplateDocument({
    body: template.body,
    fields: template.fields,
    // The mode this template is set to. Required, and this route is why: it
    // renders for a firm member with nobody addressed, so a signature-mode
    // template has no counterparty NAME here and must still carry the
    // recipient's blank.
    deliveryMode: template.deliveryMode,
    values: sanitizeTemplateValues(template.fields, body.values),
    firmName: firm?.name ?? 'the company',
    signatureName: String(body.signatureName ?? '').trim().slice(0, 120),
    signerEmail: userEmail,
    signedOn: formatSignedOn(new Date()),
  });
  return {
    input: {
      document,
      title: template.name.slice(0, 120),
      brandName: firm?.name ?? undefined,
      accent: firm?.accentColor ?? undefined,
      letterheadUrl: firm?.letterheadUrl ?? undefined,
      letterheadDesign: firmLetterheadDesign(firm?.metadata),
      logoUrl: firm?.logoUrl ?? undefined,
      signatureImage: decoded.ok ? { png: decoded.bytes } : undefined,
      // The firm's layout with this template's partial override on top, which
      // is the same resolution lib/submission-document.ts runs, so the employee
      // previews the page they will actually be sending.
      layout: resolveDocumentLayout(
        firmDocumentLayoutInput(firm?.metadata),
        template.documentLayout,
      ),
      // THIS is where a DRAFT mark belongs. The bytes are never stored, never
      // hashed into the audit chain and never served to a signer, so a mark
      // drawn here can be gone from the next render, which is the property the
      // stored instrument does not have. Signed the moment the employee has
      // made their mark, because at that point the document is not a draft.
      state: decoded.ok ? 'signed' : 'unsigned',
    },
  };
}

/** Counsel mode: the letter and template studios, drafting their own text. */
async function renderFreeText(body: {
  document?: string;
  title?: string;
  brandName?: string;
  firmName?: string;
  accent?: string;
  letterheadUrl?: string;
  logoUrl?: string;
}): Promise<Rendered> {
  const ctx = await getActiveFirmContext();
  if (!ctx) return { error: 'You do not have access to this.', status: 403 };
  return {
    input: {
      document: String(body.document ?? ''),
      title: String(body.title ?? 'Document').slice(0, 120),
      brandName: body.brandName ?? body.firmName,
      accent: body.accent,
      // PRE-EXISTING AND NOT CLOSED: this URL, and logoUrl below, come from
      // the request body. They predate the design and are left alone here, but
      // do not read the next comment as covering them. The image OUTRANKS the
      // design in the renderer, so a caller who posts any letterheadUrl
      // suppresses their firm's designed letterhead for that render, and a
      // caller who posts a reachable image renders this firm's document under
      // someone else's banner. It is a preview route whose bytes are never
      // stored, hashed or served to a signer, which is why it has survived,
      // not a reason it is fine.
      letterheadUrl: body.letterheadUrl,
      // The DESIGN is read off the caller's own active firm rather than the
      // body, so this one field cannot be dictated by the request. That is the
      // whole of what this line claims; see above for what still can be.
      letterheadDesign: firmLetterheadDesign(ctx.firm.metadata),
      logoUrl: body.logoUrl,
      // Read off the caller's own active firm rather than the body, exactly as
      // the design above is, so this one cannot be dictated by the request
      // either. No template override: there is no template here, only text the
      // legal team is drafting.
      layout: resolveDocumentLayout(firmDocumentLayoutInput(ctx.firm.metadata), null),
      // A studio draft is a draft. Nothing has been signed and nothing is
      // stored, so if the firm has switched the watermark on this is where it
      // says DRAFT.
      state: 'unsigned',
    },
  };
}

/**
 * Template-draft mode: the editor at /counsel/forms, showing an author the
 * page their template becomes before they press Save.
 *
 * WHY THE DRAFT COMES FROM THE BODY. It has never been stored. There is no
 * row to load it from, and the author is asking what the words on their screen
 * will look like, so any other source would be a preview of a different
 * document. What does NOT come from the body is the firm's identity: the name,
 * the accent, the letterhead image, the designed letterhead, the logo and the
 * firm's own page layout are all read off the firm record, which closes on
 * this mode the hole renderFreeText documents above.
 *
 * WHY IT IS THE SAME PAGE. mergeTemplateDocument, buildBrandedDocumentPdf and
 * the firm-plus-template layout resolution below are the three the filed
 * instrument goes through (lib/template-submissions.ts and
 * lib/submission-document.ts). Nothing here lays out a document of its own.
 * The body and the fields are put through the same truncation and the same
 * field rule the save applies, so this is the template as it would be STORED
 * rather than as it happens to be typed.
 *
 * TWO THINGS DIFFER, AND THE EDITOR SAYS SO ON SCREEN. Nobody has answered the
 * blanks yet, so they render as their bracketed labels, and nobody has signed,
 * so this renders 'unsigned' and carries whatever the firm shows on an
 * unsigned page. Both are properties of a template rather than of a document,
 * and neither can be resolved before a colleague fills one in.
 *
 * NOTHING IS WRITTEN. This reads the firm record and renders. It cannot move a
 * template, a submission, or the revision an approval is pinned to.
 */
async function renderTemplateDraft(
  firmId: string,
  draft: {
    name?: string;
    body?: string;
    fields?: unknown;
    deliveryMode?: string;
    documentLayout?: unknown;
  },
): Promise<Rendered> {
  // The roles that may SAVE this draft, and no wider. Read from the caller's
  // own membership row, never from the request.
  const role = await callerFirmRole(firmId);
  if (!role || !FIRM_TEMPLATE_AUTHOR_ROLES.includes(role)) {
    return { error: 'You do not have access to this firm’s templates.', status: 403 };
  }

  const documentBody = String(draft.body ?? '').trim().slice(0, TEMPLATE_BODY_MAX);
  if (!documentBody) return { error: 'There is nothing to preview yet.', status: 400 };

  const firm = await getFirmByIdAdmin(firmId);
  const document = mergeTemplateDocument({
    body: documentBody,
    // The READ-side field rule, which is how these fields will be read back
    // out of the jsonb once they are saved. A field the editor cannot produce
    // is dropped rather than repaired.
    fields: parseTemplateFields(draft.fields),
    deliveryMode: parseDeliveryMode(draft.deliveryMode),
    // Nobody has filled anything in. Every declared blank therefore renders as
    // its bracketed label, which is what an unanswered field renders as
    // everywhere else on this product.
    values: {},
    firmName: firm?.name ?? 'the company',
    // No signer either: the merge draws its ruled blank for an empty name, and
    // inventing a name here would put a colleague on a document they have
    // never seen.
    signatureName: '',
    signerEmail: '',
    signedOn: formatSignedOn(new Date()),
  });

  return {
    input: {
      document,
      title: String(draft.name ?? '').trim().slice(0, 120) || 'Template',
      brandName: firm?.name ?? undefined,
      accent: firm?.accentColor ?? undefined,
      letterheadUrl: firm?.letterheadUrl ?? undefined,
      letterheadDesign: firmLetterheadDesign(firm?.metadata),
      logoUrl: firm?.logoUrl ?? undefined,
      // The firm's layout with THIS DRAFT's override on top, sanitized by the
      // same function the save runs. It is the point of the whole preview: the
      // author is choosing margins, a letterhead band, a watermark and a
      // footer, and until now the only way to see any of them was to publish
      // the template and have a colleague send something.
      layout: resolveDocumentLayout(
        firmDocumentLayoutInput(firm?.metadata),
        sanitizeDocumentLayoutOverride(draft.documentLayout),
      ),
      state: 'unsigned',
    },
  };
}
