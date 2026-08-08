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
 * Auth: `Authorization: Bearer <CRON_SECRET>`, which Vercel Cron sets
 * for a scheduled path. The shape below is the one at
 * app/api/cron/health, and it is deliberately NOT the shape the other
 * cron routes use.
 *
 * The difference is the unset case. `if (expected && got !== expected)`
 * reads as an auth check and is not one: with CRON_SECRET missing, the
 * condition is false and every anonymous request falls straight through
 * to the sweep. This route mails attorneys and clients about deadlines,
 * so an open version of it is a way for anybody to make the product
 * send mail, and to learn from the returned counts how many deadlines
 * are inside the alert windows. A missing secret is "this deployment
 * cannot authenticate anyone", which is a reason to refuse, not a
 * reason to admit everyone.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfigured: CRON_SECRET is not set' },
      { status: 503 },
    );
  }
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const result = await sweepDeadlineAlerts();
  return NextResponse.json({ ok: true, ...result });
}
