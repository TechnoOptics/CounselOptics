import { NextResponse, type NextRequest } from 'next/server';
import { recordCrashReport } from '@/lib/storage';
import { getCurrentUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Captures client-side crashes posted by the CrashReporter component.
 * Inserts via the service-role client so RLS doesn't block writes from
 * anonymous visitors. We still record their auth.users.id when present
 * so admins can spot patterns by user.
 *
 * NO server-side rate limit or de-duplication. Every accepted POST
 * becomes a row: recordCrashReport does a bare insert with no prior
 * select, no upsert, and crash_reports has no unique constraint. The
 * only throttle is client-side and lives in components/CrashReporter.tsx,
 * which suppresses a repeat of the same message + first stack line for
 * 60s per session. Anything that does not run that component, or that
 * retries in a fresh session, writes a row per attempt.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const message = String(body.message ?? '').trim();
  if (!message) {
    return NextResponse.json({ ok: false, error: 'message required' }, { status: 400 });
  }

  const user = await getCurrentUser().catch(() => null);
  const userAgent = request.headers.get('user-agent') ?? null;

  await recordCrashReport({
    userId: user?.id ?? null,
    url: typeof body.url === 'string' ? body.url : null,
    userAgent,
    message,
    stack: typeof body.stack === 'string' ? body.stack : null,
    componentStack: typeof body.componentStack === 'string' ? body.componentStack : null,
    release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
  });

  return NextResponse.json({ ok: true });
}
