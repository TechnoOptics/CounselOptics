import { NextResponse, type NextRequest } from 'next/server';
import { sweepDeadlineAlerts } from '@/lib/deadlines';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/deadlines
 *
 * Vercel Cron entrypoint. Sweeps all active deadlines, fires
 * notifications at 90 / 30 / 7 days out, and marks the alerted_*
 * flag so we never double-fire.
 *
 * Schedule via vercel.json:
 *   { "path": "/api/cron/deadlines", "schedule": "0 13 * * *" }
 *
 * Auth: CRON_SECRET in the Authorization header. Vercel Cron sets
 * this automatically when configured.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET?.trim();
  const got =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (expected && got !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const result = await sweepDeadlineAlerts();
  return NextResponse.json({ ok: true, ...result });
}
