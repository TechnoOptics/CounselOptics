import { NextResponse, type NextRequest } from 'next/server';
import { verifyApiToken, tokenHasScope } from '@/lib/api-tokens';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/safe/ping
 *
 * Append a live-tracking location update for an existing Safe Witness
 * alert. The watch fires this every 30s after the initial press; the
 * web /safe page (running either in the Capacitor Android shell or
 * in a desktop browser) does the same once an alert is active. The
 * recipient-facing /safe/alert/[id] tracker page polls these and
 * redraws a moving dot plus a breadcrumb trail.
 *
 * Body: { alert_id: uuid, lat: number, lng: number, accuracy_m?:
 *         number, speed_mps?: number, heading_deg?: number,
 *         source?: 'watch' | 'mobile' | 'web' }
 *
 * Auth: two paths. (1) Bearer adv_ token - what the watch uses. (2)
 * Session cookie - what the phone + desktop web /safe page uses.
 * Either way we resolve to a user_id and require it matches the
 * alert's user_id so a token / session for user A can't write
 * pings against user B's alert.
 *
 * Short-circuits when tracking_stopped_at is set on the alert -
 * returns 409 with {stopped:true} so the caller halts its 30s timer
 * instead of trying again.
 */
export async function POST(req: NextRequest) {
  // Bearer token path (watch).
  let userId: string | null = null;
  const auth = req.headers.get('authorization');
  if (auth) {
    const verified = await verifyApiToken(auth);
    if (!verified) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }
    if (!tokenHasScope(verified, 'read')) {
      return NextResponse.json(
        { error: 'Token missing read scope.' },
        { status: 403 },
      );
    }
    userId = verified.userId;
  } else {
    // Session-cookie path (phone web view + desktop browser).
    const user = await getCurrentUser().catch(() => null);
    userId = user?.id ?? null;
  }
  if (!userId) {
    return NextResponse.json(
      { error: 'Sign in or attach a bearer token to send live-tracking pings.' },
      { status: 401 },
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
