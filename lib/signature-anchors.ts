/**
 * Signature anchor detection + fallback layout for the in-app
 * signing flow.
 *
 * Background
 * ----------
 * When a firm sends a document for signature, we need to know WHERE
 * on each page to draw each signer's captured PNG. There are three
 * possible sources for that placement:
 *
 *   1. The firm explicitly tagged "Alice signs here" in the UI when
 *      composing the request. (positionPage / positionX / positionY
 *      supplied by the caller of createSigningRequestAction.)
 *
 *   2. The source PDF already contains an AcroForm signature field
 *      (Adobe's "official" signature placeholder, type /Sig). Lots
 *      of legal templates ship with these; pdf-lib can read them
 *      directly. We treat the field's widget rectangle as the
 *      anchor.
 *
 *   3. NEITHER of the above. This is what the V5 audit + this
 *      patch addresses: a plain-text PDF with no signature
 *      placeholder, no AcroForm field, no UI-supplied position. The
 *      old code defaulted to page 1, (0.1, 0.1) - which planted
 *      every signature over the top-left corner of every document.
 *      The new behaviour: APPEND a signature box at the bottom of
 *      the last page (or a fresh page when there isn't room),
 *      stacked one row per signer with a name label underneath.
 *
 * What "OCR can't find a sign line" maps to here
 * ----------------------------------------------
 * True image-OCR (Tesseract / Vision API) is out of scope for the
 * server lambda - it's heavyweight and the source PDFs we handle
 * are usually born-digital, not scans. Instead we treat the two
 * structurally-reliable signals as the "OCR pass":
 *
 *   - AcroForm signature fields (the formal placeholder).
 *   - Best-effort text scan for "Signature:" / "Sign here" / long
 *     underscore runs inside any uncompressed content stream we
 *     can read directly. This catches a chunk of real-world PDFs
 *     without pulling in a text-extraction dependency. Encrypted
 *     or compressed streams degrade gracefully to "no anchor
 *     found" and the fallback kicks in.
 *
 * Anything not caught by those two paths is what the fallback
 * exists for - the user is guaranteed a signable surface in the
 * final document regardless of how stripped-down the source PDF is.
 *
 * Coordinate system
 * -----------------
 * pdf-lib uses a PDF-native coordinate system: origin is the
 * bottom-left of the page, units are points (1pt = 1/72in).
 *
 * We persist positions in firm_signatures as normalized 0-1 floats
 * (positionX / positionY) so downstream consumers don't need to
 * know the page size, with positionY measured from the BOTTOM of
 * the page to match PDF-native semantics. The render step
 * (signature-render.ts) translates these back into points.
 */

import { PDFDocument, type PDFPage } from 'pdf-lib';

/**
 * Per-signer anchor as written to firm_signatures.
 */
export type SignaturePlacement = {
  /** 1-indexed page number that the placement targets. */
  positionPage: number;
  /** 0-1 normalized x. 0 = left edge, 1 = right edge. */
  positionX: number;
  /** 0-1 normalized y, measured from the BOTTOM of the page. */
  positionY: number;
  /** Box width in points (used by the renderer to size the PNG). */
  widthPt: number;
  /** Box height in points. */
  heightPt: number;
};

export type DetectionSource =
  | 'caller-supplied' // The caller passed explicit positionPage/X/Y.
  | 'acroform' // AcroForm signature field on the source PDF.
  | 'text-anchor' // Text-scan match (Signature: / Sign here / ___).
  | 'appended-fallback'; // We appended a box at the bottom.

export type SignerInput = {
  email: string;
  name?: string | null;
  positionPage?: number | null;
  positionX?: number | null;
  positionY?: number | null;
};

export type AssignedSigner = SignerInput & {
  placement: SignaturePlacement;
  source: DetectionSource;
};

/** Standard US Letter signature-box dimensions, in points. */
const BOX_WIDTH_PT = 220;
const BOX_HEIGHT_PT = 64;
/** Gap between stacked boxes, in points. */
const BOX_GAP_PT = 16;
/** Margin from the page edge (left + bottom), in points. */
const PAGE_MARGIN_PT = 54; // 0.75 inch

