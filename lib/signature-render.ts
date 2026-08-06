/**
 * Final-render step for the in-app signing flow.
 *
 * When every signer on a request has submitted their PNG, this
 * module downloads the source PDF (the one the firm originally
 * uploaded - possibly with appended signature boxes from
 * signature-anchors.ts) and stamps each signer's PNG onto the
 * recorded (positionPage, positionX, positionY) coordinates.
 *
 * The resulting "executed" PDF is uploaded back into firm-documents
 * under `signed/<request-id>/final.pdf`. The signing-request row's
 * audit log records the path so the firm can download the fully-
 * stamped artifact, and consumer-side notifications link to it.
 *
 * Why a separate render step instead of "stamp on each POST"?
 *   - The PDF is mutated to its final form ONCE, when the request
 *     completes. Partial mutation would leave half-signed PDFs in
 *     storage which complicates audit (which version is canonical?).
 *   - Stamping one PNG per POST repeats the download/load/save
 *     cycle N times. Batching avoids that cost.
 *   - Failure modes are localised: if stamping fails (encrypted
 *     PDF, malformed PNG), the underlying signature rows still hold
 *     the immutable PNGs in the firm-signatures bucket, so we can
 *     retry without losing intent.
 */

import { PDFDocument } from 'pdf-lib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { appendSignatureEvent } from './esign-audit';

export type RenderResult =
  | { ok: true; signedPath: string; bytes: number; pages: number }
  | {
      ok: false;
      error: string;
      /**
       * True when this failure already appended its own
       * final_pdf_render_failed event, with the metadata that explains
       * it. The caller uses it to avoid appending a second, thinner
       * event for the same fact, see shouldLogRenderFailure below.
       */
      logged?: boolean;
    };

/**
 * Does the caller still owe the audit chain an event for this result?
 *
 * Most of the ways this render fails return early with no event of
 * their own, and the caller is the only thing that will record them.
 * Two of them append a detailed event first, and a second generic one
 * chained behind it says nothing new. The chain stays valid either
 * way; the point is that an audit trail is worth having only if it can
 * be read, and duplicate entries per fact are how that stops.
 */
export function shouldLogRenderFailure(
  result: RenderResult,
): result is Extract<RenderResult, { ok: false }> {
  return !result.ok && !result.logged;
}

/**
 * Read the source PDF associated with a signing request.
 *
 * If a `signable_file_path` (the path produced when we appended
 * signature boxes via placeSignaturesIfMissing) exists on
 * firm_documents, use it - that's the version the signer actually
 * saw and signed. Otherwise fall back to the original file_path.
 */
async function downloadSourcePdf(
  admin: SupabaseClient,
  documentId: string,
): Promise<{ bytes: Uint8Array; path: string } | null> {
  const { data } = await admin
    .from('firm_documents')
    .select('file_path, signable_file_path')
    .eq('id', documentId)
    .maybeSingle();
  const row = data as {
    file_path?: string | null;
    signable_file_path?: string | null;
  } | null;
  const path = row?.signable_file_path || row?.file_path;
  if (!path) return null;
  const { data: blob, error } = await admin.storage
    .from('firm-documents')
    .download(path);
  if (error || !blob) return null;
  const buf = await blob.arrayBuffer();
  return { bytes: new Uint8Array(buf), path };
}

/**
 * Download a captured signature PNG from the firm-signatures bucket.
 * Returns null on miss so we can skip-and-warn rather than abort
 * the whole render.
 */
