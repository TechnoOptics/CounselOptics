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

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { appendSignatureEvent } from './esign-audit';
import {
  computeSignatureBoxRect,
  resolveSignaturePageIndex,
} from './signature-geometry';
import {
  boxesForKey,
  resolveFieldBoxRect,
  resolveFieldTextSize,
  type FieldBox,
} from './template-field-boxes';
import {
  formatCounterpartyValue,
  isWinAnsiEncodable,
  sanitizeCounterpartyValues,
} from './counterparty-fields';
import { loadCounterpartyStamp } from './counterparty-intake';
import type { TemplateField } from './firm-templates';

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

type FieldStampOutcome = {
  /** Blanks this render set out to complete. Every recorded box, whether or
   *  not the signer typed into it. */
  intended: number;
  /** Blanks it actually completed. */
  drawn: number;
  failures: string[];
  /** True when the typed values could not be read at all, which is not the
   *  same as there being none: it means this render does not know what
   *  belongs in the blanks it is looking at. */
  readFailed: boolean;
  relocations: Array<{
    signatureId: string | null;
    signerEmail: string | null;
    detail: Record<string, unknown>;
  }>;
};

const NO_FIELDS: FieldStampOutcome = {
  intended: 0,
  drawn: 0,
  failures: [],
  readFailed: false,
  relocations: [],
};

/**
 * Put the counterparty's own words into the blanks the renderer left them.
 *
 * WHY THIS IS NOT A RE-RENDER. The document was rendered once and those exact
 * bytes were hashed into firm_signing_requests.document_sha256, which is the
 * chain's answer to "what was the counterparty shown". Rendering it again
 * with the values merged in would produce different bytes with a different
 * hash and the chain would attest to a document nobody saw. So the values are
 * drawn onto the stored bytes, at the geometry the renderer recorded when it
 * drew the blanks, which is the same geometry the live overlay on the signing
 * page positioned them at. resolveFieldBoxRect is the shared arithmetic and
 * formatCounterpartyValue is the shared wording; neither end has a copy.
 *
 * EVERY RECORDED BOX IS COVERED, including one the signer left empty. The
 * marker the renderer drew is still in the stored bytes, and drawing over a
 * filled blank while leaving an empty one showing `_____<<entity_name>>_____`
 * would put a piece of our plumbing on the face of an executed instrument. An
 * unanswered optional blank comes out as a ruled line, which is what a blank
 * on a signed paper document looks like.
 */
