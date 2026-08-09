import { NextResponse, type NextRequest } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { aiConfigured } from '@/lib/timeline-ai';
import { analyzePendingEvidence } from '@/lib/case-evidence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/analyze-evidence
 *
 * Background analysis sweep for firm evidence intake. A large bulk drop imports
 * fast and leaves each row ai_status 'skipped'; the client auto-kicks scoring,
 * but if the tab closes mid-queue this job finishes the work so nothing is
 * stranded. It also revives rows stuck in 'running' past a stale cutoff. Only
 * rows whose case belongs to a firm are scored (see analyzePendingEvidence).
 *
 * Schedule via vercel.json:
 *   { "path": "/api/cron/analyze-evidence", "schedule": "*\/5 * * * *" }
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>`, which Vercel Cron sets for a
 * scheduled path. The shape below is the one at app/api/cron/health and
 * app/api/cron/deadlines.
 *
 * The unset case is the point. `if (expected && got !== expected)` reads as an
 * auth check and is not one: with CRON_SECRET missing the condition is false
 * and every anonymous request falls straight through to the sweep. This route
 * runs AI analysis over firm evidence, so an open version of it lets anybody
 * burn the account's model tokens on demand, and the returned counts leak how
 * much evidence is queued. A missing secret means this deployment cannot
 * authenticate anyone, which is a reason to refuse, not a reason to admit
 * everyone.
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
  if (!aiConfigured()) {
    return NextResponse.json({ ok: false, reason: 'ai-not-configured' });
  }
  const admin = createAdminSupabase();
  if (!admin) return NextResponse.json({ ok: false, reason: 'service-unavailable' });

  // Drain in bounded passes so a big backlog is chipped away within the
  // function's time budget; whatever is left is picked up on the next run.
  const deadline = Date.now() + 50_000;
  let analyzed = 0;
  let failed = 0;
  let picked = 0;
  let remaining = true;
  let passes = 0;
  while (remaining && Date.now() < deadline && passes < 20) {
    const res = await analyzePendingEvidence(admin, { limit: 25, concurrency: 2 });
    analyzed += res.analyzed;
    failed += res.failed;
    picked += res.picked;
    remaining = res.remaining;
    passes += 1;
    // Nothing eligible in this batch (e.g. all consumer rows) but more rows
    // exist: avoid a tight spin, let the next scheduled run continue.
    if (res.picked === 0 && res.remaining) break;
  }
  return NextResponse.json({ ok: true, picked, analyzed, failed, remaining });
}
