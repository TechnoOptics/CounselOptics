import { NextResponse } from 'next/server';
import {
  getRealCurrentUser,
  isSupabaseConfigured,
} from '@/lib/supabase/server';
import {
  createAdminSupabase,
  isServiceRoleConfigured,
} from '@/lib/supabase/admin';
import { mintTargetSession, startActAs } from '@/lib/act-as';

/**
 * POST /api/admin/impersonate  { userId, reason? }
 *
 * Starts an "act as" overlay: the admin KEEPS their own session. We mint a
 * target session server-side and stash it in a signed, HTTP-only `adv_act_as`
 * cookie; lib/supabase/server.ts then renders the app as the target for this
 * browser without touching the admin's real Supabase cookie. Ending (see
 * /api/admin/impersonate/stop) just deletes that one cookie — no logout, no
 * cross-tab collision.
 *
 * Returns { url } — the target's own workspace landing — for a same-tab
 * navigation.
 *
 * Hardening: caller must be an admin (checked against the REAL session, not any
 * overlay); target must exist and must NOT be an admin or blocked.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!isSupabaseConfigured() || !isServiceRoleConfigured()) {
    return NextResponse.json({ error: 'server_misconfigured' }, { status: 503 });
  }

  // Caller must be an authenticated admin — resolved from the REAL session so an
  // already-active overlay can't be used to bootstrap another impersonation.
  const caller = await getRealCurrentUser();
  if (!caller) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminSupabase();
  if (!admin)
    return NextResponse.json({ error: 'admin_client_unavailable' }, { status: 503 });

  const { data: callerProfile } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', caller.id)
    .maybeSingle();
  if (!(callerProfile as { is_admin: boolean | null } | null)?.is_admin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

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

  const { data: targetUser, error: targetErr } = await admin.auth.admin.getUserById(
    targetUserId,
  );
  if (targetErr || !targetUser?.user?.email) {
    return NextResponse.json({ error: 'target_not_found' }, { status: 404 });
  }
  const targetEmail = targetUser.user.email;

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

  // Mint a real session for the target, server-side (no browser round-trip),
  // and arm the overlay cookie. The admin's own session cookie is untouched.
  const minted = await mintTargetSession(targetEmail);
  if (!minted) {
    return NextResponse.json({ error: 'could_not_start_session' }, { status: 500 });
  }
  const armed = startActAs({
    targetUserId,
    adminUserId: caller.id,
    targetEmail,
    accessToken: minted.accessToken,
    tokenExpiresAt: minted.expiresAt,
  });
  if (!armed) {
    return NextResponse.json({ error: 'could_not_arm_overlay' }, { status: 500 });
  }

  // Audit (best-effort).
  try {
    await admin.from('admin_impersonations').insert({
      admin_id: caller.id,
      admin_email: caller.email ?? null,
      target_user_id: targetUserId,
      target_email: targetEmail,
      reason: reason || null,
      user_agent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[admin/impersonate] audit insert failed', err);
  }
  // eslint-disable-next-line no-console
  console.info('[admin/impersonate] act-as started', {
    admin_email: caller.email,
    target_email: targetEmail,
  });

  // Land on the target's OWN workspace so the admin sees what they see.
  let landing = '/cases';
  try {
    const [{ data: member }, { data: collab }] = await Promise.all([
      admin.from('firm_members').select('id').eq('user_id', targetUserId).limit(1).maybeSingle(),
      admin
        .from('case_collaborators')
        .select('id')
        .eq('user_id', targetUserId)
        .eq('role', 'attorney')
        .limit(1)
        .maybeSingle(),
    ]);
    if (member || collab) landing = '/counsel';
  } catch {
    /* default /cases */
  }

  return NextResponse.json({ url: landing });
}
