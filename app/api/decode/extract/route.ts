import { NextResponse, type NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// OCR / vision on scanned docs can take a while; give it room.
export const maxDuration = 60;

/**
 * Decoder file intake. Accepts an attached document and returns the
 * text it contains so the Decoder can explain it in plain English -
 * the same output as pasting, but the person no longer has to retype
 * a letter that arrived as a PDF, a Word file, or a phone photo.
 *
 * Extraction strategy by type:
 *   - PDF          -> unpdf text layer; if it's a scan with no text
 *                     layer, hand the PDF to the vision model to read.
 *   - Word (.docx) -> mammoth raw-text extraction.
 *   - Plain text   -> decoded as UTF-8 (txt / md / csv / rtf-ish).
 *   - Images       -> vision model transcribes every word it can see.
 *
 * We also take a best-effort guess at the document's language so the
 * UI can say "Looks like Spanish" - the decode step itself handles any
 * language regardless.
 *
 * Nothing is persisted: the bytes are read in memory, text is returned,
 * and the buffer is dropped when the request ends.
 */

const MAX_BYTES = 20 * 1024 * 1024; // 20MB - generous for a scan or photo
const VISION_MODEL = 'claude-sonnet-4-6';
// Media types the vision model can read directly.
const VISION_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

type ExtractKind = 'pdf' | 'pdf-scan' | 'word' | 'text' | 'image';

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  // Heavier than a paste (parsing + possible vision call), so a tighter
  // cap than /api/decode.
  if (!(await checkRateLimit(`decode-extract:${ip}`, { limit: 8, windowSeconds: 60 }))) {
    return NextResponse.json(
      { error: 'One file at a time - give it a moment.' },
      { status: 429 },
    );
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get('file');
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: 'Could not read the upload.' }, { status: 400 });
  }
  if (!file) {
    return NextResponse.json({ error: 'Attach a file to read.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'That file is larger than 20MB. Try a smaller file or split it up.' },
      { status: 413 },
    );
  }

  const name = (file.name || '').toLowerCase();
  const declaredType = (file.type || '').toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());

  // Sniff the true type from the first bytes rather than trusting the
  // extension/declared MIME alone.
  const sig = sniff(buf);
  const isPdf = sig === 'pdf' || declaredType === 'application/pdf' || name.endsWith('.pdf');
  const isDocx =
    sig === 'zip-ooxml-docx' ||
    declaredType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.docx');
  const isImage =
    sig === 'jpeg' || sig === 'png' || sig === 'gif' || sig === 'webp' ||
    declaredType.startsWith('image/');
  const isPlainText =
    sig === 'text' ||
    declaredType.startsWith('text/') ||
    /\.(txt|md|markdown|csv|tsv|log|rtf)$/.test(name);

  try {
    if (isPdf) {
      const text = await extractPdfText(buf);
      if (text && text.trim().length >= 20) {
        return ok(text, 'pdf');
      }
      // No usable text layer -> almost certainly a scan. Read it with
      // the vision model (Claude reads PDFs natively).
      const visionText = await visionReadPdf(buf);
      return ok(visionText, 'pdf-scan');
    }

    if (isDocx) {
      const mammoth = (await import('mammoth')).default;
      const { value } = await mammoth.extractRawText({ buffer: buf });
      return ok(value, 'word');
    }

    if (isImage) {
      if (!VISION_IMAGE_TYPES.has(normalizeImageType(sig, declaredType))) {
        return NextResponse.json(
          {
            error:
              'That image format is not supported yet (HEIC in particular). ' +
              'Save it as JPEG or PNG and try again, or type the text out.',
          },
          { status: 415 },
        );
      }
      const text = await visionReadImage(buf, normalizeImageType(sig, declaredType));
      return ok(text, 'image');
    }

    if (isPlainText) {
      const text = buf.toString('utf8');
      return ok(text, 'text');
    }

    // Legacy Office (.doc/.ppt/.xls) and other binaries we can't parse.
    return NextResponse.json(
      {
        error:
          "We can't read that format yet. Advottic reads PDF, Word (.docx), " +
          'plain text, and photos/scans. For PowerPoint or older Office files, ' +
          'export to PDF first, or copy the text and paste it.',
      },
      { status: 415 },
    );
  } catch (err) {
    console.error('[decode/extract] failed', err);
    return NextResponse.json(
      { error: "We couldn't read that file. Try a different format, or paste the text." },
      { status: 500 },
    );
  }
}

