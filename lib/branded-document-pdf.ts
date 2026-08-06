import 'server-only';

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { cleanLegalText } from './legal-templates';
import { findSignatureBlockLine } from './firm-template-placeholders';

/**
 * The firm-branded document PDF: letterhead (or a letterhead synthesized from
 * the firm's logo, or a text banner), title block, and the wrapped body.
 *
 * Lifted verbatim out of app/api/counsel/draft-template/pdf/route.ts, which
 * now calls it, so the SERVER can render the very same document when an
 * approved template submission is released to its recipient. One renderer, so
 * what the legal team approved and what the recipient receives cannot drift.
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

export type BrandedDocumentInput = {
  /** The document body. Cleaned before rendering. */
  document: string;
  title?: string;
  brandName?: string;
  accent?: string;
  /** Public URL of the firm's letterhead image (PNG/JPG). */
  letterheadUrl?: string;
  /** Public URL of the firm's logo, used when there is no letterhead. */
  logoUrl?: string;
  /**
   * The signer's drawn, typed or uploaded mark, drawn directly above the
   * signature block. Optional: a document with no mark still renders, and the
   * `Signed:` line is a valid signature on its own.
   */
  signatureImage?: { png: Uint8Array };
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

/** Returns the PDF bytes, or null when there is nothing worth rendering. */
export async function buildBrandedDocumentPdf(
  input: BrandedDocumentInput,
): Promise<Uint8Array | null> {
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

  const W = 612;
  const H = 792;
  const M = 64; // margin
  const SIZE = 11;
  const LEAD = 16;
  const maxW = W - M * 2;
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

  // No uploaded letterhead? Synthesize one from the firm's logo (#13).
  // The logo is drawn small at the top-left with the brand name beside
  // it, over the accent rule - a clean "generated letterhead".
  let logo: Embedded | null = null;
  if (!letterhead && input.logoUrl && /^https?:\/\//i.test(input.logoUrl)) {
    try {
      const r = await fetch(input.logoUrl);
      if (r.ok) {
        const buf = new Uint8Array(await r.arrayBuffer());
        const mime = (r.headers.get('content-type') ?? '').toLowerCase();
        // pdf-lib decodes PNG + JPG only; SVG/WebP logos fall through
        // to the text banner.
        if (mime.includes('png') || mime.includes('jpeg') || mime.includes('jpg')) {
          const img =
            mime.includes('jpeg') || mime.includes('jpg')
              ? await pdf.embedJpg(buf)
              : await pdf.embedPng(buf);
          const targetH = 36;
          const ratio = targetH / img.height;
          const drawW = Math.min(180, img.width * ratio);
          const drawH = drawW * (img.height / img.width);
          logo = { img, width: drawW, height: drawH };
        }
      }
    } catch {
      logo = null;
    }
  }

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

  function header() {
    pageNo += 1;
    if (letterhead) {
      // Painted letterhead path. Center horizontally, anchor near
      // the top, then drop the body cursor below it. We skip the
      // text-only "BRAND NAME" banner since the letterhead is
      // already the brand statement. The thin separator line below
      // is kept so the body still feels structurally tied to the
      // header.
      const x = (W - letterhead.width) / 2;
      const yTop = H - 24 - letterhead.height;
      page.drawImage(letterhead.img, {
        x,
        y: yTop,
        width: letterhead.width,
        height: letterhead.height,
      });
      page.drawLine({
        start: { x: M, y: yTop - 14 },
        end: { x: W - M, y: yTop - 14 },
        thickness: 0.5,
        color: rgb(0.8, 0.8, 0.8),
      });
      y = yTop - 38;
    } else if (logo) {
      // Synthesized letterhead from the firm's logo (#13). Accent bar,
      // logo at top-left, brand name to its right, then the rule.
      page.drawRectangle({
        x: 0,
        y: H - 8,
        width: W,
        height: 8,
        color: accentColor,
      });
      const logoY = H - 30 - logo.height;
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
        end: { x: W - M, y: logoY - 12 },
        thickness: 0.5,
        color: rgb(0.8, 0.8, 0.8),
      });
      y = logoY - 34;
    } else {
      // Text-only fallback (pre-tier-2 look, kept for firms that
      // haven't uploaded a letterhead yet).
      page.drawRectangle({
        x: 0,
        y: H - 8,
        width: W,
        height: 8,
        color: accentColor,
      });
      page.drawText(brand.toUpperCase(), {
        x: M,
        y: H - 40,
        size: 10,
        font: bold,
        color: accentColor,
      });
      page.drawText(title, {
        x: M,
        y: H - 58,
        size: 9,
        font,
        color: rgb(0.4, 0.4, 0.4),
      });
      page.drawLine({
        start: { x: M, y: H - 70 },
        end: { x: W - M, y: H - 70 },
        thickness: 0.5,
        color: rgb(0.8, 0.8, 0.8),
      });
      y = H - 96;
    }
  }
  function footer() {
    page.drawText(
      `${brand}  -  Generated ${new Date().toLocaleDateString()}  -  Page ${pageNo}`,
      { x: M, y: 36, size: 8, font, color: rgb(0.55, 0.55, 0.55) },
    );
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

  /** Draw the mark at the current cursor and drop the cursor below it. */
  function drawMark(img: NonNullable<typeof mark>) {
    try {
      // Reserve the mark, the gap and the line that follows it together, so
      // the mark never ends up on one page with the printed name on the next.
      if (y - (MARK_H + MARK_GAP + LEAD * SIG_BLOCK_LINES) < 60) newPage();
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

  const paragraphs = text.split('\n');
  for (let p = 0; p < paragraphs.length; p += 1) {
    const para = paragraphs[p];
    if (mark && p === markLine) drawMark(mark);
    const lines = wrap(para);
    for (const ln of lines) {
      if (y < 60) newPage();
      // Lightly bold lines that look like section headings.
      const isHead =
        /^(article|section)\b/i.test(ln.trim()) ||
        /^\s*\d+(\.\d+)*\.?\s+[A-Z]/.test(ln) ||
        (ln.trim().length > 0 &&
          ln.trim() === ln.trim().toUpperCase() &&
          ln.trim().length < 60);
      page.drawText(ln, {
        x: M,
        y,
        size: SIZE,
        font: isHead ? bold : font,
        color: ink,
      });
      y -= LEAD;
    }
  }

  // A reviewer may rewrite the signature block while editing the wording, and
  // the locator then finds nothing. The mark is not dropped: it goes at the end
  // of the body under a hairline rule, so the document still carries the mark
  // the employee made and it is visibly not part of the rewritten text.
  if (mark && markLine === null) {
    if (y - (MARK_H + MARK_GAP * 2 + LEAD) < 60) newPage();
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

  return pdf.save();
}
