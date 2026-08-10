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

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0.06, g: 0.18, b: 0.14 };
  const n = parseInt(m[1], 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
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

export type BrandedDocumentOutput = {
  bytes: Uint8Array;
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
  const accent = hexToRgb(String(input.accent ?? '#0f2d24'));
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setProducer(brand);
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);

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
  const accentColor = rgb(accent.r, accent.g, accent.b);
  const ink = rgb(0.1, 0.1, 0.1);

  // Letterhead image, if any. Fetched once, embedded once, and
  // painted on every page that calls header(). Robust to a missing
  // / failed URL: we just fall back to the text-only banner. The
  // image is normalised to a tight strip 1.4" tall so the first-page
  // body still fits the normal text content underneath.
  type Embedded = {
    img: Awaited<ReturnType<PDFDocument['embedPng']>>;
    width: number;
    height: number;
  };
  let letterhead: Embedded | null = null;
  if (input.letterheadUrl && /^https?:\/\//i.test(input.letterheadUrl)) {
    try {
      const r = await fetch(input.letterheadUrl);
      if (r.ok) {
        const buf = new Uint8Array(await r.arrayBuffer());
        const mime = (r.headers.get('content-type') ?? '').toLowerCase();
        // pdf-lib accepts only PNG and JPG. The upload action enforces
        // this; webp uploads would get rejected upstream so we don't
        // try to decode them here.
        const img = mime.includes('jpeg') || mime.includes('jpg')
          ? await pdf.embedJpg(buf)
          : await pdf.embedPng(buf);
        // Scale to 1.4" tall (100 pt), max width = full page minus
        // margins. The aspect ratio comes from the source so wide
        // letterheads sit wider; tall vertical strips (uncommon) cap
        // at full width.
        const targetH = 100;
        const ratio = targetH / img.height;
        const drawW = Math.min(W - 32, img.width * ratio);
        const drawH = drawW * (img.height / img.width);
        letterhead = { img, width: drawW, height: drawH };
      }
    } catch {
      // Network/decode failure: fall back silently to the text
      // banner so the user still gets a PDF.
      letterhead = null;
    }
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
    if (!layout.letterhead.show || !bandAppearsOnPage(layout.letterhead.pages, pageNo)) {
      // No band on this page. The body starts at the top margin, which is the
      // only thing that can tell it where to start once the band is gone.
      y = content.topYPt;
    } else if (letterhead) {
      // Painted letterhead path. Center horizontally, anchor near
      // the top, then drop the body cursor below it. We skip the
      // text-only "BRAND NAME" banner since the letterhead is
      // already the brand statement. The thin separator line below
      // is kept so the body still feels structurally tied to the
      // header.
      const x = (W - letterhead.width) / 2;
      const yTop = BAND_TOP - 24 - letterhead.height;
      page.drawImage(letterhead.img, {
        x,
        y: yTop,
        width: letterhead.width,
        height: letterhead.height,
      });
      page.drawLine({
        start: { x: M, y: yTop - 14 },
        end: { x: content.rightXPt, y: yTop - 14 },
        thickness: 0.5,
        color: rgb(0.8, 0.8, 0.8),
      });
      y = yTop - 38;
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
          color: line.bold ? accentColor : rgb(0.35, 0.35, 0.35),
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
        color: accentColor,
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
        color: accentColor,
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
    page.drawText(line, {
      x: at.xPt,
      y: at.yPt,
      size: layout.footer.sizePt,
      font,
      color: rgb(0.55, 0.55, 0.55),
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

  return { bytes: await pdf.save(), fieldBoxes };
}
