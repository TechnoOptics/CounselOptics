import { type NextRequest } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { cleanLegalText } from '@/lib/legal-templates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
  };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid body.', { status: 400 });
  }
  const text = cleanLegalText(String(body.document ?? ''));
  if (text.length < 100) {
    return new Response('Nothing to export.', { status: 400 });
  }
  const title = String(body.title ?? 'Document').slice(0, 120);
  const brand = String(body.brandName ?? body.firmName ?? 'Advottic').slice(
    0,
    80,
  );
  const accent = hexToRgb(String(body.accent ?? '#0f2d24'));

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
  if (body.letterheadUrl && /^https?:\/\//i.test(body.letterheadUrl)) {
    try {
      const r = await fetch(body.letterheadUrl);
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

  for (const para of text.split('\n')) {
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
  footer();

  const bytes = await pdf.save();
  const safe =
    title.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '') || 'document';
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safe}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
