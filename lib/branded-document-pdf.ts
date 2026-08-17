import 'server-only';

import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { cleanLegalText } from './legal-templates';
import { isWinAnsiEncodable } from './counterparty-fields';
import {
  DEFAULT_DOCUMENT_LAYOUT,
  bandAppearsOnPage,
  composeFooterText,
  resolveContentBox,
  resolveFooterPlacement,
  resolveLetterheadArt,
  resolveLetterheadChrome,
  resolveLetterheadBandTop,
  resolveWatermark,
  resolveWatermarkPlacement,
  type DocumentLayout,
  type DocumentState,
} from './document-layout';
import {
  LETTERHEAD_LINE_GAP_PT,
  letterheadDesignLines,
  type LetterheadDesign,
} from './letterhead-design';
import { fontRejectionReason, type DocumentTypeface } from './document-typeface';
import {
  COUNTERPARTY_BLOCK_LINES,
  findCounterpartyBlockLine,
  findSignatureBlockLine,
} from './firm-template-placeholders';
import {
  FIELD_RULE,
  RENDERED_PAGE_HEIGHT_PT,
  RENDERED_PAGE_WIDTH_PT,
  findLineMarkers,
  resolveMarkerBoxWidth,
  type FieldBox,
} from './template-field-boxes';
import { formatDateNumeric } from './format';
import { accentTextOnDocument } from './accent-text';

/**
 * The firm-branded document PDF: letterhead (or a letterhead synthesized from
 * the firm's logo, or a text banner), title block, and the wrapped body.
 *
 * Lifted verbatim out of app/api/counsel/draft-template/pdf/route.ts, which
 * now calls it, so the SERVER can render the very same document when an
 * approved template submission is released to its recipient. One renderer, so
 * what the legal team approved and what the recipient receives cannot drift.
 *
 * IT ALSO RECORDS WHERE IT PUT THE COUNTERPARTY'S BLANKS
 * -----------------------------------------------------
 * The other side of an agreement has parts of it to supply, and those values
 * arrive after the firm has approved the wording and after the bytes have
 * been hashed into the audit chain. They therefore cannot reach the page by
 * re-rendering it: this renderer is not deterministic (see the footer, and
 * PDFDocument.create stamping a fresh CreationDate), so a second render is
 * different bytes and a different SHA-256, and the chain would attest to a
 * document nobody saw.
 *
 * So the values are drawn into boxes recorded HERE, at the one moment this
 * loop drew them, and read back by both the live overlay on the signing page
 * and the stamp on the executed PDF. The arithmetic is available because the
 * layout is ours: a fixed page, one margin, one size, one lead, and a
 * line-by-line drawText walk. lib/template-field-boxes.ts owns the shape of
 * the record and every rectangle derived from it.
 *
 * A THIRD CALLER WOULD NEED A GATE OF ITS OWN. The two that exist
 * (app/api/counsel/draft-template/pdf and lib/submission-document.ts) each
 * decide who may render before they get here. Nothing in this module asks.
 */

/** The platform forest, used when a firm's accent is missing or unusable. */
const FALLBACK_ACCENT = '#0f2d24';

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hexToRgb(FALLBACK_ACCENT);
  const n = parseInt(m[1], 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}

/**
 * The firm's accent, normalized to one hex before anything reads it.
 *
 * Two things now derive from it and they must derive from the SAME value: the
 * bar, which keeps the firm's exact colour, and the ink, which may not. An
 * unusable accent that fell back to the forest for one and to Advottic gold for
 * the other would print a green bar over a gold name.
 */
