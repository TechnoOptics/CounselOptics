import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getFirmByIdAdmin } from './firm-storage';
import { buildBrandedDocumentPdf } from './branded-document-pdf';
import { firmLetterheadDesign } from './letterhead-design';
import { firmDocumentLayoutInput, resolveDocumentLayout } from './document-layout';
import { loadSubmissionMark } from './template-signature';
import type { DeliveryMode } from './submission-dispatch';
import type { SubmissionRow } from './template-submission-types';

/**
 * The reviewer's preview of the artifact an approval would actually release.
 *
 * WHY THIS EXISTS. The approvals detail page showed the document as plain
 * text. What leaves the firm is a letterheaded, branded PDF. So the one screen
 * in this product where a person decides to send confidential material to a
 * third party was the screen that did not show them what would be sent.
 *
 * NOTHING HERE IS STORED, HASHED, OR SERVED TO A SIGNER. That is the whole
 * difference between this module and lib/submission-document.ts, which renders
 * the instrument exactly once because its SHA-256 is what the audit chain
 * attests the counterparty was shown. A preview must never file a document or
 * claim that pointer, so this calls the renderer directly and throws the bytes
 * away.
 *
 * THE TEXT IS THE STORED TEXT AND IS NEVER RE-MERGED. document_text comes off
 * the row. It is not rebuilt from the template and the field values, and it is
 * not taken from the request. Re-merging would silently produce a different
 * document from the one the reviewer is deciding on the moment anybody edited
 * the template, and taking it from the request would let a caller render their
 * own words under the firm's letterhead. The caller states which revision they
 * are looking at and the route refuses anything else, so the bytes can only
 * ever be of the wording that reviewer's page rendered.
 *
 * THE INPUTS FOLLOW THE MODE, BECAUSE THE TWO DELIVERIES RENDER DIFFERENTLY.
 * A signature dispatch files the instrument through lib/submission-document.ts:
 * the firm layout with this template's override on top, no mark drawn, and the
 * state 'signed'. A share renders through lib/template-release.ts: the firm
 * layout alone, the employee's mark drawn on, and the state 'copy' when there
 * is a mark. Previewing one set of inputs for both would show half of all
 * reviewers a page that is not the page going out.
 *
 * HONEST LIMIT, STATED RATHER THAN PAPERED OVER. Those two paths still build
 * their own input objects inline, so this is a third spelling of the same
 * decision and a test here cannot prove the other two have not drifted. What
 * it can and does pin is that the wording, the title and the brand come off
 * the row and the firm record, which is what the reviewer is deciding on, and
 * that each mode's presentation matches what is written above. If either path
 * changes its inputs, change this with it.
 */

export type SubmissionPreviewRow = SubmissionRow & { template_id: string | null };

export type PreviewInput = Parameters<typeof buildBrandedDocumentPdf>[0];

/**
 * The renderer inputs for this row under this mode.
 *
 * Split out from the render itself so the decision is testable without a PDF
 * engine, a storage bucket or a firm record.
 */
export function submissionPreviewInput(args: {
  documentText: string;
  templateName: string;
  firmName?: string | null;
  accent?: string | null;
  letterheadUrl?: string | null;
  letterheadDesign: ReturnType<typeof firmLetterheadDesign>;
  logoUrl?: string | null;
  /** The firm layout with the template override already folded in, or without. */
  layout: ReturnType<typeof resolveDocumentLayout>;
  markBytes: Uint8Array | null;
  mode: DeliveryMode;
}): PreviewInput {
  const signatureMode = args.mode === 'signature';
  return {
    document: args.documentText,
    title: args.templateName,
    brandName: args.firmName ?? undefined,
    accent: args.accent ?? undefined,
    letterheadUrl: args.letterheadUrl ?? undefined,
    letterheadDesign: args.letterheadDesign,
    logoUrl: args.logoUrl ?? undefined,
    // The signature path draws no mark: the counterparty's values and every
    // mark are stamped onto the stored bytes later by lib/signature-render.ts.
    // The share path draws the employee's mark, because that copy is finished
    // the moment it is encrypted.
    signatureImage: !signatureMode && args.markBytes ? { png: args.markBytes } : undefined,
    layout: args.layout,
    // Matches each delivery exactly. Deliberately NOT the DRAFT mark that the
    // studios and the employee's own preview carry: those render something
    // that has not been decided on, whereas this renders the artifact that
    // would leave the firm, and a watermark the recipient will never see would
    // misrepresent it at the one moment misrepresentation costs the most.
    state: signatureMode ? 'signed' : args.markBytes ? 'copy' : 'unsigned',
  };
}

/** Render the preview bytes, or null when there is nothing worth rendering. */
export async function renderSubmissionPreview(
  admin: SupabaseClient,
  row: SubmissionPreviewRow,
  mode: DeliveryMode,
): Promise<Uint8Array | null> {
  const firm = await getFirmByIdAdmin(row.firm_id);
  const signatureMode = mode === 'signature';
  const rendering = await buildBrandedDocumentPdf(
    submissionPreviewInput({
      documentText: row.document_text,
      templateName: row.template_name,
      firmName: firm?.name,
      accent: firm?.accentColor,
      letterheadUrl: firm?.letterheadUrl,
      letterheadDesign: firmLetterheadDesign(firm?.metadata),
      logoUrl: firm?.logoUrl,
      layout: resolveDocumentLayout(
        firmDocumentLayoutInput(firm?.metadata),
        // Only the signature path reads the template's override; the share
        // path has no template id on its render and falls back to the firm
        // layout. Matching each keeps the preview honest about page geometry.
        signatureMode ? await readTemplateLayoutOverride(admin, row.template_id) : null,
      ),
      markBytes: signatureMode ? null : await loadSubmissionMark(admin, row.signature_image_path ?? null),
      mode,
    }),
  );
  return rendering?.bytes ?? null;
}

/**
 * This template's partial layout override, or null on anything that fails.
 * The same fail-safe direction as lib/submission-document.ts: a template that
 * cannot be read has no override worth guessing at, and the document then lays
 * out on the firm's own layout.
 */
async function readTemplateLayoutOverride(
  admin: SupabaseClient,
  templateId: string | null,
): Promise<unknown> {
  if (!templateId) return null;
  const { data, error } = await admin
    .from('firm_templates')
    .select('document_layout')
    .eq('id', templateId)
    .maybeSingle();
  if (error) return null;
  return (data as { document_layout?: unknown } | null)?.document_layout ?? null;
}
