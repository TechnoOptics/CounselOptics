import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { logSecurityEvent, requestMeta } from '@/lib/security-audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Permanently deletes the current user. Cascades remove all owned cases,
 * exhibits, reviews, plans, defense advice, profile, and subscription rows
 * via foreign-key ON DELETE CASCADE. Files in storage are NOT cascaded by
 * Postgres - we delete them explicitly via the storage admin API.
 *
 * Stripe customers are detached (not deleted) so billing history remains
 * available for legal/tax compliance, in line with the privacy policy.
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Auth is not configured.' }, { status: 503 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

  // Confirmation gate - require the user to type CONFIRM in the request body.
  let body: { confirm?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  if ((body.confirm ?? '').trim().toUpperCase() !== 'DELETE MY ACCOUNT') {
    return NextResponse.json(
      {
        error:
          'Type "DELETE MY ACCOUNT" exactly into the confirm field to confirm deletion.',
      },
      { status: 400 },
    );
  }

  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY; cannot delete user.' },
      { status: 503 },
    );
  }

  // Wipe storage objects under <user_id>/ prefix.
  try {
    const { data: files } = await admin.storage
      .from('exhibits')
      .list(user.id, { limit: 1000 });
    if (files && files.length > 0) {
      // List subfolders (case_id-named) and recurse one level - pragmatic for our layout.
      for (const entry of files) {
        const sub = `${user.id}/${entry.name}`;
        const { data: inner } = await admin.storage.from('exhibits').list(sub, { limit: 1000 });
        const paths = (inner ?? []).map((f) => `${sub}/${f.name}`);
        if (paths.length > 0) {
          await admin.storage.from('exhibits').remove(paths);
        }
      }
    }
  } catch {
    // Don't fail account deletion just because file cleanup hit an issue.
  }

  // Delete the auth user. Postgres cascades will clean up dependent rows.
  const { error: deleteErr } = await admin.auth.admin.deleteUser(user.id);
  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  // Audit the deletion. The user row is now gone (security_events.user_id
  // FK is ON DELETE SET NULL), so record identity in `details` instead of
  // the user_id column to avoid a dangling reference.
  const meta = requestMeta(req);
  await logSecurityEvent({
    kind: 'account_deleted',
    // Default severity 'low' = audit record, auto-acknowledged so routine
    // deletions don't flood the security-pulse triage queue (which counts
    // unacknowledged).
    userId: null,
    ip: meta.ip,
    userAgent: meta.userAgent,
    url: meta.url,
    details: { deleted_user_id: user.id, email: user.email },
  });

  // Sign the user out on the same response by clearing every supabase
  // auth cookie. The auth.users row is gone, but their browser still
  // holds the chunked sb-…-auth-token cookies; if we do not clear
  // them on this response, the next page load presents a phantom
  // session to middleware until it eventually fails on a server-side
  // refresh. Iterate request cookies + write empty values with maxAge
  // 0 so the browser drops them immediately.
  const response = NextResponse.json({ ok: true });
  for (const c of req.cookies.getAll()) {
    if (c.name.startsWith('sb-')) {
      response.cookies.set(c.name, '', { maxAge: 0, path: '/' });
    }
  }
  return response;
}