function accentHexOf(input: unknown): string {
  const raw = String(input ?? '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(raw) ? raw : FALLBACK_ACCENT;
}

/**
 * Drop every character pdf-lib's standard fonts cannot draw.
 *
 * Dropped rather than substituted: a firm's own address is not a place to
 * guess at a replacement, and a missing glyph is a visible defect the legal
 * team can correct in the designer, whereas a wrong one is not.
 */
function winAnsiSafe(value: string): string {
  return Array.from(value)
    .filter((ch) => isWinAnsiEncodable(ch))
    .join('')
    .trim();
}

/**
 * The design with every field reduced to what the standard fonts can draw.
 *
 * Per FIELD, before letterheadDesignLines composes anything, so a field that
 * disappears entirely is simply an absent field and the layout omits it the
 * way it omits one the firm never filled in. An address line that empties out
 * is dropped rather than left as a blank line.
 */
function winAnsiSafeDesign(design: LetterheadDesign): LetterheadDesign {
  return {
    ...design,
    firmName: winAnsiSafe(design.firmName),
    addressLines: design.addressLines
      .map(winAnsiSafe)
      .filter((line) => line.length > 0),
    phone: winAnsiSafe(design.phone),
    email: winAnsiSafe(design.email),
    website: winAnsiSafe(design.website),
    admissionsLine: winAnsiSafe(design.admissionsLine),
  };
}

export type BrandedDocumentInput = {
  /** The document body. Cleaned before rendering. */
  document: string;
  title?: string;
  brandName?: string;
  accent?: string;
  /** Public URL of the firm's letterhead image (PNG/JPG). */
  letterheadUrl?: string;
  /**
   * The letterhead the firm DESIGNED in the app, drawn as real vector text.
   *
   * Used only when there is no uploaded image: a firm that has both has told
   * us twice what its stationery looks like, and the scan of the real thing is
   * the more authoritative of the two answers. Callers read this out of
   * `firms.metadata` through firmLetterheadDesign().
   */
  letterheadDesign?: LetterheadDesign | null;
  /** Public URL of the firm's logo, used when there is no letterhead. */
  logoUrl?: string;
  /**
   * The signer's drawn, typed or uploaded mark, drawn directly above the
   * signature block. Optional: a document with no mark still renders, and the
   * `Signed:` line is a valid signature on its own.
   */
  signatureImage?: { png: Uint8Array };
  /**
   * Where the letterhead, watermark and footer sit, already resolved from the
   * firm default and any template override by resolveDocumentLayout.
   *
   * Absent means DEFAULT_DOCUMENT_LAYOUT, which is the layout this renderer
   * had before any of it was configurable, to the point. That is what makes an
   * un-configured firm's next document identical to its last one.
   *
   * A LAYOUT CANNOT MOVE A DOCUMENT THAT ALREADY EXISTS. It is an input to a
   * render, and a rendered document's bytes and the geometry of its
   * counterparty blanks are both stored at that one moment
   * (lib/submission-document.ts). Nothing re-renders a stored document, so a
   * firm editing its layout changes only what the NEXT document looks like.
   */
  layout?: DocumentLayout;
  /**
   * Where this document is in its life, which is what decides whether the
   * watermark appears. The caller is the only thing that knows.
   *
   * Absent means 'unsigned', the honest default: nothing has been signed.
   */
  state?: DocumentState;
  /**
   * The face the BODY of the document is set in, read out of firms.metadata by
   * firmDocumentTypeface(). Absent or null means Times, which is what every
   * document this product has produced was set in.
   *
   * A TYPEFACE CANNOT RESTYLE A DOCUMENT THAT ALREADY EXISTS, for the same
   * reason a layout cannot: a rendered document's bytes and the geometry of its
   * counterparty blanks are both stored at the one moment it was drawn
   * (lib/submission-document.ts), and nothing re-renders a stored document. A
   * firm changing its typeface changes only what the NEXT document looks like.
   */
  typeface?: DocumentTypeface | null;
};

/** The box the mark is fitted inside, in points. */
const MARK_W = 200;
const MARK_H = 56;
/** Space between the mark and the printed name underneath it. */
const MARK_GAP = 12;
/**
 * Lines the signature block occupies: Signed, Date, Email. The mark is
 * reserved together with all three, because a mark alone at the foot of one
 * page with the name it belongs to at the head of the next reads as a defect.
 */
const SIG_BLOCK_LINES = 3;

/** What a letterhead's bytes say it is, regardless of what its server claimed. */
type ArtworkKind = 'pdf' | 'png' | 'jpg' | 'unsupported';

/**
 * Identify the artwork from its leading bytes.
 *
 * Preferred over the Content-Type header because storage serves back whatever it
 * was handed at upload time: a firm's PDF stationery uploaded through a form that
 * did not set the type arrives as application/octet-stream, and a header-only
 * decision sends it to embedPng, which throws. Magic numbers cannot be mis-tagged.
 *
 * Null means "these bytes are not one of the three", which is not the same as
 * unsupported: the caller falls back to the declared type, because a truncated
 * read should not masquerade as a WebP.
 */
function sniffArtwork(bytes: Uint8Array): ArtworkKind | null {
  if (bytes.length < 4) return null;
  // %PDF
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return 'pdf';
  }
  // \x89 P N G
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png';
  }
  // JPEG SOI + marker
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  // RIFF....WEBP. Named rather than lumped in with the unknown, because WebP is
  // the type a real firm reaches this path with: the upload action accepts it and
  // pdf-lib cannot draw it.
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'unsupported';
  }
  return null;
}

/** The pair of faces a document is set in: body, and headings. */
type DocumentFaces = {
  regular: Awaited<ReturnType<PDFDocument['embedFont']>>;
  bold: Awaited<ReturnType<PDFDocument['embedFont']>>;
  /** Why the firm's own typeface is not on this document, when it should be. */
  error?: string;
};

/**
 * The faces this document is set in.
 *
 * TIMES UNLESS THE FIRM HAS UPLOADED ITS OWN, AND TIMES AGAIN WHENEVER THE
 * FIRM'S CANNOT BE USED. The decision is made BEFORE anything is embedded, on
 * purpose: pdf-lib writes every font handed to embedFont into the saved file
 * whether or not a single glyph of it was drawn, so embedding Times first and
 * the firm's face afterwards would ship both in every document and leave the
 * file claiming a typeface it never used.
 *
 * SUBSET, NOT THE WHOLE FILE. Measured on a real face: 6,080 bytes against
 * 32,322 for the same one-page document. It is also the narrower licensing
 * position, because only the glyphs the document actually uses travel with it
 * rather than the firm's complete commercial font.
 *
 * The risk subsetting carries in THIS codebase is text extraction, and it is
 * why lib/signature-anchor-text.ts exists at all: a subset face stores text as
 * glyph indices, so a reader that cannot map them back finds no signature line
 * and opens a signed document on the wrong page. pdf-lib writes a ToUnicode
 * CMap for custom fonts, so components/DocumentPdfDeck.tsx still finds every
 * label. That is not taken on trust; it is asserted against a real embedded
 * font in tests/branded-document-typeface.test.ts.
 *
 * A REFUSAL CARRIES A REASON. Every path that cannot use the firm's face
 * returns Times AND a reason, on the output and in an operator log line, which
 * is exactly the contract letterheadError has.
 *
 * BE CLEAR ABOUT WHAT THAT DOES AND DOES NOT BUY TODAY. Nothing in app/ or
 * components/ reads letterheadError, and nothing reads this either: grep both
 * before believing otherwise. So the reason currently reaches an operator
 * reading logs, and NOT the firm. That is a real gap for both fields and it is
 * worth closing, but closing it is a UI change to the callers rather than
 * something this module can do, and shipping the field is what makes it
 * possible at all.
 *
 * It is still not THROWN, for the reason every other fallback in this renderer
 * is not thrown: a document in the wrong face is recoverable, and a document
 * that does not render is not, and the counterparty is waiting on it.
 *
 * fontkit is imported dynamically so a firm that has set no typeface, which is
 * every firm today, never pulls it into the render path at all.
 */
