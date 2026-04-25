import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import {
  UPLOADS_DIR,
  getExhibitById,
  getExhibitSignedUrl,
  usingSupabase,
} from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const exhibit = await getExhibitById(params.id);
  if (!exhibit) {
    return new NextResponse('Not found', { status: 404 });
  }

  if (usingSupabase()) {
    const signedUrl = await getExhibitSignedUrl(exhibit.storedFileName);
    if (!signedUrl) {
      return new NextResponse('Not found', { status: 404 });
    }
    return NextResponse.redirect(signedUrl, { status: 302 });
  }

  // Local mode — serve from disk
  const safeName = path.basename(exhibit.storedFileName);
  const filePath = path.join(UPLOADS_DIR, safeName);
  if (path.dirname(filePath) !== UPLOADS_DIR) {
    return new NextResponse('Not found', { status: 404 });
  }
  let buf: Buffer;
  try {
    buf = await fs.readFile(filePath);
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

  return new NextResponse(ab, {
    status: 200,
    headers: {
      'Content-Type': exhibit.fileType || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${encodeURIComponent(exhibit.fileName)}"`,
      'Cache-Control': 'private, max-age=0, must-revalidate',
    },
  });
}
