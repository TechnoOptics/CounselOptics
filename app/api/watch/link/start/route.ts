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
/**
 * Generate a fresh 6-digit pair_code that isn't already claimed by
 * another active (pending) row. The unique partial index on the
 * column enforces uniqueness atomically; we just retry a few times
 * on the rare collision. After ~10 attempts the population of
 * concurrent active codes would have to be absurdly large for the
 * loop to fail - return null in that case and the caller decides
 * how to surface it.
 */
async function freshPairCode(
  admin: NonNullable<ReturnType<typeof createAdminSupabase>>,
): Promise<string | null> {
  for (let i = 0; i < 10; i++) {
    // 6-digit zero-padded number, e.g. "048291". Uniformly random
    // across 1_000_000 buckets so collisions during normal load are
    // exceptionally rare.
    const n = crypto.randomInt(0, 1_000_000);
    const candidate = String(n).padStart(6, '0');
    const { data } = await admin
      .from('watch_link_codes')
      .select('pair_code')
      .eq('pair_code', candidate)
      .eq('status', 'pending')
      .maybeSingle();
    if (!data) return candidate;
  }
  return null;
}

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
  const pairCode = await freshPairCode(admin);
  if (!pairCode) {
    return NextResponse.json(
      {
        error:
          'Could not allocate a pairing code (too many active codes). Try again in a few seconds.',
      },
      { status: 503 },
    );
  }

  const { error } = await admin.from('watch_link_codes').insert({
    code,
    pair_code: pairCode,
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
    pairCode,
    verifyUrl: `${base}/link-watch?code=${encodeURIComponent(code)}`,
    pollIntervalMs: 4000,
    expiresInSec: ttlSec,
  });
}
