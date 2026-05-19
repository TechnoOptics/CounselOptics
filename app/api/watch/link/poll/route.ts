import { NextResponse, type NextRequest } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/watch/link/poll   body: { code }
 *
 * Unauthenticated - the high-entropy `code` IS the bearer of the
 * pairing. The watch polls this until the user approves on the web.
 *
 * Returns:
 *   { status: 'pending' }                  keep polling
 *   { status: 'expired' | 'not_found' }    restart pairing
 *   { status: 'approved', token: 'adv_..'} EXACTLY ONCE, then the
 *                                           token is nulled + the row
 *                                           marked consumed.
 *
 * The watch stores `token` and uses it as
 * `Authorization: Bearer <token>` against GET /api/v1/cases.
 */
export async function POST(req: NextRequest) {
  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: 'Server misconfigured.' },
      { status: 500 },
    );
  }

  let body: { code?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const code = (body.code ?? '').trim();
  if (!code) {
    return NextResponse.json({ error: 'Missing code.' }, { status: 400 });
  }

  const { data: row, error } = await admin
    .from('watch_link_codes')
    .select('status, issued_token, expires_at')
    .eq('code', code)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ status: 'not_found' });
  }

  const r = row as {
    status: string;
    issued_token: string | null;
    expires_at: string;
  };

  if (new Date(r.expires_at) < new Date()) {
    return NextResponse.json({ status: 'expired' });
  }
  if (r.status === 'pending') {
    return NextResponse.json({ status: 'pending' });
  }
  if (r.status === 'consumed' || !r.issued_token) {
    // Already delivered once. The token never re-issues.
    return NextResponse.json({ status: 'consumed' });
  }

  // status === 'approved' with a token still parked. Atomically claim
  // it: only one poll wins (guarded by status='approved'), then null
  // the token so it can never be read again.
  const token = r.issued_token;
  const { data: claimed, error: claimErr } = await admin
    .from('watch_link_codes')
    .update({ status: 'consumed', issued_token: null })
    .eq('code', code)
    .eq('status', 'approved')
    .select('code')
    .maybeSingle();
  if (claimErr) {
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }
  if (!claimed) {
    // Lost the race to a concurrent poll.
    return NextResponse.json({ status: 'consumed' });
  }

  return NextResponse.json({ status: 'approved', token });
}
