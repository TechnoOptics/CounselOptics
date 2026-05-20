import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { createApiToken } from '@/lib/api-tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/watch/link/approve-by-pair   body: { pairCode }
 *
 * Authenticated (Supabase session) - called from the in-app
 * /pair-watch page in the phone app. Looks up the active (pending,
 * unexpired) watch_link_codes row by its 6-digit pair_code, mints a
 * read-scoped `adv_` token bound to the current user, and parks it
 * for the watch's next poll. The watch picks it up within a few
 * seconds and starts syncing.
 *
 * Built specifically so a user who is already signed in to the
 * phone app never has to sign in AGAIN to pair their watch - the
 * QR + /link-watch web flow forced a second sign-in roundtrip that
 * failed regularly because the mail-client / OAuth round-trip
 * stripped the PKCE verifier. Typing 6 digits sidesteps every one
 * of those failure modes.
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'Auth is not configured.' },
      { status: 503 },
    );
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  }

  let body: { pairCode?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const pairCodeRaw = (body.pairCode ?? '').trim();
  // Strip any whitespace / dashes the user might have typed for
  // readability ("482 913" or "482-913"). The DB stores the raw
  // 6 digits.
  const pairCode = pairCodeRaw.replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(pairCode)) {
    return NextResponse.json(
      { error: 'Enter the 6-digit code shown on your watch.' },
      { status: 400 },
    );
  }

  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: 'Server misconfigured.' },
      { status: 500 },
    );
  }

  const { data: row, error: readErr } = await admin
    .from('watch_link_codes')
    .select('code, pair_code, status, expires_at')
    .eq('pair_code', pairCode)
    .eq('status', 'pending')
    .maybeSingle();
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json(
      {
        error:
          "That code doesn't match an active pairing session. Open Advottic on your watch, tap Link a watch, and read the fresh 6-digit code.",
      },
      { status: 404 },
    );
  }
  if (new Date((row as { expires_at: string }).expires_at) < new Date()) {
    return NextResponse.json(
      {
        error:
          'That code expired. Open Advottic on your watch and tap Link a watch again to generate a new one.',
      },
      { status: 410 },
    );
  }

  const created = await createApiToken({
    name: 'Wear OS watch',
    userId: user.id,
    scopes: ['read'],
  });
  if (!created) {
    return NextResponse.json(
      { error: 'Could not issue a watch token.' },
      { status: 500 },
    );
  }

  const { error: updErr } = await admin
    .from('watch_link_codes')
    .update({
      status: 'approved',
      user_id: user.id,
      issued_token: created.token,
      approved_at: new Date().toISOString(),
    })
    .eq('pair_code', pairCode)
    .eq('status', 'pending');
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
