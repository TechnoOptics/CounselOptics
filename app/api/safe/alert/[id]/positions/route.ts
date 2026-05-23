import { NextResponse, type NextRequest } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/safe/alert/[id]/positions?since=<iso>
 *
 * Public-by-token read for the recipient-facing /safe/alert/[id]
 * tracker page. Returns the time-ordered list of pings for the
 * alert, optionally filtered to those after `since` so the tracker
 * can long-poll only for new positions instead of refetching the
 * full trail every 5 seconds.
 *
 * Auth model: knowledge of the alert UUID in the URL is the gate -
 * same logic as the redemption tokens elsewhere in the app. The
 * UUID is in the email we sent to the contact, so possessing the
 * URL implies authorization to view the watcher's live position.
 * The Safe Witness alert UUID is unguessable in practice (2^122
 * keyspace) so a brute-force scan of /api/safe/alert/<uuid>/
 * positions isn't a real threat.
 *
 * Response shape:
 *   {
 *     pings: [{ lat, lng, accuracy_m, source, t }],
 *     tracking: { live, stopped_at, stopped_by },
 *   }
 *
 * Tracker page polls every ~5s with the latest `t` it has seen, so
 * normal-flow responses carry 0-2 items.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'Bad alert id.' }, { status: 400 });
  }
  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: 'Server misconfigured.' },
      { status: 500 },
    );
  }
  // Pull tracking-status flags from the alert row in parallel with
  // the pings query so the tracker UI knows whether to keep polling
  // or render the stopped state.
  const [alertResp, pingsResp] = await Promise.all([
    admin
      .from('safe_witness_alerts')
      .select('live_tracking, tracking_stopped_at, tracking_stopped_by')
      .eq('id', id)
      .maybeSingle(),
    (() => {
      let q = admin
        .from('safe_witness_pings')
        .select('lat, lng, accuracy_m, source, created_at')
        .eq('alert_id', id)
        .order('created_at', { ascending: true })
        .limit(500);
      const sinceParam = req.nextUrl.searchParams.get('since');
      if (sinceParam) {
        const sinceDate = new Date(sinceParam);
        if (!isNaN(sinceDate.getTime())) {
          q = q.gt('created_at', sinceDate.toISOString());
        }
      }
      return q;
    })(),
  ]);
  if (!alertResp.data) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }
  const alert = alertResp.data as {
    live_tracking: boolean;
    tracking_stopped_at: string | null;
    tracking_stopped_by: string | null;
  };
  const rows = (pingsResp.data ?? []) as Array<{
    lat: number;
    lng: number;
    accuracy_m: number | null;
    source: string;
    created_at: string;
  }>;
  return NextResponse.json({
    pings: rows.map((r) => ({
      lat: r.lat,
      lng: r.lng,
      accuracy_m: r.accuracy_m,
      source: r.source,
      t: r.created_at,
    })),
    tracking: {
      live: alert.live_tracking && !alert.tracking_stopped_at,
      stopped_at: alert.tracking_stopped_at,
      stopped_by: alert.tracking_stopped_by,
    },
  });
}
