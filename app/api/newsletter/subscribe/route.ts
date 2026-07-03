import { NextResponse, type NextRequest } from 'next/server';
import { createAdminSupabase, isServiceRoleConfigured } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * POST /api/newsletter/subscribe
 *
 * Body: { email: string, source?: string }
 *
 * Stores the email in the `newsletter_signups` table (created lazily
 * via .upsert with onConflict='email'). The `source` field tags
 * which surface drove the signup so we can attribute conversion
 * back to specific articles / hub pages.
 *
 * Soft fails: if Supabase is unavailable, we return 200 anyway so
 * the UI completes cleanly. Real failure modes (malformed email)
 * still return 400.
 *
 * No double-opt-in for v1 - we will add a confirmation email when
 * we wire up the actual digest send.
 */
export const dynamic = 'force-dynamic';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const allowed = await checkRateLimit(`newsletter:subscribe:${ip}`, {
    limit: 10,
    windowSeconds: 60 * 60,
  });
  if (!allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: { email?: string; source?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const email = (body.email ?? '').trim().toLowerCase();
  const source = (body.source ?? 'unknown').slice(0, 64);
  if (!EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  try {
    if (isServiceRoleConfigured()) {
      const admin = createAdminSupabase();
      if (admin) {
        await admin
          .from('newsletter_signups')
          .upsert(
            { email, source, subscribed_at: new Date().toISOString() },
            { onConflict: 'email', ignoreDuplicates: false },
          );
      }
    }
  } catch (err) {
    // Soft fail - don't let a Supabase hiccup prevent the user from
    // signing up. We log for debugging but still return ok.
    // eslint-disable-next-line no-console
    console.warn('newsletter signup persist failed', err);
  }

  return NextResponse.json({ ok: true });
}
