import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/watch/link/start
 *
 * Unauthenticated. The watch calls this to begin device-link pairing.
 * Returns a high-entropy `code`, the URL to show as a QR, and how
 * long / how often to poll. The watch shows the QR; the user opens it
 * on their (signed-in) phone and approves; the watch then polls
 * /api/watch/link/poll until it gets an `adv_` read token.
 *
 * No body required.
 */
export async function POST(req: NextRequest) {
  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: 'Server misconfigured.' },
      { status: 500 },
    );
  }

  const code = crypto.randomBytes(24).toString('base64url');
  const ttlSec = 600; // 10 minutes
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();

  const { error } = await admin.from('watch_link_codes').insert({
    code,
    status: 'pending',
    expires_at: expiresAt,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Prefer the configured public site URL so the QR always points at
  // the real host; fall back to the request origin.
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
    new URL(req.url).origin;

  return NextResponse.json({
    code,
    verifyUrl: `${base}/link-watch?code=${encodeURIComponent(code)}`,
    pollIntervalMs: 4000,
    expiresInSec: ttlSec,
  });
}
