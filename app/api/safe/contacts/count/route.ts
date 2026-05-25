import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/safe/contacts/count
 *
 * Tiny session-gated endpoint the in-app DistressOverlay calls on
 * first render to decide whether to enable the "Trigger Safe
 * Witness" press-and-hold button or instead nudge the user to set
 * contacts up at /profile.
 *
 * Returns { count: number }. Falls back to 0 when the user isn't
 * signed in or anything errors - the overlay treats 0 as "show the
 * configure-first hint" which is the safe default.
 */
export async function GET() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return NextResponse.json({ count: 0 });
  const admin = createAdminSupabase();
  if (!admin) return NextResponse.json({ count: 0 });
  const { count } = await admin
    .from('safe_witness_contacts')
    .select('id', { head: true, count: 'exact' })
    .eq('user_id', user.id);
  return NextResponse.json({ count: count ?? 0 });
}
