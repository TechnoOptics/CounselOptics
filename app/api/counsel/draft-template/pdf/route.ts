import { type NextRequest } from 'next/server';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { buildBrandedDocumentPdf } from '@/lib/branded-document-pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
    /** Optional public URL of the firm's logo. When no letterhead is
     *  set, Advottic synthesizes a letterhead from the logo + brand
     *  name (#13 "Advottic can customize one using their logo"). */
    logoUrl?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid body.', { status: 400 });
  }

  const title = String(body.title ?? 'Document').slice(0, 120);
  const bytes = await buildBrandedDocumentPdf({
    document: String(body.document ?? ''),
    title,
    brandName: body.brandName ?? body.firmName,
    accent: body.accent,
    letterheadUrl: body.letterheadUrl,
    logoUrl: body.logoUrl,
  });
  if (!bytes) return new Response('Nothing to export.', { status: 400 });

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
