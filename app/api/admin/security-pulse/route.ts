import { NextResponse, type NextRequest } from 'next/server';
import { isCurrentUserAdmin } from '@/lib/supabase/server';
import { runAllPulseChecks, applyAutofix } from '@/lib/security-pulse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/security-pulse
 *
 * HQ-only. Runs every security check and returns the summary.
 * Cheap enough to call on a 30s polling interval from the dashboard.
 *
 * POST /api/admin/security-pulse
 * Body: { fixId: string }
 *
 * Apply an autofix from the playbook in lib/security-pulse.ts. Only
 * IDs that the engine declares are accepted; unknown IDs return 400.
 */
export async function GET() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }
  const summary = await runAllPulseChecks();
  return NextResponse.json(summary);
}

export async function POST(req: NextRequest) {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }
  let body: { fixId?: string } = {};
  try {
    body = (await req.json()) as { fixId?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body.fixId || typeof body.fixId !== 'string') {
    return NextResponse.json({ error: 'fixId required.' }, { status: 400 });
  }
  const outcome = await applyAutofix(body.fixId);
  // Re-run checks so the dashboard immediately reflects the new state.
  const summary = await runAllPulseChecks();
  return NextResponse.json({ outcome, summary });
}