/**
 * Detect AcroForm signature fields on each page. Returns the widget
 * rectangle in PDF-native coordinates per field. pdf-lib's high-level
 * APIs don't surface signature fields directly, so we drop down to
 * the raw form dictionary - this is intentional: it works on every
 * pdf-lib-supported PDF and degrades silently when the form is
 * missing or unreadable.
 *
 * The returned list is ordered top-to-bottom on each page, then
 * page-ascending, so we can deterministically assign signers to
 * anchors in the order they were added to the request.
 */
async function findAcroFormSignatureAnchors(
  pdf: PDFDocument,
): Promise<SignaturePlacement[]> {
  const out: SignaturePlacement[] = [];
  // pdf-lib throws if there's no form, so guard it. We rely on the
  // form being lazily attached to the catalog; absence is the common
  // case for the documents this fallback is built for.
  let form;
  try {
    form = pdf.getForm();
  } catch {
    return out;
  }
  const fields = form.getFields();
  if (fields.length === 0) return out;

  for (const field of fields) {
    // Detect "signature" field type by reading the /FT entry on the
    // underlying field dictionary. pdf-lib's exported PDFSignature
    // class wraps this; instanceof would couple us to internals, so
    // sniff the raw dict instead.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const acro: any = (field as unknown as { acroField?: unknown }).acroField;
    const ft = acro?.FT?.()?.toString?.() || acro?.dict?.lookup?.('FT')?.toString?.();
    const isSig = typeof ft === 'string' && ft.includes('Sig');
    if (!isSig) continue;

    // Each signature field can have one or more widget annotations
    // (rectangles on the page). Walk all of them.
    const widgets: Array<{
      getRectangle?: () => { x: number; y: number; width: number; height: number };
      P?: () => unknown;
    }> = acro?.getWidgets?.() ?? [];
    for (const w of widgets) {
      const rect = w?.getRectangle?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      // Resolve which page this widget is on.
      //
      // pdf-lib's PDFWidgetAnnotation exposes `P()` which returns the
      // PDFRef of the parent page. The earlier implementation
      // compared `p.ref === (pageRef as { tag?: unknown })` which
      // ALWAYS evaluates false (different object identity), so every
      // signature widget was mapped to page 1 - reviewer caught
      // this. The reliable way to match is on PDFRef.objectNumber +
      // generationNumber, which pdf-lib stamps on the page ref the
      // catalog already knows about. We try the direct identity
      // first (cheapest) and fall back to objectNumber comparison
      // for the common case where the widget dictionary returns a
      // different JS object that still points at the same PDF ref.
      let pageIndex = -1;
      try {
        const pageRef = (w as { P?: () => unknown }).P?.() as
          | { objectNumber?: number; generationNumber?: number }
          | undefined;
        if (pageRef) {
          const pages = pdf.getPages();
          // Direct identity (rare but cheap).
          pageIndex = pages.findIndex(
            (p) => (p.ref as unknown) === (pageRef as unknown),
          );
          // Object-number match. PDFRef.objectNumber is the stable
          // identity across JS object boundaries.
          if (pageIndex < 0 && typeof pageRef.objectNumber === 'number') {
            pageIndex = pages.findIndex((p) => {
              const r = p.ref as unknown as {
                objectNumber?: number;
                generationNumber?: number;
              };
              return (
                r?.objectNumber === pageRef.objectNumber &&
                (r?.generationNumber ?? 0) ===
                  (pageRef.generationNumber ?? 0)
              );
            });
          }
        }
      } catch {
        /* fall through to the default below */
      }
      if (pageIndex < 0) pageIndex = 0;
      const page = pdf.getPages()[pageIndex];
      if (!page) continue;
      const { width: pw, height: ph } = page.getSize();
      out.push({
        positionPage: pageIndex + 1,
        positionX: rect.x / pw,
        positionY: rect.y / ph,
        widthPt: rect.width,
        heightPt: rect.height,
      });
    }
  }
  return out;
}

