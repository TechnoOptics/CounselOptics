import { NextResponse, type NextRequest } from 'next/server';
import { verifyApiToken, tokenHasScope } from '@/lib/api-tokens';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/safe/ping
 *
 * Append a live-tracking location update for an existing Safe Witness
 * alert. The watch fires this every 30s after the initial press (and
 * the web /safe page does too when the user is on a browser session)
 * so the recipient-facing /safe/alert/[id] tracker can redraw a moving
 * dot plus a breadcrumb trail.
 *
 * Body: { alert_id: uuid, lat: number, lng: number, accuracy_m?:
 *         number, speed_mps?: number, heading_deg?: number,
 *         source?: 'watch' | 'mobile' | 'web' }
 *
 * Auth: same Bearer adv_ token used for /api/safe/alert. Watch
 * tokens are read-scoped; the 4-second press is the authorization
 * for everything that flows after. We additionally enforce that
 * the alert's user_id matches the token's user so a leaked token
 * for user A can't write pings against user B's alert.
 *
 * Short-circuits when tracking_stopped_at is set on the alert -
 * returns 409 with {stopped:true} so the watch knows to halt its
 * 30s timer instead of trying again.
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
      { error: 'Live tracking requires a user-bound token.' },
      { status: 403 },
    );
  }

  let body: {
    alert_id?: string;
    lat?: number;
    lng?: number;
    accuracy_m?: number;
    speed_mps?: number;
    heading_deg?: number;
    source?: 'watch' | 'mobile' | 'web';
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }
  const alertId = String(body.alert_id ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(alertId)) {
    return NextResponse.json({ error: 'alert_id must be a UUID.' }, { status: 400 });
  }
  if (typeof body.lat !== 'number' || typeof body.lng !== 'number') {
    return NextResponse.json({ error: 'lat + lng required.' }, { status: 400 });
  }
  if (Math.abs(body.lat) > 90 || Math.abs(body.lng) > 180) {
    return NextResponse.json({ error: 'lat/lng out of range.' }, { status: 400 });
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

  // Verify ownership + live_tracking state in one round-trip.
  const { data: alertRow } = await admin
    .from('safe_witness_alerts')
    .select('user_id, live_tracking, tracking_stopped_at')
    .eq('id', alertId)
    .maybeSingle();
  if (!alertRow) {
    return NextResponse.json({ error: 'Alert not found.' }, { status: 404 });
  }
  const alert = alertRow as {
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
  if (!alert.live_tracking || alert.tracking_stopped_at) {
    return NextResponse.json(
      { ok: false, stopped: true, error: 'Live tracking stopped.' },
      { status: 409 },
    );
  }

  const { error: insertErr } = await admin
    .from('safe_witness_pings')
    .insert({
      alert_id: alertId,
      user_id: userId,
      lat: body.lat,
      lng: body.lng,
      accuracy_m:
        typeof body.accuracy_m === 'number' && body.accuracy_m > 0
          ? body.accuracy_m
          : null,
      speed_mps:
        typeof body.speed_mps === 'number' && body.speed_mps >= 0
          ? body.speed_mps
          : null,
      heading_deg:
        typeof body.heading_deg === 'number'
          ? ((body.heading_deg % 360) + 360) % 360
          : null,
      source,
    });
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
