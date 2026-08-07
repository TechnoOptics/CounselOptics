import { type NextRequest } from 'next/server';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getActiveFirmContext, getFirmByIdAdmin } from '@/lib/firm-storage';
import { callerFirmRole } from '@/lib/firm-authz';
import { authorizeFirmActor } from '@/lib/portal-entitlements';
import { buildBrandedDocumentPdf } from '@/lib/branded-document-pdf';
import { firmLetterheadDesign } from '@/lib/letterhead-design';
import { canRenderFilledTemplate } from '@/lib/template-approval';
import { loadPublishedTemplate, sanitizeTemplateValues } from '@/lib/template-fill';
import {
  formatSignedOn,
  mergeTemplateDocument,
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
 * So there are two modes now, chosen by whether the body names a template:
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
  };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid body.', { status: 400 });
  }

  const templateId = String(body.templateId ?? '').trim();
  const firmId = String(body.firmId ?? '').trim();

  const rendered = templateId
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
      letterheadUrl: body.letterheadUrl,
      // Read off the caller's own active firm, never off the request body.
      // The body is the studio's draft; the letterhead is the firm's identity,
      // and a caller does not get to describe someone else's stationery.
      letterheadDesign: firmLetterheadDesign(ctx.firm.metadata),
      logoUrl: body.logoUrl,
    },
  };
}
