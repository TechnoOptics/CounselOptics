import { type NextRequest } from 'next/server';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { generateLetterDocx } from '@/lib/docx-export';
import {
  buildClosingLines,
  sanitizeLetterOptions,
} from '@/lib/letter-compose';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Word (.docx) download of a generated letter (#13). One-off export:
 * renders the letterhead + body + closing block and streams it back as
 * an attachment. The firm's own branding comes from the active-firm
 * context, not the request body, so it can't be spoofed.
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return new Response('Not available.', { status: 400 });
  }
  const user = await getCurrentUser();
  if (!user) return new Response('Sign in first.', { status: 401 });
  const ctx = await getActiveFirmContext();
  if (!ctx) return new Response('No active firm.', { status: 403 });

  let body: {
    title?: string;
    body?: string;
    options?: unknown;
    signerName?: string;
    signerTitle?: string;
    dateText?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid body.', { status: 400 });
  }
  const letterBody = String(body.body ?? '').trim();
  if (letterBody.length < 40) {
    return new Response('Nothing to export.', { status: 400 });
  }
  const title = String(body.title ?? 'Letter').slice(0, 120) || 'Letter';
  const options = sanitizeLetterOptions(body.options);
  const contactLine = ctx.firm.jurisdictions.length
    ? ctx.firm.jurisdictions.join(' · ')
    : null;

  let buffer: Buffer;
  try {
    buffer = await generateLetterDocx({
      firmName: ctx.firm.name,
      contactLine,
      accentHex: ctx.firm.accentColor,
      title,
      body: letterBody,
      closing: buildClosingLines(options, {
        signerName: String(body.signerName ?? '') || null,
        signerTitle: String(body.signerTitle ?? '') || null,
        dateText: String(body.dateText ?? '') || null,
      }),
    });
  } catch (e) {
    return new Response(
      e instanceof Error ? e.message : 'Could not render the letter.',
      { status: 500 },
    );
  }

  const safe =
    title.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '') || 'letter';
  return new Response(buffer as BodyInit, {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${safe}.docx"`,
      'Cache-Control': 'no-store',
    },
  });
}
