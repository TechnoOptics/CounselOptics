import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';

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

  return NextResponse.json({ ok: true });
}