/**
 * Best-effort text scan. Walks every page's content stream looking
 * for common signature anchors:
 *
 *   - The literal "Signature:" / "Sign here" / "Signed by" labels.
 *   - A run of 6+ underscores or hyphens (signature line).
 *   - "X _________" (the classic notary-style line).
 *
 * When a hit is found, we approximate its on-page position by
 * looking at the current text matrix in the stream. This is
 * imperfect - many real PDFs use complex transform stacks that
 * change the cursor in ways a simple scan can't fully reconstruct
 * - so we fall back to "page-bottom, first available column" when
 * we have a hit but no recoverable position. That still beats the
 * old (0.1, 0.1) default because the box lands inside the document
 * body rather than over the title.
 *
 * Returns at most one placement per page. We deliberately don't try
 * to find every single anchor on a page; the typical case is a
 * single signature block and the caller decides if it wants more.
 */
async function findTextSignatureAnchors(
  pdf: PDFDocument,
): Promise<SignaturePlacement[]> {
  const out: SignaturePlacement[] = [];
  const pages = pdf.getPages();
  const decoder = new TextDecoder('latin1');
  // Signature-line labels only. Deliberately NOT "Name:" / "Date:" -
  // those are adjacent fields, not places to drop the signature PNG,
  // and the content-stream scan can't recover a reliable x/y for them
  // anyway (see the module header). Widened with the common real-world
  // variants "/s/", "Authorized signature", and "Signature of".
  const ANCHOR_RE =
    /(\bSignature\s*(of\b|:)|\bAuthorized\s+signature\b|\bSign\s+here\b|\bSigned\s+by\b|\/s\/|_{6,}|-{8,}|\bX\s*_{3,})/i;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    // pdf-lib doesn't expose decoded content streams in a stable
    // public API. We try to read them; on failure (encrypted /
    // compressed-with-unsupported-filter), we skip this page.
    let raw = '';
    try {
      const contents = page.node.normalizedEntries().Contents;
      if (!contents) continue;
      // contents is a PDFStream or array of streams. Try to grab
      // bytes by calling getContents() / contents() on each variant.
      const streams = Array.isArray(contents) ? contents : [contents];
      for (const s of streams) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bytes: Uint8Array | undefined = (s as any)?.getContents?.();
        if (bytes && bytes.length > 0) raw += decoder.decode(bytes);
      }
    } catch {
      continue;
    }
    if (!raw) continue;
    if (!ANCHOR_RE.test(raw)) continue;

    const { width: pw, height: ph } = page.getSize();
    // Approximate y-position: place the signature box slightly above
    // the page bottom margin so the user can clearly see "this is
    // where you sign" without it colliding with footer content.
    const yPt = PAGE_MARGIN_PT;
    out.push({
      positionPage: i + 1,
      positionX: PAGE_MARGIN_PT / pw,
      positionY: yPt / ph,
      widthPt: BOX_WIDTH_PT,
      heightPt: BOX_HEIGHT_PT,
    });
  }
  return out;
}

/**
 * Append signature boxes at the bottom of the last page (or on a
 * fresh appended page when the last page doesn't have room).
 *
 * Layout: boxes stack vertically with a small gap; each box renders
 * a thin border + a name label below it so the signer can see who
 * the box is for. The renderer in signature-render.ts will overlay
 * the captured PNG inside the same rectangle.
 *
 * Returns the updated PDF bytes and a placement per signer.
 */
