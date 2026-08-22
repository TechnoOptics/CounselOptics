import 'server-only';

import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getFirmByIdAdmin } from './firm-storage';
import { buildBrandedDocumentPdf } from './branded-document-pdf';
import { firmLetterheadDesign } from './letterhead-design';
import { firmDocumentTypeface } from './document-typeface';
import { firmDocumentLayoutInput, resolveDocumentLayout } from './document-layout';
import { sha256 } from './esign-audit';
import {
  PAPER_ORIGIN_UNSAVED_ERROR,
  resolvePaperOriginColumnFallback,
} from './document-provenance';
import { isUnknownColumnError } from './signer-view';
import { serializeFieldBoxes } from './template-field-boxes';
import type { SubmissionRow } from './template-submission-types';

/**
 * File an approved template submission as a real firm document, exactly once.
 *
 * Not a server action, for the same reason lib/template-release.ts is not one:
 * nothing here is an HTTP endpoint. The only caller is the approval path, and
 * that path has already run the gate.
 *
 * WHY ONCE IS THE LOAD-BEARING WORD
 * ---------------------------------
 * buildBrandedDocumentPdf is not deterministic. Its footer draws
 * `Generated ${new Date().toLocaleDateString()}`, and PDFDocument.create()
 * stamps a fresh CreationDate and ModDate because nothing calls
 * setCreationDate. Two renders of identical text are two different byte
 * strings and therefore two different SHA-256 values.
 *
 * createSigningRequestAction downloads the stored file_path, hashes those
 * bytes, and writes the result to firm_signing_requests.document_sha256, which
 * is the chain's answer to "what was the counterparty shown". If the share
 * path rendered one copy and the signing path rendered another, the chain
 * would attest to a document nobody ever saw. So the document is rendered
 * here, once, stored, and every later consumer reads the stored bytes.
 *
 * TWO HASHES, WHICH ARE NOT THE SAME HASH
 * ---------------------------------------
 * The `sha256` this returns is of the PDF BYTES and answers "what was the
 * counterparty shown". firm_template_submissions.signed_document_sha256, which
 * arrives on a sibling branch, is of the document_text and answers "what words
 * did the employee affirm". Different inputs, different purposes. Never
 * compare one to the other.
 *
 * The storage path and the row shape follow lib/letters-actions.ts, which
 * already renders bytes in process and files them as a firm_documents row.
 *
 * Every write below checks `{ error }`. PostgREST resolves rather than throws,
 * so a try/catch around an insert catches nothing, and this repo has lost a
 * month of audit writes to exactly that.
 */

export type MaterializedDocument =
  | { ok: true; documentId: string; sha256: string }
  | { ok: false; error: string };

/** What a filed submission document is tagged with, so it can be found again. */
export const SUBMISSION_DOCUMENT_TAG = 'template-submission';

/**
 * What an approver is told when the template asks the other side to fill
 * something in and the column that records where those blanks are has not
 * been added yet.
 *
 * The same shape as SIGNER_DOWNLOAD_RESTRICTION_UNSAVED_ERROR and for the
 * same reason: the safe direction is to send nothing. It names the fix and
 * names who can make it, because the approver cannot.
 */
export const FIELD_BOXES_UNSAVED_ERROR =
  'This document was not sent. It asks the recipient to fill parts of it in, ' +
  'and where those go cannot be recorded yet, so they would have no way to ' +
  'complete it. Ask your administrator to apply the pending database update, ' +
  'or use a template that does not ask the recipient for anything.';

type Row = SubmissionRow & { document_id?: string | null };

