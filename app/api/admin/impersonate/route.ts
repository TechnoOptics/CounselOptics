import { NextResponse } from 'next/server';
import {
  getCurrentUser,
  isCurrentUserAdmin,
  isSupabaseConfigured,
} from '@/lib/supabase/server';
import {
  createAdminSupabase,
  isServiceRoleConfigured,
} from '@/lib/supabase/admin';

/**
 * POST /api/admin/impersonate
 *
 * Body: { userId: string }
 *
 * Admin support workflow: generate a single-use magic link for the
 * target user via Supabase's service-role admin API, write an audit
 * row, return the URL to the caller's browser. The frontend opens it
 * in a new tab so the admin keeps their own session intact.
 *
 * Hardening:
 *   - Caller must be authenticated AND profiles.is_admin = true.
 *   - Target must exist, must NOT be is_admin (no admin-on-admin
 *     impersonation), must NOT be is_blocked.
 *   - Every successful impersonation writes admin_impersonations
 *     (admin_id, target_user_id, target_email, reason, created_at,
 *     user_agent, ip).
 *   - The magic link inherits Supabase's default expiry (1 hour) and
 *     is single-use; reuse is rejected by Supabase Auth.
 *
 * NOT a redirect endpoint - we return JSON so the client can decide
 * how to open the link (new tab vs replace). Replacing the current
 * tab would sign the admin out of their own session, which is the
 * opposite of what we want.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!isSupabaseConfigured() || !isServiceRoleConfigured()) {
    return NextResponse.json(
      { error: 'server_misconfigured' },
      { status: 503 },
    );
  }

  // Caller must be an authenticated admin.
  const caller = await getCurrentUser();
  if (!caller) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const callerIsAdmin = await isCurrentUserAdmin();
  if (!callerIsAdmin)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // Parse body.
  let body: { userId?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const targetUserId = (body.userId ?? '').trim();
  const reason = (body.reason ?? '').slice(0, 500);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetUserId)) {
    return NextResponse.json({ error: 'invalid_user_id' }, { status: 400 });
  }
  if (targetUserId === caller.id) {
    return NextResponse.json({ error: 'cannot_impersonate_self' }, { status: 400 });
  }

  const admin = createAdminSupabase();
  if (!admin)
    return NextResponse.json({ error: 'admin_client_unavailable' }, { status: 503 });

  // Look up the target. We need their email for generateLink, and we
  // need their is_admin + is_blocked status for the guard.
  const { data: targetUser, error: targetErr } = await admin.auth.admin.getUserById(
    targetUserId,
  );
  if (targetErr || !targetUser?.user) {
    return NextResponse.json({ error: 'target_not_found' }, { status: 404 });
  }
  const targetEmail = targetUser.user.email;
  if (!targetEmail) {
    return NextResponse.json({ error: 'target_has_no_email' }, { status: 400 });
  }

  // Read the target's profile to enforce admin-on-admin + blocked
  // guards. A blocked user shouldn't be impersonated - we'd be using
  // our admin power to act as someone we've explicitly disabled.
  const { data: targetProfile } = await admin
    .from('profiles')
    .select('is_admin, is_blocked')
    .eq('id', targetUserId)
    .maybeSingle();
  const t = targetProfile as { is_admin: boolean | null; is_blocked: boolean | null } | null;
  if (t?.is_admin) {
    return NextResponse.json({ error: 'cannot_impersonate_admin' }, { status: 400 });
  }
  if (t?.is_blocked) {
    return NextResponse.json({ error: 'target_is_blocked' }, { status: 400 });
  }

  // Generate the magic link. `type: 'magiclink'` produces a one-time
  // sign-in URL bound to this email. The redirectTo lands the user
  // (now actually being the admin) at /cases after the OTP exchange.
  const origin =
    req.headers.get('origin') ??
    `https://${req.headers.get('host') ?? 'advottic.com'}`;
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(
    '/cases?impersonating=1',
  )}`;
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: targetEmail,
    options: { redirectTo },
  });
  if (linkErr || !link?.properties?.action_link) {
    return NextResponse.json(
      { error: 'could_not_generate_link', detail: linkErr?.message },
      { status: 500 },
    );
  }

  // Audit. Best-effort write - if the table doesn't exist or RLS
  // rejects the insert, still return the link. Operator can ship the
  // migration separately. Log to server console either way so the
  // event is visible in Vercel runtime logs.
  const auditRow = {
    admin_id: caller.id,
    admin_email: caller.email ?? null,
    target_user_id: targetUserId,
    target_email: targetEmail,
    reason: reason || null,
    user_agent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  };
  try {
    await admin.from('admin_impersonations').insert(auditRow);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[admin/impersonate] audit insert failed', err);
  }
  // eslint-disable-next-line no-console
  console.info('[admin/impersonate]', {
    admin_id: caller.id,
    admin_email: caller.email,
    target_email: targetEmail,
    target_user_id: targetUserId,
  });

  return NextResponse.json({ url: link.properties.action_link });
}
