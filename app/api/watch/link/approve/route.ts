import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { createApiToken } from '@/lib/api-tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/watch/link/approve   body: { code }
 *
 * Authenticated (Supabase session) - called from the /link-watch page
 * the user opened from the watch's QR. Mints a read-scoped `adv_`
 * token bound to the signed-in user and parks it on the pairing row
 * for the watch's next poll. The token is what the watch uses against
 * the existing GET /api/v1/cases.
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

  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: 'Server misconfigured.' },
      { status: 500 },
    );
  }

  const { data: row, error: readErr } = await admin
    .from('watch_link_codes')
    .select('code, status, expires_at')
    .eq('code', code)
    .maybeSingle();
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json(
      { error: 'This pairing code was not found.' },
      { status: 404 },
    );
  }
  if (new Date((row as { expires_at: string }).expires_at) < new Date()) {
    return NextResponse.json(
      { error: 'This pairing code has expired. Restart pairing on the watch.' },
      { status: 410 },
    );
  }
  if ((row as { status: string }).status !== 'pending') {
    return NextResponse.json(
      { error: 'This pairing code has already been used.' },
      { status: 409 },
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
    .eq('code', code)
    .eq('status', 'pending');
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