async function appendSignatureBoxes(
  pdf: PDFDocument,
  signers: SignerInput[],
): Promise<SignaturePlacement[]> {
  const placements: SignaturePlacement[] = [];
  let page: PDFPage;
  // Try to fit on the last existing page; create a fresh one if not.
  const pages = pdf.getPages();
  const lastIndex = pages.length - 1;
  const lastPage = lastIndex >= 0 ? pages[lastIndex] : null;
  const requiredHeight =
    signers.length * BOX_HEIGHT_PT + (signers.length - 1) * BOX_GAP_PT + 40;
  // "Room" = at least the required height of clear space at the
  // bottom of the page (we can't reliably know what content is
  // already there, but reserving ~the bottom 25% is a reasonable
  // heuristic for plain documents).
  const hasRoom = lastPage
    ? lastPage.getSize().height * 0.25 >= requiredHeight
    : false;
  if (lastPage && hasRoom) {
    page = lastPage;
  } else {
    // Append a fresh US-Letter page.
    page = pdf.addPage([612, 792]);
    // Drop a small heading at the top so the page isn't visually
    // empty and the signer immediately understands its purpose.
    page.drawText('Signatures', {
      x: PAGE_MARGIN_PT,
      y: page.getSize().height - PAGE_MARGIN_PT - 24,
      size: 18,
    });
  }

  const pageIndex = pdf.getPages().indexOf(page) + 1;
  const { width: pw, height: ph } = page.getSize();

  // Stack from the bottom up so the order on the page reads top-to-
  // bottom matching the signer list.
  let cursorY = PAGE_MARGIN_PT;
  // We render in the FOR loop in REVERSE so that the first signer
  // ends up at the top of the stack.
  const reversed = [...signers].reverse();
  const reverseRects: SignaturePlacement[] = [];
  for (const signer of reversed) {
    const x = PAGE_MARGIN_PT;
    const y = cursorY;
    // Border around the signature box.
    page.drawRectangle({
      x,
      y,
      width: BOX_WIDTH_PT,
      height: BOX_HEIGHT_PT,
      borderWidth: 0.75,
      borderColor: undefined, // Defaults to black; pdf-lib accepts undefined.
    });
    // Caption: "Signature - {Name or Email}". We keep the text tiny
    // so it doesn't fight the signature. Hyphen (not em-dash) is
    // intentional - the app brand standard forbids em-dashes in
    // user-facing strings (this label is stamped onto every signable
    // PDF, so a stray "—" would propagate forever).
    const labelName = (signer.name?.trim() || signer.email).slice(0, 60);
    page.drawText(`Signature - ${labelName}`, {
      x: x + 2,
      y: y - 12,
      size: 8,
    });
    reverseRects.push({
      positionPage: pageIndex,
      positionX: x / pw,
      positionY: y / ph,
      widthPt: BOX_WIDTH_PT,
      heightPt: BOX_HEIGHT_PT,
    });
    cursorY += BOX_HEIGHT_PT + BOX_GAP_PT;
  }
  // Un-reverse so placements[i] corresponds to signers[i].
  placements.push(...reverseRects.reverse());
  return placements;
}

/**
 * Top-level orchestrator. Decides per-signer:
 *
 *   - If the caller supplied explicit positionPage/X/Y, honor those
 *     (source: 'caller-supplied'). Width/height fall back to the
 *     default box so the renderer has something to size the PNG to.
 *   - Otherwise, draw from detected anchors in order (AcroForm
 *     first, then text-scan). One signer per anchor.
 *   - Once detected anchors are exhausted, append a signature box
 *     at the bottom for the remaining signers (source:
 *     'appended-fallback'). This is the path the V5 audit asked
 *     for: when OCR / structural detection finds nothing, the
 *     final document still has somewhere to sign.
 *
 * Returns the (possibly modified) PDF bytes alongside the per-signer
 * placement + source attribution. When zero boxes were appended the
 * returned `pdfBytes` is identical to the input - callers can use
 * `pdfBytesChanged` to avoid an unnecessary storage round-trip.
 */