function ok(rawText: string, kind: ExtractKind) {
  const text = (rawText || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length < 1) {
    return NextResponse.json(
      { error: "We opened the file but couldn't find any readable text in it." },
      { status: 422 },
    );
  }
  // Guard the response size - the Decoder textarea + model don't need a
  // whole book. Keep the front matter, which is where deadlines live.
  const MAX_CHARS = 60_000;
  const truncated = text.length > MAX_CHARS;
  return NextResponse.json({
    text: truncated ? text.slice(0, MAX_CHARS) : text,
    kind,
    language: guessLanguage(text),
    truncated,
  });
}

/** unpdf text-layer extraction (no OCR). Returns '' on any failure. */
async function extractPdfText(buf: Buffer): Promise<string> {
  try {
    const { getDocumentProxy, extractText } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join('\n') : String(text ?? '');
  } catch {
    return '';
  }
}

function client(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

const OCR_PROMPT =
  'Transcribe ALL text visible in this document, exactly as written, ' +
  'preserving line breaks, headings, numbers, dates, and dollar amounts. ' +
  'Do not summarize, translate, explain, or add commentary - output only ' +
  'the transcription. If some text is illegible, write [illegible] in its place.';

/** Read a photo/scan of a document with the vision model. */
async function visionReadImage(buf: Buffer, mediaType: string): Promise<string> {
  const c = client();
  if (!c) throw new Error('vision unavailable');
  const res = await c.messages.create({
    model: VISION_MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
              data: buf.toString('base64'),
            },
          },
          { type: 'text', text: OCR_PROMPT },
        ],
      },
    ],
  });
  return textFrom(res);
}

/** Read a scanned (no-text-layer) PDF with the vision model. */
async function visionReadPdf(buf: Buffer): Promise<string> {
  const c = client();
  if (!c) throw new Error('vision unavailable');
  const res = await c.messages.create({
    model: VISION_MODEL,
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: buf.toString('base64'),
            },
          },
          { type: 'text', text: OCR_PROMPT },
        ],
      },
    ],
  });
  return textFrom(res);
}

function textFrom(res: Anthropic.Messages.Message): string {
  return res.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** First-bytes signature sniff. */
function sniff(buf: Buffer): string {
  if (buf.length < 4) return 'unknown';
  const b = buf;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf'; // %PDF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (
    b.length >= 12 &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'webp';
  // OOXML (docx/xlsx/pptx) are ZIP archives (PK\x03\x04). We only
  // parse docx; the caller falls back on extension for the specifics.
  if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05)) {
    return 'zip-ooxml-docx';
  }
  // Heuristic "is this printable text": sample the first chunk.
  const sample = b.subarray(0, Math.min(b.length, 512));
  let printable = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 128) {
      printable++;
    }
  }
  if (printable / sample.length > 0.9) return 'text';
  return 'unknown';
}

function normalizeImageType(sig: string, declared: string): string {
  if (sig === 'jpeg') return 'image/jpeg';
  if (sig === 'png') return 'image/png';
  if (sig === 'gif') return 'image/gif';
  if (sig === 'webp') return 'image/webp';
  return declared;
}

/**
 * Best-effort language guess for the UI badge. Script detection first
 * (covers most non-Latin cases decisively), then a small stop-word
 * vote for common Latin-script languages. Returns a display name or
 * null when we're not confident.
 */
function guessLanguage(text: string): string | null {
  const t = text.slice(0, 2000);
  if (/[一-鿿]/.test(t)) return 'Chinese';
  if (/[぀-ヿ]/.test(t)) return 'Japanese';
  if (/[가-힣]/.test(t)) return 'Korean';
  if (/[؀-ۿ]/.test(t)) return 'Arabic';
  if (/[Ѐ-ӿ]/.test(t)) return 'Russian / Cyrillic';
  if (/[ऀ-ॿ]/.test(t)) return 'Hindi';
  if (/[֐-׿]/.test(t)) return 'Hebrew';

  const lower = ` ${t.toLowerCase().replace(/[^\p{L}\s]/gu, ' ')} `;
  const has = (words: string[]) =>
    words.reduce((n, w) => n + (lower.includes(` ${w} `) ? 1 : 0), 0);
  const scores: Record<string, number> = {
    English: has(['the', 'and', 'you', 'court', 'notice', 'must', 'shall', 'your']),
    Spanish: has(['el', 'la', 'usted', 'tribunal', 'debe', 'notificación', 'demanda', 'audiencia']),
    French: has(['le', 'la', 'vous', 'tribunal', 'doit', 'avis', 'audience', 'votre']),
    Portuguese: has(['você', 'tribunal', 'deve', 'notificação', 'audiência', 'processo', 'seu']),
    German: has(['der', 'die', 'und', 'sie', 'gericht', 'muss', 'ihre', 'frist']),
  };
  let best: string | null = null;
  let bestScore = 1; // require at least 2 hits to claim a language
  for (const [lang, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }
  return best;
}
