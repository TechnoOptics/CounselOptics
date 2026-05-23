import { NextResponse, type NextRequest } from 'next/server';
import { verifyApiToken, tokenHasScope } from '@/lib/api-tokens';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/safe/stop
 *
 * Stop live tracking for an alert. The watcher (or anyone with
 * the watcher's bearer token, e.g. the phone app) can call this
 * to halt all further ping writes. The next /api/safe/ping the
 * watch tries will see live_tracking=false and short-circuit.
 *
 * Body: { alert_id: uuid, source?: 'watch' | 'mobile' | 'web' }
 *
 * Idempotent: re-stopping an already-stopped alert is a no-op.
 *
 * Why no separate endpoint for recipient-side stop: stopping is the
 * watcher's prerogative ("I'm safe now") - a contact can't unilaterally
 * silence the watcher's live position. If a malicious contact tried to
 * stop tracking via a leaked URL, they would have to forge a watcher
 * token which is gated by the same physical-press-on-the-watch trust
 * model as the initial alert.
 */
export async function POST(req: NextRequest) {
  const verified = await verifyApiToken(req.headers.get('authorization'));
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  if (!tokenHasScope(verified, 'read')) {
    return NextResponse.json(
      { error: 'Token missing read scope.' },
      { status: 403 },
    );
  }
  const userId = verified.userId;
  if (!userId) {
    return NextResponse.json(
      { error: 'Stop requires a user-bound token.' },
      { status: 403 },
    );
  }

  let body: { alert_id?: string; source?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }
  const alertId = String(body.alert_id ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(alertId)) {
    return NextResponse.json({ error: 'alert_id must be a UUID.' }, { status: 400 });
  }
  const source =
    body.source === 'watch' || body.source === 'mobile' || body.source === 'web'
      ? body.source
      : 'watch';

  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: 'Server misconfigured.' },
      { status: 500 },
    );
  }

  // Ownership check.
  const { data: row } = await admin
    .from('safe_witness_alerts')
    .select('user_id, live_tracking, tracking_stopped_at')
    .eq('id', alertId)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: 'Alert not found.' }, { status: 404 });
  }
  const alert = row as {
    user_id: string;
    live_tracking: boolean;
    tracking_stopped_at: string | null;
  };
  if (alert.user_id !== userId) {
    return NextResponse.json(
      { error: 'You do not own this alert.' },
      { status: 403 },
    );
  }
  if (alert.tracking_stopped_at) {
    return NextResponse.json({ ok: true, already_stopped: true });
  }

  await admin
    .from('safe_witness_alerts')
    .update({
      live_tracking: false,
      tracking_stopped_at: new Date().toISOString(),
      tracking_stopped_by: source,
    })
    .eq('id', alertId);
  return NextResponse.json({ ok: true });
}