export async function materializeSubmissionDocument(
  admin: SupabaseClient,
  submissionId: string,
): Promise<MaterializedDocument> {
  const { data, error: readError } = await admin
    .from('firm_template_submissions')
    .select('*')
    .eq('id', submissionId)
    .maybeSingle();
  // A failed read and a missing row both arrive as null data, and telling the
  // approver the submission is gone when the truth is that the database did
  // not answer writes a false statement onto the record.
  if (readError) {
    return { ok: false, error: 'This submission could not be read just now. Try again shortly.' };
  }
  const row = (data as Row | null) ?? null;
  if (!row) return { ok: false, error: 'That submission could not be found.' };

  // Idempotent. A retry after a partial dispatch, or a second approver in a
  // second tab, must not file a second copy of the same instrument: the second
  // copy would have different bytes and a different hash, and whichever one
  // the signer was served would disagree with whichever one was recorded.
  if (row.document_id) {
    const existing = await readStoredHash(admin, row.document_id);
    if (!existing.ok) return existing;
    return { ok: true, documentId: row.document_id, sha256: existing.sha256 };
  }

  const firm = await getFirmByIdAdmin(row.firm_id);
  // The page layout, resolved from the firm's default and this template's
  // partial override at the one moment that matters: this render. A firm that
  // changes its layout tomorrow changes the NEXT document, not this one, and
  // that is the whole of why editing a layout is safe. Nothing re-reads this.
  const layout = resolveDocumentLayout(
    firmDocumentLayoutInput(firm?.metadata),
    await readTemplateLayoutOverride(admin, row.template_id),
  );
  // Rendered once, here, and never again.
  const rendering = await buildBrandedDocumentPdf({
    document: row.document_text,
    title: row.template_name,
    brandName: firm?.name ?? undefined,
    accent: firm?.accentColor ?? undefined,
    letterheadUrl: firm?.letterheadUrl ?? undefined,
    letterheadDesign: firmLetterheadDesign(firm?.metadata),
    typeface: firmDocumentTypeface(firm?.metadata),
    logoUrl: firm?.logoUrl ?? undefined,
    layout,
    // 'signed', DELIBERATELY, on the one path where a document is stored.
    //
    // These bytes become the executed instrument. The counterparty's typed
    // values and every mark are drawn ONTO them by lib/signature-render.ts;
    // they are never re-rendered, because the SHA-256 of this render is what
    // the audit chain attests the counterparty was shown. So a watermark drawn
    // here could never be taken off again, and the owner's rule is that the
    // mark stops once the document is signed. A DRAFT stamp that survived onto
    // the executed copy would be worse than no watermark at all.
    //
    // The DRAFT mark belongs on the surfaces that render a draft and store
    // nothing: the template and letter studios, and an employee's own preview.
    // Those go through app/api/counsel/draft-template/pdf.
    state: 'signed',
  });
  // Null is a refusal, not a throw: the renderer returns it for a document
  // with nothing worth rendering in it.
  if (!rendering) {
    return { ok: false, error: 'The document could not be prepared for signing.' };
  }
  const bytes = rendering.bytes;
  const fieldBoxes = rendering.fieldBoxes;

  const id = crypto.randomUUID();
  const safeName =
    (row.template_name.replace(/[^a-zA-Z0-9.\-_ ]/g, '').slice(0, 100) || 'document') + '.pdf';
  const filePath = `${row.firm_id}/${id}/${safeName}`;
  const buffer = Buffer.from(bytes);

  const { error: uploadError } = await admin.storage
    .from('firm-documents')
    .upload(filePath, buffer, { contentType: 'application/pdf', upsert: false });
  if (uploadError) {
    return { ok: false, error: 'The document could not be stored. Try again shortly.' };
  }

  const { error: insertError } = await admin.from('firm_documents').insert({
    id,
    firm_id: row.firm_id,
    name: row.template_name,
    mime_type: 'application/pdf',
    file_path: filePath,
    file_size: buffer.byteLength,
    version: 1,
    uploaded_by: row.submitted_by,
    tags: [SUBMISSION_DOCUMENT_TAG],
    status: 'ready',
    description: null,
    // THE ONE PLACE IN THE REPO THAT MAY CLAIM THE FIRM WROTE A DOCUMENT.
    //
    // These bytes came out of buildBrandedDocumentPdf, forty lines up, from a
    // template the firm published and a colleague filled in. Nothing else
    // knows that: an uploaded file is somebody's paper and this module is not
    // in its path at all. So 'firm' is written here and nowhere else, and
    // every other row in the table is left to read as 'third_party' by
    // default, which is what readPaperOrigin does with a null and with an
    // absent column.
    //
    // Naming the column unconditionally, rather than only when it exists, is
    // deliberate and is the opposite of the field_boxes treatment below. That
    // one omits its column so an unapplied migration stays invisible, which
    // is right when the omitted value is what an absent column already means.
    // This value is not: a document the firm rendered, filed without it,
    // reads as the counterparty's forever and the surfaces will say so in
    // words. See resolvePaperOriginColumnFallback for the full reasoning.
    paper_origin: 'firm',
  });
  if (insertError) {
    // Remove the object before returning, the way lib/import-actions.ts does,
    // or the bucket accumulates files no row points at.
    await removeQuietly(admin, filePath);
    // The migration is not applied yet. This does NOT retry without the
    // column: filing it unlabelled would put a false and permanent
    // provenance claim on a legal document, where refusing leaves the
    // submission approved and retryable. The submission row is untouched, so
    // approving again after the migration lands files it properly.
    if (
      resolvePaperOriginColumnFallback({
        error: insertError,
        isUnknownColumn: isUnknownColumnError,
      }) === 'abort-origin-unsaved'
    ) {
      return { ok: false, error: PAPER_ORIGIN_UNSAVED_ERROR };
    }
    return { ok: false, error: 'The document could not be filed. Try again shortly.' };
  }

  // Claim the pointer. Two approvers in two tabs both reach this line with a
  // document each; the conditional update is what decides which of the two the
  // instrument actually is. The loser deletes its own upload and its own row
  // and returns the winner's document, so there is exactly one set of bytes
  // and exactly one hash for this submission.
  const { data: claimed, error: claimError } = await admin
    .from('firm_template_submissions')
    .update({
      document_id: id,
      // In the SAME write as the document id, deliberately. The boxes describe
      // these bytes and no others, so a row that names this document must
      // carry this document's geometry or the overlay and the stamp would be
      // reading a previous render's positions.
      //
      // Omitted entirely when the template declared no counterparty fields,
      // which is every template that exists today. That is what makes an
      // unapplied migration invisible: the column is never named, so
      // PostgREST never refuses the statement, and the firm sees exactly the
      // behaviour it had last week.
      ...(fieldBoxes.length > 0
        ? { field_boxes: serializeFieldBoxes(fieldBoxes) }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', submissionId)
    .is('document_id', null)
    .select('id')
    .maybeSingle();
  if (claimError) {
    await discard(admin, id, filePath);
    // A document with blanks in it and nowhere to record where they are is
    // not sendable. The counterparty would be shown a page of markers with
    // no way to fill them and the executed copy would carry the markers into
    // the instrument, so this refuses rather than sending something worse
    // than nothing. The row stays approved and retryable.
    if (isUnknownColumnError(claimError, 'field_boxes')) {
      return { ok: false, error: FIELD_BOXES_UNSAVED_ERROR };
    }
    return { ok: false, error: 'The document could not be filed. Try again shortly.' };
  }
  if (!claimed) {
    await discard(admin, id, filePath);
    const { data: winner } = await admin
      .from('firm_template_submissions')
      .select('document_id')
      .eq('id', submissionId)
      .maybeSingle();
    const winnerId = (winner as { document_id?: string | null } | null)?.document_id ?? null;
    if (!winnerId) {
      // Lost the claim and cannot see who won. Saying "filed" here would name
      // a document that has just been deleted.
      return { ok: false, error: 'This document is already being prepared. Try again shortly.' };
    }
    const existing = await readStoredHash(admin, winnerId);
    if (!existing.ok) return existing;
    return { ok: true, documentId: winnerId, sha256: existing.sha256 };
  }

  return { ok: true, documentId: id, sha256: sha256(buffer) };
}

/**
 * The hash of the bytes as stored, read back rather than remembered.
 *
 * On the idempotent path we do not have the bytes in hand, and the whole point
 * of this module is that the hash describes what is in the bucket. Reading it
 * back is the only way to say that truthfully.
 */
async function readStoredHash(
  admin: SupabaseClient,
  documentId: string,
): Promise<{ ok: true; sha256: string } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from('firm_documents')
    .select('file_path')
    .eq('id', documentId)
    .maybeSingle();
  if (error) {
    return { ok: false, error: 'The stored document could not be read just now. Try again shortly.' };
  }
  const path = (data as { file_path?: string | null } | null)?.file_path ?? null;
  if (!path) return { ok: false, error: 'The stored document could not be found.' };
  const { data: blob, error: downloadError } = await admin.storage
    .from('firm-documents')
    .download(path);
  if (downloadError || !blob) {
    return { ok: false, error: 'The stored document could not be read just now. Try again shortly.' };
  }
  return { ok: true, sha256: sha256(Buffer.from(await blob.arrayBuffer())) };
}

/**
 * This template's partial layout override, or null.
 *
 * Null on every failure, and that is the fail-safe direction rather than
 * laziness: a template that cannot be read has no override worth guessing at,
 * and the document then lays out on the firm's own layout, which is the page
 * the firm was already getting. The column is absent until
 * 20260809_template_document_layout.sql is applied, and an absent column reads
 * the same way.
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

/** Throw the losing copy away: the row first, then the bytes it named. */
async function discard(
  admin: SupabaseClient,
  documentId: string,
  filePath: string,
): Promise<void> {
  await admin.from('firm_documents').delete().eq('id', documentId);
  await removeQuietly(admin, filePath);
}

async function removeQuietly(admin: SupabaseClient, filePath: string): Promise<void> {
  try {
    await admin.storage.from('firm-documents').remove([filePath]);
  } catch {
    // Cleanup is best effort. An orphaned object is a cost; letting a cleanup
    // failure mask the failure that caused it is a lie.
  }
}
