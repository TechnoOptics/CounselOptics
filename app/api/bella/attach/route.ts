import { NextRequest, NextResponse } from 'next/server';
import { extractFileText } from '@/lib/doc-review';
import { checkRateLimit } from '@/lib/rate-limit';

// unpdf + mammoth need the Node runtime (not edge).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/**
 * Normalizes a file the user attached to a Bella chat into something the
 * model can read: a base64 image (for Bella's vision) or extracted text
 * (for PDFs / Word docs / plain text). The chat client then passes the
 * result back to /api/bella as the turn's `attachment`.
 *
 * Copy here is plain and reassuring, because people use Bella during stressful
 * situations, so errors stay calm and tell them exactly what to try next.
 */
export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  if (!(await checkRateLimit(`bella-attach:${ip}`, { limit: 8, windowSeconds: 60 }))) {
    return NextResponse.json(
      { error: 'Just a moment. Please wait before attaching another file.' },
      { status: 429 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: 'Please choose a file to attach.' },
      { status: 400 },
    );
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: 'Please choose a file to attach.' },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'That file is over 10 MB. Please attach a smaller one.' },
      { status: 400 },
    );
  }

  const name = file.name || 'attachment';
  const imageType = imageMediaType(file.type, name);

  // Images → base64 so Bella can look at them directly.
  if (imageType) {
    const data = Buffer.from(await file.arrayBuffer()).toString('base64');
    return NextResponse.json({ kind: 'image', name, mediaType: imageType, data });
  }

  // Documents → extracted text.
  const { text, error } = await extractFileText(file);
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }
  if (!text.trim()) {
    return NextResponse.json(
      {
        error:
          'I could not find readable text in that file. If it is a scan or photo, please attach it as an image instead.',
      },
      { status: 400 },
    );
  }
  return NextResponse.json({ kind: 'text', name, text: text.slice(0, 20000) });
}

function imageMediaType(type: string, name: string): ImageMediaType | null {
  const t = (type || '').toLowerCase();
  if (t === 'image/jpeg' || t === 'image/jpg') return 'image/jpeg';
  if (t === 'image/png') return 'image/png';
  if (t === 'image/gif') return 'image/gif';
  if (t === 'image/webp') return 'image/webp';
  const n = name.toLowerCase();
  if (/\.(jpe?g)$/.test(n)) return 'image/jpeg';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.gif')) return 'image/gif';
  if (n.endsWith('.webp')) return 'image/webp';
  return null;
}