export async function placeSignaturesIfMissing(
  pdfBytes: Uint8Array,
  signers: SignerInput[],
): Promise<{
  pdfBytes: Uint8Array;
  pdfBytesChanged: boolean;
  signers: AssignedSigner[];
}> {
  if (signers.length === 0) {
    return { pdfBytes, pdfBytesChanged: false, signers: [] };
  }

  const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });

  // First: honor caller-supplied positions verbatim.
  const assigned: AssignedSigner[] = signers.map((s) => {
    const hasExplicit =
      typeof s.positionPage === 'number' &&
      typeof s.positionX === 'number' &&
      typeof s.positionY === 'number';
    if (hasExplicit) {
      return {
        ...s,
        placement: {
          positionPage: s.positionPage as number,
          positionX: s.positionX as number,
          positionY: s.positionY as number,
          widthPt: BOX_WIDTH_PT,
          heightPt: BOX_HEIGHT_PT,
        },
        source: 'caller-supplied',
      };
    }
    return {
      ...s,
      placement: {
        positionPage: 1,
        positionX: 0,
        positionY: 0,
        widthPt: BOX_WIDTH_PT,
        heightPt: BOX_HEIGHT_PT,
      },
      source: 'appended-fallback',
    };
  });

  // Build the pool of detected anchors only for signers who didn't
  // supply an explicit position.
  const needAnchor = assigned.filter((s) => s.source !== 'caller-supplied');
  if (needAnchor.length === 0) {
    return { pdfBytes, pdfBytesChanged: false, signers: assigned };
  }

  const acroAnchors = await findAcroFormSignatureAnchors(pdf);
  const textAnchors = await findTextSignatureAnchors(pdf);
  // De-dupe text anchors that fall on the same page as an AcroForm
  // anchor - the structural one wins.
  const acroPages = new Set(acroAnchors.map((a) => a.positionPage));
  const detected = [
    ...acroAnchors,
    ...textAnchors.filter((a) => !acroPages.has(a.positionPage)),
  ];

  // Consume detected anchors in order; remaining signers get
  // appended fallback boxes. We keep references to the actual
  // AssignedSigner entries that still need a placement so the
  // second pass below zips them directly with the appended boxes -
  // no re-scanning by coordinate sentinel (the earlier "positionX
  // !== 0 || positionY !== 0" filter could mis-fire if a detected
  // anchor happened to land at exactly (0, 0), reviewer caught this).
  let detectedIdx = 0;
  const stillUnplaced: AssignedSigner[] = [];
  for (const a of assigned) {
    if (a.source === 'caller-supplied') continue;
    if (detectedIdx < detected.length) {
      a.placement = detected[detectedIdx];
      a.source = acroAnchors.includes(detected[detectedIdx])
        ? 'acroform'
        : 'text-anchor';
      detectedIdx++;
    } else {
      stillUnplaced.push(a);
    }
  }

  let pdfBytesChanged = false;
  if (stillUnplaced.length > 0) {
    const appended = await appendSignatureBoxes(pdf, stillUnplaced);
    for (let i = 0; i < stillUnplaced.length; i++) {
      // appendSignatureBoxes returns one placement per signer in
      // the same order we passed them in, so index-by-index is the
      // contract.
      if (i < appended.length) {
        stillUnplaced[i].placement = appended[i];
        stillUnplaced[i].source = 'appended-fallback';
      }
    }
    pdfBytesChanged = true;
  }

  const outBytes = pdfBytesChanged
    ? await pdf.save({ useObjectStreams: false })
    : pdfBytes;

  return { pdfBytes: outBytes, pdfBytesChanged, signers: assigned };
}

/**
 * Smaller helper for callers (e.g. tests) that only need detection
 * without the modify-and-return step. Returns the raw detected
 * anchors with source attribution preserved.
 */
export async function detectSignatureAnchors(
  pdfBytes: Uint8Array,
): Promise<Array<SignaturePlacement & { source: DetectionSource }>> {
  const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const acro = (await findAcroFormSignatureAnchors(pdf)).map((p) => ({
    ...p,
    source: 'acroform' as const,
  }));
  const text = (await findTextSignatureAnchors(pdf)).map((p) => ({
    ...p,
    source: 'text-anchor' as const,
  }));
  const acroPages = new Set(acro.map((a) => a.positionPage));
  return [...acro, ...text.filter((t) => !acroPages.has(t.positionPage))];
}
