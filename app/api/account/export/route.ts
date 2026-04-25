import { NextResponse } from 'next/server';
import { getCurrentUser, isSupabaseConfigured, createServerSupabase } from '@/lib/supabase/server';
import { getProfile, getCurrentSubscription } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Auth is not configured.' }, { status: 503 });
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  }

  const supabase = createServerSupabase();
  const [
    profile,
    subscription,
    casesResp,
    exhibitsResp,
    reviewsResp,
    collabsAsInviterResp,
    collabsAsRecipientResp,
  ] = await Promise.all([
    getProfile().catch(() => null),
    getCurrentSubscription().catch(() => null),
    supabase.from('cases').select('*').eq('user_id', user.id),
    supabase.from('exhibits').select('*').eq('user_id', user.id),
    supabase.from('ai_reviews').select('*').eq('user_id', user.id),
    supabase.from('case_collaborators').select('*').eq('invited_by', user.id),
    supabase.from('case_collaborators').select('*').eq('user_id', user.id),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    user: {
      id: user.id,
      email: user.email,
      createdAt: user.created_at,
      lastSignInAt: user.last_sign_in_at,
      metadata: user.user_metadata,
    },
    profile,
    subscription,
    cases: casesResp.data ?? [],
    exhibits: exhibitsResp.data ?? [],
    aiReviews: reviewsResp.data ?? [],
    collaboratorsInvitedByYou: collabsAsInviterResp.data ?? [],
    collaboratorAccessGrantedToYou: collabsAsRecipientResp.data ?? [],
    notes: [
      'This export contains all of your personal data held by Advottic.',
      'File contents (uploaded exhibits) are not embedded - see /api/files/<exhibit_id> while signed in.',
      'For questions or to request other formats, email contact@advottic.com.',
    ],
  };

  const filename = `advottic-export-${user.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