async function downloadSignaturePng(
  admin: SupabaseClient,
  imagePath: string,
): Promise<Uint8Array | null> {
  const { data, error } = await admin.storage
    .from('firm-signatures')
    .download(imagePath);
  if (error || !data) return null;
  const buf = await data.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Stamp signature PNGs onto the source PDF and upload the executed
 * version to firm-documents/signed/<request-id>/final.pdf.
 *
 * Idempotent: re-running on a fully-signed request overwrites the
 * existing `signed/.../final.pdf` with the latest stamp output. If
 * a stamp fails for one signer (missing PNG, bad coords), we record
 * the failure in the audit log and continue - a partial stamp is
 * more useful than no stamp at all.
 */
export async function renderFinalSignedPdf(
  admin: SupabaseClient,
  requestId: string,
): Promise<RenderResult> {
  // Pull the request + signatures (with their per-signer positions).
  const { data: reqRow } = await admin
    .from('firm_signing_requests')
    .select('id, firm_id, document_id, status, document_sha256')
    .eq('id', requestId)
    .maybeSingle();
  if (!reqRow) return { ok: false, error: 'Request not found.' };
  const request = reqRow as {
    id: string;
    firm_id: string;
    document_id: string;
    status: string;
    document_sha256: string | null;
  };

  const { data: sigRows } = await admin
    .from('firm_signatures')
    .select(
      'id, signer_email, signer_name, position_page, position_x, position_y, signature_image_path, signed_at',
    )
    .eq('signing_request_id', requestId);
  const sigs = (sigRows ?? []) as Array<{
    id: string;
    signer_email: string;
    signer_name: string | null;
    position_page: number | null;
    position_x: number | null;
    position_y: number | null;
    signature_image_path: string | null;
    signed_at: string | null;
  }>;
  if (sigs.length === 0) {
    return { ok: false, error: 'No signatures recorded for this request.' };
  }

  // Source PDF.
  const src = await downloadSourcePdf(admin, request.document_id);
  if (!src) {
    return { ok: false, error: 'Source document not found in storage.' };
  }

  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(src.bytes, { updateMetadata: false });
  } catch (err) {
    return {
      ok: false,
      error: `Could not parse source PDF: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const pages = pdf.getPages();

  // Stamp each signer's PNG. Failures degrade gracefully.
  let stamped = 0;
  let skipped = 0;
  const skipReasons: string[] = [];
  for (const s of sigs) {
    if (!s.signed_at) {
      skipped++;
      skipReasons.push(`${s.signer_email}: not signed yet`);
      continue;
    }
    if (!s.signature_image_path) {
      skipped++;
      skipReasons.push(`${s.signer_email}: no signature image`);
      continue;
    }
    const png = await downloadSignaturePng(admin, s.signature_image_path);
    if (!png) {
      skipped++;
      skipReasons.push(`${s.signer_email}: png download failed`);
      continue;
    }
    const pageIdx = Math.max(1, s.position_page ?? 1) - 1;
    const page = pages[pageIdx] ?? pages[0];
    if (!page) {
      skipped++;
      skipReasons.push(`${s.signer_email}: page ${s.position_page} missing`);
      continue;
    }
    const { width: pw, height: ph } = page.getSize();
    // Coordinates: positionX/Y are 0-1 normalized, measured from
    // bottom-left of the page (PDF-native). Default box dimensions
    // come from signature-anchors.ts; we mirror them here so the
    // renderer stays self-contained.
    const x = Math.max(0, Math.min(1, s.position_x ?? 0.07)) * pw;
    const y = Math.max(0, Math.min(1, s.position_y ?? 0.07)) * ph;
    const boxW = 220;
    const boxH = 64;
    try {
      const image = await pdf.embedPng(png);
      // Fit-inside scaling so we never crop the signature.
      const scale = Math.min(boxW / image.width, boxH / image.height);
      const drawW = image.width * scale;
      const drawH = image.height * scale;
      page.drawImage(image, {
        x: x + (boxW - drawW) / 2,
        y: y + (boxH - drawH) / 2,
        width: drawW,
        height: drawH,
      });
      // Caption under the signature: name + signed-at ISO date so
      // the executed PDF carries its own legibility regardless of
      // the surrounding audit trail.
      const captionParts = [
        s.signer_name?.trim() || s.signer_email,
        s.signed_at ? new Date(s.signed_at).toISOString().slice(0, 10) : null,
      ].filter(Boolean);
      page.drawText(captionParts.join(' - '), {
        x: x + 2,
        y: y - 10,
        size: 8,
      });
      stamped++;
    } catch (err) {
      skipped++;
      skipReasons.push(
        `${s.signer_email}: embed/draw failed (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  // Nothing landed on the page. Uploading this and recording it as
  // the executed copy would put a document with an empty signature
  // line in front of counsel under the label "executed copy", which is
  // a worse answer than no executed copy at all: the surfaces that
  // read signed_file_path state plainly when it is absent, and cannot
  // tell a stamped PDF from an unstamped one once it is present.
  if (stamped === 0) {
    await appendSignatureEvent(admin, {
      signingRequestId: request.id,
      eventType: 'final_pdf_render_failed',
      documentSha256: request.document_sha256,
      metadata: {
        reason: 'no signature could be stamped onto the document',
        stamped,
        skipped,
        skip_reasons: skipReasons.length > 0 ? skipReasons : null,
        source_path: src.path,
      },
    });
    return {
      ok: false,
      logged: true,
      error: `No signature could be stamped onto the document (${skipped} skipped).`,
    };
  }

  const outBytes = await pdf.save({ useObjectStreams: false });
  const signedPath = `signed/${request.id}/final.pdf`;
  const { error: upErr } = await admin.storage
    .from('firm-documents')
    .upload(signedPath, outBytes, {
      contentType: 'application/pdf',
      upsert: true,
    });
  if (upErr) {
    return { ok: false, error: `Upload failed: ${upErr.message}` };
  }

  // Persist the executed-doc path on the request row. This is the only
  // pointer to the executed copy that any surface reads, so a write
  // that fails here means the PDF exists in storage and nothing can
  // find it.
  //
  // It used to be wrapped in try/catch against the column being absent
  // on an older schema, but supabase-js does not throw on a query
  // error, it resolves with one. The catch could never fire, so a
  // missing column was swallowed AND the audit event below went on to
  // assert a signed_file_path the row did not carry. The error is read
  // now, and the audit trail records which of the two happened.
  const { error: pathErr } = await admin
    .from('firm_signing_requests')
    .update({ signed_file_path: signedPath })
    .eq('id', request.id);

  // Audit trail entry so reviewers can see when and how the final
  // PDF was produced. The metadata captures the per-signer stamp
  // outcome so a partial render is reconstructible.
  await appendSignatureEvent(admin, {
    signingRequestId: request.id,
    eventType: pathErr ? 'final_pdf_render_failed' : 'final_pdf_rendered',
    documentSha256: request.document_sha256,
    metadata: {
      // Only claimed when the row actually carries it.
      signed_file_path: pathErr ? null : signedPath,
      uploaded_path: signedPath,
      path_write_error: pathErr?.message ?? null,
      stamped,
      skipped,
      skip_reasons: skipReasons.length > 0 ? skipReasons : null,
      source_path: src.path,
      output_bytes: outBytes.length,
    },
  });

  if (pathErr) {
    return {
      ok: false,
      logged: true,
      error: `Executed PDF uploaded to ${signedPath} but the path could not be recorded on the request: ${pathErr.message}`,
    };
  }

  return {
    ok: true,
    signedPath,
    bytes: outBytes.length,
    pages: pages.length,
  };
}
