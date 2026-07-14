import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { loadShare, decryptDocument, unformatKey, isValidToken } from '@/lib/secure-share';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * Open a secure share. Public by design — the token (URL) and the key together
 * are the only credentials. POST { key }; on the correct key the decrypted PDF
 * is returned, otherwise 403. The key is never stored, so a wrong key fails via
 * the GCM auth tag rather than a lookup.
 */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const token = params.token;
  if (!isValidToken(token)) return NextResponse.json({ error: 'Invalid link.' }, { status: 404 });

  const admin = createAdminSupabase();
  if (!admin) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as { key?: string };
  const key = unformatKey(String(body.key || ''));
  if (!key) return NextResponse.json({ error: 'Enter the key from your email.' }, { status: 400 });

  const share = await loadShare(admin, token);
  if (!share) return NextResponse.json({ error: 'This link is no longer available.' }, { status: 404 });

  if (new Date(share.meta.expiresAt).getTime() < Date.now()) {
    return NextResponse.json({ error: 'This secure link has expired.' }, { status: 410 });
  }

  let pdf: Buffer;
  try {
    pdf = decryptDocument(share.blob, key);
  } catch {
    return NextResponse.json({ error: 'Incorrect key. Check the key in your email and try again.' }, { status: 403 });
  }

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${share.meta.filename.replace(/[^\w.-]+/g, '_')}"`,
      'Cache-Control': 'no-store',
    },
  });
}