async function resolveDocumentFaces(
  pdf: PDFDocument,
  typeface: DocumentTypeface | null | undefined,
): Promise<DocumentFaces> {
  const times = async (error?: string): Promise<DocumentFaces> => ({
    regular: await pdf.embedFont(StandardFonts.TimesRoman),
    bold: await pdf.embedFont(StandardFonts.TimesRomanBold),
    ...(error ? { error } : {}),
  });

  if (!typeface?.regularUrl) return times();

  /** Fetch one weight and check its BYTES, never its Content-Type. */
  async function fetchFace(
    url: string,
  ): Promise<{ bytes: Uint8Array } | { reason: string }> {
    try {
      const r = await fetch(url);
      if (!r.ok) {
        return { reason: `The typeface could not be fetched (HTTP ${r.status}).` };
      }
      const bytes = new Uint8Array(await r.arrayBuffer());
      // Storage serves back whatever contentType it was handed at upload, so a
      // mis-tagged font arrives as application/octet-stream. The bytes cannot
      // be mis-tagged. Same rule as the letterhead above.
      const rejection = fontRejectionReason(bytes);
      return rejection ? { reason: rejection } : { bytes };
    } catch {
      return {
        reason: 'The typeface could not be read. The file may be damaged.',
      };
    }
  }

  const regular = await fetchFace(typeface.regularUrl);
  if ('reason' in regular) return times(regular.reason);

  let fontkit: unknown;
  try {
    fontkit = (await import('@pdf-lib/fontkit')).default;
  } catch {
    return times('This server cannot embed custom typefaces.');
  }

  let regularFont: DocumentFaces['regular'];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pdf.registerFontkit(fontkit as any);
    regularFont = await pdf.embedFont(regular.bytes, { subset: true });
  } catch {
    // A file whose magic bytes are right but whose tables are not. Reported
    // rather than thrown, and the document still goes out.
    return times('This typeface could not be embedded. The file may be damaged.');
  }

  // THE BOLD WEIGHT IS OPTIONAL AND FALLS BACK TO THE REGULAR ONE.
  //
  // Not synthesised. pdf-lib has no synthetic-bold API, and faking one by
  // stroking the glyphs changes their advance widths, which would move every
  // heading and every counterparty blank measured after it. A heading set in
  // the regular weight is a mild loss; a smeared heading on an instrument
  // somebody is being asked to sign is a different kind of problem.
  //
  // Falling back to the REGULAR weight rather than to Times-Bold is the other
  // half of the same judgement: one firm face throughout reads as a typographic
  // choice, whereas the firm's face for the body and Times for the headings
  // reads as a rendering fault.
  if (!typeface.boldUrl) return { regular: regularFont, bold: regularFont };

  const boldBytes = await fetchFace(typeface.boldUrl);
  if ('reason' in boldBytes) {
    return {
      regular: regularFont,
      bold: regularFont,
      error: `The bold weight was not used. ${boldBytes.reason}`,
    };
  }
  try {
    return {
      regular: regularFont,
      bold: await pdf.embedFont(boldBytes.bytes, { subset: true }),
    };
  } catch {
    return {
      regular: regularFont,
      bold: regularFont,
      error: 'The bold weight could not be embedded. The file may be damaged.',
    };
  }
}

/** The declared type, used only when the bytes were inconclusive. */
function kindFromMime(mime: string): ArtworkKind {
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  return 'unsupported';
}

export type BrandedDocumentOutput = {
  bytes: Uint8Array;
  /**
   * Why the firm's letterhead is not on this document, when it should have been.
   *
   * Undefined in the two ordinary cases: the letterhead was drawn, or the firm has
   * none. Set only when a letterhead was configured and could not be used, which
   * is a defect the firm has to learn about. See the comment at the fetch.
   */
  letterheadError?: string;
  /**
   * Why the firm's typeface is not on this document, when it should have been.
   *
   * Undefined in the two ordinary cases: the firm's face was used, or the firm
   * has not set one. Set only when a typeface was configured and could not be
   * used. Same contract as letterheadError above, INCLUDING its current limit:
   * no caller reads either field yet, so the reason reaches the operator log
   * and not the firm. See resolveDocumentFaces.
   */
  typefaceError?: string;
  /**
   * Where every counterparty blank landed, in the order they were drawn.
   * Empty for every document with no counterparty fields on its template,
   * which is every document this product has produced so far.
   */
  fieldBoxes: FieldBox[];
};

/**
 * Returns the PDF bytes and the recorded blanks, or null when there is
 * nothing worth rendering.
 */
