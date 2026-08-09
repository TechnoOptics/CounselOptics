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
 * Auth: `Authorization: Bearer <CRON_SECRET>`, which Vercel Cron sets for a
 * scheduled path. The shape below is the one at app/api/cron/health and
 * app/api/cron/deadlines.
 *
 * The unset case is the point, and it matters more here than anywhere else.
 * `if (expected && got !== expected)` reads as an auth check and is not one:
 * with CRON_SECRET missing the condition is false and every anonymous request
 * falls straight through to the purge. This route DELETES supporter ID and
 * signature images, so an open version of it hands an anonymous caller a
 * destroy button on evidence that cannot be recovered. A missing secret means
 * this deployment cannot authenticate anyone, which is a reason to refuse, not
 * a reason to admit everyone.
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
  const result = await purgeScheduledIdImages();
  return NextResponse.json({ ok: true, ...result });
}
