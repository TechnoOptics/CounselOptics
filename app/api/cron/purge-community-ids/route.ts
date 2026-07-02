import { NextResponse, type NextRequest } from 'next/server';
import { purgeScheduledIdImages } from '@/lib/community-retention';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/purge-community-ids
 *
 * Vercel Cron entrypoint. Deletes ID/signature images for Community Case
 * Letters of Support whose 48h post-close grace period has elapsed - see
 * lib/community-retention.ts for the full rationale.
 *
 * Schedule via vercel.json:
 *   { "path": "/api/cron/purge-community-ids", "schedule": "0 *\/6 * * *" }
 * Every 6 hours is enough - the job only acts once 48h have already
 * passed, so there's no benefit to finer granularity, just more
 * invocations of an often-no-op job.
 *
 * Auth: CRON_SECRET in the Authorization header, same as
 * /api/cron/deadlines. Vercel Cron sets this automatically when configured.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET?.trim();
  const got = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (expected && got !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const result = await purgeScheduledIdImages();
  return NextResponse.json({ ok: true, ...result });
}