export async function buildBrandedDocumentPdf(
  input: BrandedDocumentInput,
): Promise<BrandedDocumentOutput | null> {
  const text = cleanLegalText(String(input.document ?? ''));
  if (text.length < 100) return null;
  const title = String(input.title ?? 'Document').slice(0, 120);
  const brand = String(input.brandName ?? 'Advottic').slice(0, 80);
  const accentHex = accentHexOf(input.accent);
  const accent = hexToRgb(accentHex);
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setProducer(brand);
  // The faces, decided before anything is embedded. See resolveDocumentFaces.
  const faces = await resolveDocumentFaces(pdf, input.typeface);
  const font = faces.regular;
  const bold = faces.bold;
  const typefaceError = faces.error;
  if (typefaceError) {
    // The operator's half. The firm's half is the returned field.
    console.error('[typeface] not used on a document:', typefaceError);
  }

  // Imported rather than declared, because lib/template-field-boxes.ts has to
  // bound a stored coordinate against the page it was recorded on and two
  // copies of the page size is the drift that module exists to prevent.
  const W = RENDERED_PAGE_WIDTH_PT;
  const H = RENDERED_PAGE_HEIGHT_PT;
  const PAGE = { widthPt: W, heightPt: H };
  const layout = input.layout ?? DEFAULT_DOCUMENT_LAYOUT;
  const state: DocumentState = input.state ?? 'unsigned';
  // The measure, from the one module that computes one. The builder preview
  // calls the same function against the same page, which is what stops it from
  // telling a firm something the document will not do.
  const content = resolveContentBox(layout, PAGE);
  const M = content.xPt; // left margin
  const SIZE = 11;
  const LEAD = 16;
  const maxW = content.widthPt;
  /** Where the body stops and a new page starts. */
  const FLOOR = content.bottomYPt;
  /** The top edge of the letterhead band, which every offset inside it hangs
   *  from. Flush to the page top unless the firm has pushed it down. */
  const BAND_TOP = resolveLetterheadBandTop(layout, PAGE);
  /** The bar and every other FILL: the firm's colour, exactly as it typed it. */
  const accentColor = rgb(accent.r, accent.g, accent.b);
  /**
   * The firm's name, as INK.
   *
   * A colour chosen to work as a fill is usually unreadable as text, and this
   * page is paper: pdf-lib leaves it unpainted, so the ground is white. Drawn in
   * the raw accent, Advottic's own gold measured 1.87:1 here and a firm gold of
   * #c79532 measured 2.70:1, against an AA floor of 4.5:1 - on the document that
   * goes to the client and into the court file, not on a screen anyone can zoom.
   *
   * accentTextOnDocument keeps the firm's exact hex whenever it already clears
   * the floor on paper, which is most dark accents including the platform
   * forest, and derives a legible one only when it does not. It is the same
   * function both counsel studios call, which is what stops the preview from
   * advertising ink the document will not use.
   */
  const accentInkRgb = hexToRgb(accentTextOnDocument(accentHex));
  const accentInk = rgb(accentInkRgb.r, accentInkRgb.g, accentInkRgb.b);
  const ink = rgb(0.1, 0.1, 0.1);

  /**
   * The firm's stationery: a raster image, or a PDF page.
   *
   * A PDF IS EMBEDDED AS VECTOR, not rasterised. The address line on real
   * stationery is around 6.5pt type, which is exactly the size at which
   * rasterising shows, and rasterising would also put a canvas rasteriser into a
   * latency-sensitive serverless render path. embedPdf keeps the artwork's own
   * curves and text.
   *
   * The artwork's own dimensions travel with it, because resolveLetterheadArt
   * needs them and because a PDF page and an image report them differently.
   */
  type Artwork =
    | {
        kind: 'image';
        image: Awaited<ReturnType<PDFDocument['embedPng']>>;
        artWidthPt: number;
        artHeightPt: number;
      }
    | {
        kind: 'page';
        page: Awaited<ReturnType<PDFDocument['embedPdf']>>[number];
        artWidthPt: number;
        artHeightPt: number;
      };

  let letterhead: Artwork | null = null;
  /**
   * WHY A FAILED LETTERHEAD IS REPORTED.
   *
   * This block used to catch everything and fall through to the text banner, and
   * that silence is how a firm's stationery could vanish from an executed
   * document with nothing recorded anywhere. A PDF forced into letterhead_url
   * sniffed as a PNG, threw inside embedPng, was caught here, and produced a
   * document that was indistinguishable from one belonging to a firm that had
   * never uploaded a letterhead at all.
   *
   * It is still not thrown. A document that renders without its letterhead is
   * recoverable; a document that does not render is not, and the counterparty is
   * waiting on it. So the render continues and the reason travels back to the
   * caller on the output, and to the operator through the log line below.
   */
  let letterheadError: string | undefined;
  if (input.letterheadUrl && /^https?:\/\//i.test(input.letterheadUrl)) {
    try {
      const r = await fetch(input.letterheadUrl);
      if (!r.ok) {
        letterheadError = `The letterhead could not be fetched (HTTP ${r.status}).`;
      } else {
        const buf = new Uint8Array(await r.arrayBuffer());
        const declared = (r.headers.get('content-type') ?? '').toLowerCase();
        // SNIFFED FROM THE BYTES FIRST, with the header only as a fallback.
        // Storage serves back whatever contentType it was handed at upload, so a
        // mis-tagged upload arrives as application/octet-stream and a header-only
        // decision sends a PDF to embedPng. The bytes cannot be mis-tagged.
        const kind = sniffArtwork(buf) ?? kindFromMime(declared);
        if (kind === 'pdf') {
          const [embedded] = await pdf.embedPdf(buf, [0]);
          letterhead = {
            kind: 'page',
            page: embedded,
            artWidthPt: embedded.width,
            artHeightPt: embedded.height,
          };
        } else if (kind === 'jpg' || kind === 'png') {
          const image =
            kind === 'jpg' ? await pdf.embedJpg(buf) : await pdf.embedPng(buf);
          letterhead = {
            kind: 'image',
            image,
            artWidthPt: image.width,
            artHeightPt: image.height,
          };
        } else {
          // WebP is the case that reaches here from a real upload: the upload
          // action accepts it and pdf-lib cannot draw it. Naming the type is the
          // difference between a firm fixing its letterhead and a firm never
          // knowing it has no letterhead.
          letterheadError =
            `This letterhead is ${declared || 'of an unrecognised type'}, which cannot be ` +
            'drawn on a document. Upload it as a PDF, PNG or JPG.';
        }
      }
    } catch (err) {
      letterhead = null;
      letterheadError =
        'This letterhead could not be read. It may be damaged or password protected.';
      void err;
    }
  }
  if (letterheadError) {
    // The operator's half. The firm's half is the returned field, which the
    // caller surfaces.
    console.error('[letterhead] not drawn on a document:', letterheadError);
  }

  // No uploaded letterhead? Draw the one the firm designed, if it has one.
  //
  // Sanitized first, and this is not decoration: pdf-lib's standard fonts
  // encode WinAnsi only, and a character outside it is not dropped quietly but
  // THROWN mid-render, which would take the whole document down over a curly
  // apostrophe pasted out of Word. The predicate is the shared one from
  // lib/counterparty-fields.ts so "encodable" means one thing in this codebase.
  // Latin-1 survives intact, so this is not a rule against accented names.
  //
  // THE FIELDS ARE CLEANED, NOT THE COMPOSED LINES, and the difference is two
  // defects. Cleaning the finished lines left a firm whose website was outside
  // Latin-1 with "phone  -  email  -", a separator pointing at nothing;
  // letterheadDesignLines already omits an empty field, so composing from
  // cleaned fields never produces the dangling form in the first place.
  //
  // And it left something worse. A firm whose NAME is outside Latin-1 but
  // whose address is not lost only the name line, the list was still not
  // empty, so this branch was still taken and the document went out carrying a
  // return address with no idea whose it was. A letterhead with no firm name
  // on it is not a degraded letterhead, it is a wrong document, so the design
  // is refused entirely and the logo and banner fallbacks below get their
  // turn. The designer warns about the dropped characters at the moment they
  // are typed, which is the other half of this fix.
  const safeDesign =
    !letterhead && input.letterheadDesign
      ? winAnsiSafeDesign(input.letterheadDesign)
      : null;
  const designLines = safeDesign?.firmName
    ? letterheadDesignLines(safeDesign)
    : [];
  const designAlignment = safeDesign?.alignment ?? 'left';
  const designRule = safeDesign?.showRule ?? true;

  /**
   * The firm's logo, fetched and embedded at most once.
   *
   * Two callers want it now: the synthesized letterhead below, and a watermark
   * whose source is the logo. Fetching it twice would be two network calls for
   * one image and, worse, two embedded copies in the same file.
   */
  type LogoImage = Awaited<ReturnType<PDFDocument['embedPng']>>;
  let logoImage: LogoImage | null = null;
  let logoLoaded = false;
  async function loadLogoImage(): Promise<LogoImage | null> {
    if (logoLoaded) return logoImage;
    logoLoaded = true;
    if (!input.logoUrl || !/^https?:\/\//i.test(input.logoUrl)) return null;
    try {
      const r = await fetch(input.logoUrl);
      if (!r.ok) return null;
      const buf = new Uint8Array(await r.arrayBuffer());
      const mime = (r.headers.get('content-type') ?? '').toLowerCase();
      // pdf-lib decodes PNG + JPG only; SVG/WebP logos fall through to the
      // text banner.
      if (!mime.includes('png') && !mime.includes('jpeg') && !mime.includes('jpg')) {
        return null;
      }
      logoImage =
        mime.includes('jpeg') || mime.includes('jpg')
          ? await pdf.embedJpg(buf)
          : await pdf.embedPng(buf);
      return logoImage;
    } catch {
      return null;
    }
  }

  // No uploaded letterhead? Synthesize one from the firm's logo (#13).
  // The logo is drawn small at the top-left with the brand name beside
  // it, over the accent rule - a clean "generated letterhead".
  //
  // The logo keeps its own scaled width and height rather than going through
  // resolveLetterheadArt, because it is not stationery: it is one element of a
  // banner this renderer composes, sized to 36pt tall and set beside the brand
  // name. Only the firm's OWN artwork is the letterhead whose placement is shared.
  type Embedded = {
    img: Awaited<ReturnType<PDFDocument['embedPng']>>;
    width: number;
    height: number;
  };
  let logo: Embedded | null = null;
  if (!letterhead && designLines.length === 0) {
    const img = await loadLogoImage();
    if (img) {
      const targetH = 36;
      const ratio = targetH / img.height;
      const drawW = Math.min(180, img.width * ratio);
      const drawH = drawW * (img.height / img.width);
      logo = { img, width: drawW, height: drawH };
    }
  }

  /**
   * The watermark for THIS document's state, or nothing.
   *
   * Resolved once, before the first page, because the state rule cannot change
   * partway through a document. Null is the ordinary answer: the mark is off by
   * default, and it is off in the signed state by the rule the owner chose.
   *
   * The text is sanitized here for the same reason the letterhead design is.
   * pdf-lib's standard fonts do not drop a character WinAnsi cannot encode,
   * they THROW from inside drawText, and a watermark of Cyrillic would take
   * down every document the firm produces. A mark that empties out is no mark,
   * which is the right outcome: a document without a watermark is recoverable,
   * a document that failed to render is not.
   */
  const watermark = resolveWatermark(layout, state);
  const watermarkText = watermark ? winAnsiSafe(watermark.text) : '';
  const watermarkLogo =
    watermark && watermark.source === 'logo' ? await loadLogoImage() : null;
  const watermarkDrawable =
    watermark && (watermark.source === 'logo' ? watermarkLogo !== null : watermarkText !== '')
      ? watermark
      : null;

  function wrap(line: string, f = font, size = SIZE): string[] {
    if (line.trim() === '') return [''];
    const words = line.split(/(\s+)/);
    const out: string[] = [];
    let cur = '';
    for (const w of words) {
      const test = cur + w;
      if (f.widthOfTextAtSize(test, size) > maxW && cur.trim()) {
        out.push(cur.replace(/\s+$/, ''));
        cur = w.replace(/^\s+/, '');
      } else {
        cur = test;
      }
    }
    if (cur.trim() || out.length === 0) out.push(cur);
    return out;
  }

  let page = pdf.addPage([W, H]);
  let y = 0;
  let pageNo = 0;

  /**
   * The watermark, drawn BEHIND everything else on the page.
   *
   * Behind is not a preference. pdf-lib paints in call order, so this has to
   * run before the letterhead and before the first line of body text, or the
   * mark would sit on top of the words at eight percent opacity and make them
   * harder to read rather than easier. It is called from the top of header(),
   * which is the first thing every page does.
   *
   * It advances no cursor and reserves no space, which is what keeps it from
   * moving a single counterparty blank.
   */
  function drawWatermark() {
    if (!watermarkDrawable) return;
    if (!bandAppearsOnPage(watermarkDrawable.pages, pageNo)) return;
    // Both sources are measured as "how tall is the mark", so the one Size
    // control in the builder means the same thing whichever is chosen.
    //
    // For text that is the height of the INK, not of the em box. A 96 point em
    // box is about half again as tall as the capitals inside it and the
    // baseline sits at its foot, so centring the em box hangs the letters
    // visibly low and, once the mark is turned, visibly to one side as well.
    // Centring what a reader can actually see is the only version of "centred"
    // worth having. This is why the placement function takes a measurement
    // rather than a point size: only this module has the font.
    const markHeightPt = watermarkLogo
      ? watermarkDrawable.sizePt
      : bold.heightAtSize(watermarkDrawable.sizePt, { descender: false });
    const markWidthPt = watermarkLogo
      ? (watermarkLogo.width / watermarkLogo.height) * watermarkDrawable.sizePt
      : bold.widthOfTextAtSize(watermarkText, watermarkDrawable.sizePt);
    const at = resolveWatermarkPlacement({ layout, page: PAGE, markWidthPt, markHeightPt });
    const common = {
      x: at.xPt,
      y: at.yPt,
      opacity: at.opacity,
      rotate: degrees(at.rotationDeg),
    };
    if (watermarkLogo) {
      page.drawImage(watermarkLogo, { ...common, width: markWidthPt, height: markHeightPt });
      return;
    }
    page.drawText(watermarkText, {
      ...common,
      size: watermarkDrawable.sizePt,
      font: bold,
      color: rgb(0.45, 0.45, 0.45),
    });
  }

  function header() {
    pageNo += 1;
    drawWatermark();
    // WHAT goes at the top of this page is resolveLetterheadChrome's decision,
    // not this function's, because the builder preview has to reach the same
    // answer and a second copy of the branch is how the two drift apart.
    const chrome = resolveLetterheadChrome({
      layout,
      pageNo,
      hasArtwork: letterhead !== null,
    });
    if (chrome === 'none') {
      // No band on this page. The body starts at the top margin, which is the
      // only thing that can tell it where to start once the band is gone.
      y = content.topYPt;
    } else if (letterhead) {
      // Painted letterhead path. WHERE the artwork goes is resolveLetterheadArt's
      // decision, for both fits, so the preview and this renderer cannot end up
      // with two opinions about it. The band arithmetic that used to sit inline
      // here now lives there, unchanged.
      const art = resolveLetterheadArt({
        layout,
        page: PAGE,
        artWidthPt: letterhead.artWidthPt,
        artHeightPt: letterhead.artHeightPt,
      });
      const box = {
        x: art.xPt,
        y: art.yPt,
        width: art.widthPt,
        height: art.heightPt,
      };
      // A zero-size rectangle is artwork with no dimensions. Skipped rather than
      // handed to pdf-lib, which would draw it somewhere unpredictable.
      if (art.widthPt > 0 && art.heightPt > 0) {
        if (letterhead.kind === 'page') {
          page.drawPage(letterhead.page, box);
        } else {
          page.drawImage(letterhead.image, box);
        }
      }
      if (chrome === 'artwork-page') {
        // FULL-PAGE STATIONERY GETS NO RULE AND NO CURSOR OF ITS OWN. The sheet
        // already says where the body starts, in ink the firm's designer chose,
        // so the body starts at the top margin like it does on a page with no
        // band at all. A separator line drawn across somebody's stationery would
        // be this renderer editing their design.
        //
        // It follows that the margins are what keep the body clear of the
        // artwork: the delivered Zinpro sheet carries its logo down to 124pt from
        // the top, so that firm's layout sets a top margin past it. There is
        // nothing here that could find that number on its own, and a renderer
        // guessing at where somebody's logo ends is worse than a setting.
        y = content.topYPt;
      } else {
        // The thin separator below the band is kept so the body still feels
        // structurally tied to the header.
        const yTop = art.yPt;
        page.drawLine({
          start: { x: M, y: yTop - 14 },
          end: { x: content.rightXPt, y: yTop - 14 },
          thickness: 0.5,
          color: rgb(0.8, 0.8, 0.8),
        });
        y = yTop - 38;
      }
    } else if (designLines.length > 0) {
      // The designed letterhead, drawn as real text. It stays crisp at any
      // zoom and needs no image asset at all. The order and the weights come
      // from letterheadDesignLines, which the on-screen preview also reads, so
      // the two cannot describe different stationery.
      page.drawRectangle({ x: 0, y: BAND_TOP - 8, width: W, height: 8, color: accentColor });
      let lineY = BAND_TOP - 34;
      let lastY = lineY;
      for (const line of designLines) {
        const lineFont = line.bold ? bold : font;
        const width = lineFont.widthOfTextAtSize(line.text, line.size);
        page.drawText(line.text, {
          x: designAlignment === 'center' ? Math.max(M, (W - width) / 2) : M,
          y: lineY,
          size: line.size,
          font: lineFont,
          color: line.bold ? accentInk : rgb(0.35, 0.35, 0.35),
        });
        lastY = lineY;
        lineY -= line.size + LETTERHEAD_LINE_GAP_PT;
      }
      if (designRule) {
        page.drawLine({
          start: { x: M, y: lastY - 12 },
          end: { x: content.rightXPt, y: lastY - 12 },
          thickness: 0.5,
          color: rgb(0.8, 0.8, 0.8),
        });
      }
      y = lastY - 36;
    } else if (logo) {
      // Synthesized letterhead from the firm's logo (#13). Accent bar,
      // logo at top-left, brand name to its right, then the rule.
      page.drawRectangle({
        x: 0,
        y: BAND_TOP - 8,
        width: W,
        height: 8,
        color: accentColor,
      });
      const logoY = BAND_TOP - 30 - logo.height;
      page.drawImage(logo.img, {
        x: M,
        y: logoY,
        width: logo.width,
        height: logo.height,
      });
      page.drawText(brand, {
        x: M + logo.width + 12,
        y: logoY + logo.height / 2 - 5,
        size: 13,
        font: bold,
        color: accentInk,
      });
      page.drawLine({
        start: { x: M, y: logoY - 12 },
        end: { x: content.rightXPt, y: logoY - 12 },
        thickness: 0.5,
        color: rgb(0.8, 0.8, 0.8),
      });
      y = logoY - 34;
    } else {
      // Text-only fallback (pre-tier-2 look, kept for firms that
      // haven't uploaded a letterhead yet).
      page.drawRectangle({
        x: 0,
        y: BAND_TOP - 8,
        width: W,
        height: 8,
        color: accentColor,
      });
      page.drawText(brand.toUpperCase(), {
        x: M,
        y: BAND_TOP - 40,
        size: 10,
        font: bold,
        color: accentInk,
      });
      page.drawText(title, {
        x: M,
        y: BAND_TOP - 58,
        size: 9,
        font,
        color: rgb(0.4, 0.4, 0.4),
      });
      page.drawLine({
        start: { x: M, y: BAND_TOP - 70 },
        end: { x: content.rightXPt, y: BAND_TOP - 70 },
        thickness: 0.5,
        color: rgb(0.8, 0.8, 0.8),
      });
      y = BAND_TOP - 96;
    }
  }
  /**
   * The footer line, composed by lib/document-layout.ts and placed by it.
   *
   * Composed rather than assembled here, because the builder preview shows the
   * firm the same line and two hand-written versions of "brand, then generated,
   * then page" is how a preview starts disagreeing with the document. Empty
   * parts produce no separator: the letterhead contact line was fixed for
   * exactly that defect, a dangling `-` pointing at nothing.
   *
   * Sanitized here rather than in the composer, because the composer has no
   * imports and isWinAnsiEncodable lives in lib/counterparty-fields.ts. The
   * builder warns about the characters this drops at the moment they are typed,
   * which is the other half of the same fix the letterhead designer got.
   */
  function footer() {
    if (!layout.footer.show) return;
    if (!bandAppearsOnPage(layout.footer.pages, pageNo)) return;
    const line = winAnsiSafe(
      composeFooterText({
        layout,
        brandName: brand,
        pageNo,
        generatedOn: formatDateNumeric(Date.now()),
      }),
    );
    if (!line) return;
    const at = resolveFooterPlacement({
      layout,
      page: PAGE,
      textWidthPt: font.widthOfTextAtSize(line, layout.footer.sizePt),
    });
    // 0.46 rather than 0.55, found by rendering a letter and reading the ink
    // back out. This line carries the firm's name at 8pt, and the old grey
    // (#8c8c8c) measured 3.363:1 on the paper against an AA floor of 4.5:1, so
    // the firm's own name was under the floor in the footer as well as in the
    // letterhead. #757575 is 4.58:1 and is the darkest this can be while still
    // reading as a footer rather than as body text.
    page.drawText(line, {
      x: at.xPt,
      y: at.yPt,
      size: layout.footer.sizePt,
      font,
      color: rgb(0.46, 0.46, 0.46),
    });
  }
  function newPage() {
    footer();
    page = pdf.addPage([W, H]);
    header();
  }

  header();
  // Title block.
  for (const tl of wrap(title, bold, 20)) {
    page.drawText(tl, { x: M, y, size: 20, font: bold, color: ink });
    y -= 26;
  }
  y -= 10;

  // The signer's mark, and where it goes.
  //
  // A PNG that will not embed must not take the document down with it. A
  // document that goes out without a squiggle is recoverable; a document that
  // fails to go out is not, and the `Signed:` line is a valid signature by
  // itself.
  let mark: Awaited<ReturnType<PDFDocument['embedPng']>> | null = null;
  if (input.signatureImage?.png && input.signatureImage.png.length > 0) {
    try {
      mark = await pdf.embedPng(input.signatureImage.png);
    } catch {
      mark = null;
    }
  }
  // Located against the cleaned text, because that is the text this loop
  // draws. Every surface runs the same locator over the text it is about to
  // render, so all of them put the mark immediately above the signature block
  // even where cleaning has shifted the line numbers.
  const markLine = mark ? findSignatureBlockLine(text) : null;
  // The other side's execution block, located against the same cleaned text
  // for the same reason, and kept together for the same reason the mark and
  // its own block are: a "Signature:" at the foot of one page with the "Date:"
  // it belongs to at the head of the next reads as a broken document to a
  // company being asked to execute it.
  const counterpartyLine = findCounterpartyBlockLine(text);

  /** Draw the mark at the current cursor and drop the cursor below it. */
  function drawMark(img: NonNullable<typeof mark>) {
    try {
      // Reserve the mark, the gap and the line that follows it together, so
      // the mark never ends up on one page with the printed name on the next.
      if (y - (MARK_H + MARK_GAP + LEAD * SIG_BLOCK_LINES) < FLOOR) newPage();
      y -= MARK_H;
      const scale = Math.min(MARK_W / img.width, MARK_H / img.height);
      page.drawImage(img, {
        x: M,
        y,
        width: img.width * scale,
        height: img.height * scale,
      });
      y -= MARK_GAP;
    } catch {
      // Same reasoning as the embed above: keep the text, lose the picture.
    }
  }

  /**
   * Where each counterparty blank landed, recorded as it is drawn.
   *
   * This is arithmetic over values the loop already holds, and that is the
   * whole reason the boxes are recorded here rather than derived later: the
   * font, the size, the page and the cursor are only simultaneously true at
   * the instant drawText is called. Anything computed afterwards would be a
   * reconstruction, and a reconstruction of a position is exactly what
   * lib/signature-geometry.ts exists because of.
   */
  const fieldBoxes: FieldBox[] = [];

  /**
   * Distance from the text baseline down to the bottom of the blank's box.
   *
   * The underscores in the marker sit just below the baseline, and the
   * executed copy paints an opaque rectangle over this box before drawing
   * the value into it. A box that starts at the baseline would leave the
   * bottom of the rule showing under the typed value.
   */
  const FIELD_BOX_DESCENT = 4;

  /**
   * Draw one body line, and record and rule every blank on it.
   *
   * THE MARKER IS NEVER DRAWN. It is internal plumbing: it exists so this loop
   * can find, measure and record a blank at the one moment the font, the size,
   * the page and the cursor are simultaneously true. Drawing it put
   * `_____<<company_legal_name>>_____` on the face of an agreement an outside
   * party was being asked to execute. What goes on the page instead is the
   * rule the executed copy already draws over the same box
   * (lib/signature-render.ts), from the same numbers, so the blank the
   * counterparty is shown and the blank on the instrument they sign are one
   * blank in two states.
   *
   * The line is drawn in segments AROUND the blanks, each at the x it would
   * have occupied in a single full-line draw, measured on the original line.
   * Nothing is closed up: the wrap above and every recorded box are computed
   * from the marker's own width, so shortening the drawn run would move the
   * following words off the geometry recorded for them and the executed copy
   * would paint its opaque cover over the wrong text.
   */
  function drawBodyLine(line: string, lineFont: typeof font, baselineY: number): void {
    const markers = findLineMarkers(line);
    if (markers.length === 0) {
      page.drawText(line, { x: M, y: baselineY, size: SIZE, font: lineFont, color: ink });
      return;
    }
    /** Draw one run of ordinary text at its own place on the line. */
    const drawSegment = (from: number, to: number) => {
      const segment = line.slice(from, to);
      if (segment === '') return;
      page.drawText(segment, {
        x: M + lineFont.widthOfTextAtSize(line.slice(0, from), SIZE),
        y: baselineY,
        size: SIZE,
        font: lineFont,
        color: ink,
      });
    };

    let cursor = 0;
    for (const m of markers) {
      drawSegment(cursor, m.index);
      cursor = m.index + m.text.length;
      const prefix = line.slice(0, m.index);
      const rest = line.slice(cursor);
      const trailing = /^ */.exec(rest)?.[0] ?? '';
      const xFromMargin = lineFont.widthOfTextAtSize(prefix, SIZE);
      const box: FieldBox = {
        key: m.key,
        page: pageNo,
        x: M + xFromMargin,
        y: baselineY - FIELD_BOX_DESCENT,
        widthPt: resolveMarkerBoxWidth({
          markerWidthPt: lineFont.widthOfTextAtSize(m.text, SIZE),
          trailingSpaceWidthPt: lineFont.widthOfTextAtSize(trailing, SIZE),
          xFromMarginPt: xFromMargin,
          contentWidthPt: maxW,
          endsLine: rest.trim() === '',
        }),
        heightPt: LEAD,
        // The page this blank was measured on, recorded beside it. Every document
        // is Letter today, so this says what the constants already imply; it is
        // recorded because parseFieldBoxes bounds against it, and a yardstick that
        // is implied rather than written down is only correct until it is not.
        pageWidthPt: W,
        pageHeightPt: H,
      };
      fieldBoxes.push(box);
      page.drawLine({
        start: { x: box.x, y: box.y + FIELD_RULE.offsetYPt },
        end: { x: box.x + box.widthPt, y: box.y + FIELD_RULE.offsetYPt },
        thickness: FIELD_RULE.thicknessPt,
        color: rgb(FIELD_RULE.gray, FIELD_RULE.gray, FIELD_RULE.gray),
      });
    }
    drawSegment(cursor, line.length);
  }

  const paragraphs = text.split('\n');
  for (let p = 0; p < paragraphs.length; p += 1) {
    const para = paragraphs[p];
    if (mark && p === markLine) drawMark(mark);
    const lines = wrap(para);
    // Reserved as one unit. The head may wrap for a long entity name, so what
    // is reserved is the head as laid out plus the two fixed lines under it.
    if (
      p === counterpartyLine &&
      y - LEAD * (lines.length + COUNTERPARTY_BLOCK_LINES - 1) < FLOOR
    ) {
      newPage();
    }
    for (const ln of lines) {
      if (y < FLOOR) newPage();
      // Lightly bold lines that look like section headings.
      const isHead =
        /^(article|section)\b/i.test(ln.trim()) ||
        /^\s*\d+(\.\d+)*\.?\s+[A-Z]/.test(ln) ||
        (ln.trim().length > 0 &&
          ln.trim() === ln.trim().toUpperCase() &&
          ln.trim().length < 60);
      const lineFont = isHead ? bold : font;
      // Drawn and measured with one font, and after the page break above has
      // run, so the recorded page number is the page the text is on and not
      // the page it was queued from.
      drawBodyLine(ln, lineFont, y);
      y -= LEAD;
    }
  }

  // A reviewer may rewrite the signature block while editing the wording, and
  // the locator then finds nothing. The mark is not dropped: it goes at the end
  // of the body under a hairline rule, so the document still carries the mark
  // the employee made and it is visibly not part of the rewritten text.
  if (mark && markLine === null) {
    if (y - (MARK_H + MARK_GAP * 2 + LEAD) < FLOOR) newPage();
    y -= MARK_GAP;
    page.drawLine({
      start: { x: M, y },
      end: { x: M + MARK_W, y },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    });
    y -= MARK_GAP;
    drawMark(mark);
  }
  footer();

  // letterheadError is spread rather than always set, so a document whose
  // letterhead was fine carries no key at all and the two states stay
  // distinguishable to a caller that serializes this.
  return {
    bytes: await pdf.save(),
    fieldBoxes,
    ...(letterheadError ? { letterheadError } : {}),
    ...(typefaceError ? { typefaceError } : {}),
  };
}