async function stampCounterpartyFields(
  admin: SupabaseClient,
  pdf: PDFDocument,
  pages: ReturnType<PDFDocument['getPages']>,
  requestId: string,
): Promise<FieldStampOutcome> {
  const intake = await loadCounterpartyStamp(admin, requestId);
  // No submission behind this request, no blanks on its document, or a firm
  // that has not applied 20260807_flow_join.sql. All three are today's
  // behaviour and none of them is a failure.
  if (!intake || intake.boxes.length === 0) return NO_FIELDS;

  const { data, error } = await admin
    .from('firm_signatures')
    .select('id, signer_email, counterparty_values')
    .eq('signing_request_id', requestId);
  if (error) {
    // The blanks are there and this render does not know what goes in them.
    // Producing a copy anyway would file an instrument with our own markers
    // printed on it.
    return {
      ...NO_FIELDS,
      readFailed: true,
      failures: [`typed details could not be read: ${error.message}`],
    };
  }

  // Merged across signature rows. In practice only the counterparty has any,
  // and a later signer answering the same key would be answering for them,
  // so the first row carrying a key wins and the fact is recorded once.
  const values: Record<string, string> = {};
  const owner: Record<string, { id: string; email: string }> = {};
  for (const row of (data ?? []) as Array<{
    id: string;
    signer_email: string;
    counterparty_values?: unknown;
  }>) {
    const clean = sanitizeCounterpartyValues(intake.fields, row.counterparty_values);
    for (const [key, value] of Object.entries(clean)) {
      if (values[key] !== undefined) continue;
      values[key] = value;
      owner[key] = { id: row.id, email: row.signer_email };
    }
  }

  const byKey = new Map<string, TemplateField>(intake.fields.map((f) => [f.key, f]));
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const BASE_SIZE = 11;

  const out: FieldStampOutcome = {
    intended: 0,
    drawn: 0,
    failures: [],
    readFailed: false,
    relocations: [],
  };

  const drawn = new Set<FieldBox>();
  for (const key of new Set(intake.boxes.map((b) => b.key))) {
    const field = byKey.get(key);
    const stored = values[key] ?? '';
    // Formatted through the function the live overlay called, so a date
    // cannot read one way in the preview and another on the executed copy.
    const text = field ? formatCounterpartyValue(field, stored) : stored;
    for (const box of boxesForKey(intake.boxes, key)) {
      if (drawn.has(box)) continue;
      drawn.add(box);
      out.intended += 1;
      const resolution = resolveSignaturePageIndex(box.page, pages.length);
      const page = pages[resolution.index];
      if (!page) {
        out.failures.push(`${key}: page ${box.page} missing`);
        continue;
      }
      const { width: pw, height: ph } = page.getSize();
      const rect = resolveFieldBoxRect(box, { pageWidthPt: pw, pageHeightPt: ph });
      if (rect.width <= 0 || rect.height <= 0) {
        out.failures.push(`${key}: page ${box.page} has no usable area (${pw} x ${ph} pt)`);
        continue;
      }
      // Checked BEFORE the measurement, not only before the draw. pdf-lib's
      // widthOfTextAtSize encodes the string to measure it, so an
      // unencodable character throws there, outside any try, and takes the
      // whole executed render down as an uncaught exception instead of the
      // recorded refusal below. The signing page refuses these values
      // (isWinAnsiEncodable in lib/counterparty-fields.ts), so reaching here
      // means a hand-edited row or a value written before that check
      // existed, and the answer is still to refuse rather than to throw.
      if (text && !isWinAnsiEncodable(text)) {
        out.failures.push(`${key}: the value uses characters this document cannot print`);
        continue;
      }
      const fit = resolveFieldTextSize({
        naturalWidthPt: text ? font.widthOfTextAtSize(text, BASE_SIZE) : 0,
        boxWidthPt: rect.width,
        baseSizePt: BASE_SIZE,
      });
      try {
        // Opaque first. The marker is underneath and the value replaces it
        // rather than printing on top of it.
        page.drawRectangle({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          color: rgb(1, 1, 1),
        });
        // The rule the blank was, kept so a filled document still reads as a
        // filled form and an unanswered optional blank still reads as a
        // blank rather than as a gap in the page.
        page.drawLine({
          start: { x: rect.x, y: rect.y + 1 },
          end: { x: rect.x + rect.width, y: rect.y + 1 },
          thickness: 0.5,
          color: rgb(0.45, 0.45, 0.45),
        });
        if (text) {
          page.drawText(text, {
            x: rect.x + 2,
            // Sat on the rule, not on the box floor.
            y: rect.y + 4,
            size: fit.sizePt,
            font,
            color: rgb(0.1, 0.1, 0.1),
          });
        }
        out.drawn += 1;
      } catch (err) {
        // A character WinAnsi cannot encode is refused at the signing page
        // (isWinAnsiEncodable), so reaching here means something else, and
        // the guard in the caller turns it into a refusal rather than an
        // instrument with a hole in it.
        out.failures.push(
          `${key}: draw failed (${err instanceof Error ? err.message : String(err)})`,
        );
        continue;
      }
      // Same admission the signature box makes, for the same reason: the
      // executed instrument now disagrees with the recorded geometry, and
      // the chain is sold as evidence about that instrument.
      if (rect.relocated || rect.shrunk || resolution.relocated || fit.shrunk) {
        out.relocations.push({
          signatureId: owner[key]?.id ?? null,
          signerEmail: owner[key]?.email ?? null,
          detail: {
            field_key: key,
            page_requested: box.page,
            page_used: resolution.index + 1,
            page_relocated: resolution.relocated,
            page_width_pt: pw,
            page_height_pt: ph,
            requested_x_pt: rect.requestedX,
            requested_y_pt: rect.requestedY,
            drawn_x_pt: rect.x,
            drawn_y_pt: rect.y,
            dx_pt: rect.dxPt,
            dy_pt: rect.dyPt,
            box_width_pt: rect.width,
            box_height_pt: rect.height,
            box_shrunk: rect.shrunk,
            text_size_pt: fit.sizePt,
            text_shrunk: fit.shrunk,
            // True when even the smallest legible size does not fit, so the
            // value runs wider than its blank on the page.
            text_overflows: fit.overflows,
          },
        });
      }
    }
  }
  return out;
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

  // The counterparty's own words go on FIRST, before any mark, because the
  // instrument has to be complete before it is signed on the face of it.
  const fields = await stampCounterpartyFields(admin, pdf, pages, requestId);

  // Stamp each signer's PNG. Failures degrade gracefully.
  let stamped = 0;
  let skipped = 0;
  const skipReasons: string[] = [];
  const relocations: Array<{
    signatureId: string;
    signerEmail: string;
    detail: Record<string, unknown>;
  }> = [];
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
    const pageResolution = resolveSignaturePageIndex(
      s.position_page,
      pages.length,
    );
    const page = pages[pageResolution.index];
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
    //
    // computeSignatureBoxRect keeps the whole box, and the caption
    // band under it, inside the page. Bounding the 0-1 fraction alone
    // (what this used to do) does not bound the 220 x 64 point box
    // that starts at it, so a right-hand or top-of-page anchor used to
    // have its overflow silently dropped by pdf-lib.
    const rect = computeSignatureBoxRect({
      positionX: s.position_x,
      positionY: s.position_y,
      pageWidthPt: pw,
      pageHeightPt: ph,
    });
    if (rect.width <= 0 || rect.height <= 0) {
      skipped++;
      skipReasons.push(
        `${s.signer_email}: page ${pageResolution.requestedPage} has no usable area (${pw} x ${ph} pt)`,
      );
      continue;
    }
    try {
      const image = await pdf.embedPng(png);
      // Fit-inside scaling so we never crop the signature.
      const scale = Math.min(
        rect.width / image.width,
        rect.height / image.height,
      );
      const drawW = image.width * scale;
      const drawH = image.height * scale;
      page.drawImage(image, {
        x: rect.x + (rect.width - drawW) / 2,
        y: rect.y + (rect.height - drawH) / 2,
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
        x: rect.x + 2,
        y: rect.captionY,
        size: 8,
      });
      stamped++;
      // A mark that did not land where the recorded anchor said is a
      // discrepancy between the signature row and the executed
      // instrument. The chain is sold as evidence of what happened to
      // that instrument, so the move is recorded rather than absorbed.
      if (rect.relocated || rect.shrunk || pageResolution.relocated) {
        relocations.push({
          signatureId: s.id,
          signerEmail: s.signer_email,
          detail: {
            page_requested: pageResolution.requestedPage,
            page_used: pageResolution.index + 1,
            page_relocated: pageResolution.relocated,
            page_width_pt: pw,
            page_height_pt: ph,
            position_x: s.position_x,
            position_y: s.position_y,
            requested_x_pt: rect.requestedX,
            requested_y_pt: rect.requestedY,
            drawn_x_pt: rect.x,
            drawn_y_pt: rect.y,
            dx_pt: rect.dxPt,
            dy_pt: rect.dyPt,
            box_width_pt: rect.width,
            box_height_pt: rect.height,
            shrunk: rect.shrunk,
          },
        });
      }
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
  //
  // The same reasoning extends to the counterparty's typed values, one step
  // further: an executed copy that is MISSING a value the signer typed is
  // worse than no executed copy at all. It would go to counsel labelled as
  // the executed instrument while showing a blank where the other side's
  // entity name is supposed to be, or worse, showing the raw marker the
  // renderer drew there. So a single field the signer supplied and this
  // render could not put on the page aborts the whole thing, where a missing
  // signature only has to be the last one to do so.
  const fieldsIncomplete =
    fields.readFailed || (fields.intended > 0 && fields.drawn < fields.intended);
  if (stamped === 0 || fieldsIncomplete) {
    await appendSignatureEvent(admin, {
      signingRequestId: request.id,
      eventType: 'final_pdf_render_failed',
      documentSha256: request.document_sha256,
      metadata: {
        reason: fieldsIncomplete
          ? 'a detail the signer typed could not be placed on the document'
          : 'no signature could be stamped onto the document',
        stamped,
        skipped,
        skip_reasons: skipReasons.length > 0 ? skipReasons : null,
        fields_intended: fields.intended,
        fields_drawn: fields.drawn,
        field_failures: fields.failures.length > 0 ? fields.failures : null,
        source_path: src.path,
      },
    });
    return {
      ok: false,
      logged: true,
      error: fieldsIncomplete
        ? `${fields.intended - fields.drawn} of ${fields.intended} details the signer typed could not be placed on the document.`
        : `No signature could be stamped onto the document (${skipped} skipped).`,
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

  // Record every relocation BEFORE the render event so the chain reads
  // in causal order: each mark that had to be moved, then the render
  // that produced the file containing those marks. One event per
  // signature, because the signature id and signer email are what a
  // reviewer asks about, and appendSignatureEvent chains sequentially.
  for (const r of fields.relocations) {
    await appendSignatureEvent(admin, {
      signingRequestId: request.id,
      signatureId: r.signatureId,
      signerEmail: r.signerEmail,
      eventType: 'counterparty_field_relocated',
      documentSha256: request.document_sha256,
      metadata: r.detail,
    });
  }
  for (const r of relocations) {
    await appendSignatureEvent(admin, {
      signingRequestId: request.id,
      signatureId: r.signatureId,
      signerEmail: r.signerEmail,
      eventType: 'signature_relocated',
      documentSha256: request.document_sha256,
      metadata: r.detail,
    });
  }

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
      relocated: relocations.length,
      skip_reasons: skipReasons.length > 0 ? skipReasons : null,
      // The counterparty's own blanks, so a reviewer can tell an instrument
      // that carried typed details from one that carried none.
      fields_intended: fields.intended,
      fields_drawn: fields.drawn,
      fields_relocated: fields.relocations.length,
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
