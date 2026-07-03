import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import { listMessages } from '@/lib/firm-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/firm/messages?channelId=...
 *
 * Returns the most recent 50 messages for a channel. Used by the chat
 * poller every 3 seconds. A real-time WebSocket replacement is on the
 * roadmap.
 *
 * listMessages() reads through the RLS-scoped client, and the live
 * firm_messages_member_select policy already restricts reads to
 * channel members - but that policy isn't tracked in this repo's SQL
 * (see supabase/fixes/2026-07-03-firm-messages-channel-membership.sql,
 * which formalizes it), so this route can't rely on grep/read of this
 * codebase alone to prove it's safe. Double-gate explicitly here too,
 * matching every other route that reads firm-scoped data by a
 * client-suppliable id (e.g. the sign audit-trail route).
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  const channelId = req.nextUrl.searchParams.get('channelId');
  if (!channelId) {
    return NextResponse.json({ error: 'Missing channelId.' }, { status: 400 });
  }
  const supabase = createServerSupabase();
  const { data: membership } = await supabase
    .from('firm_channel_members')
    .select('user_id')
    .eq('channel_id', channelId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this channel.' }, { status: 403 });
  }
  const messages = await listMessages(channelId, 50);
  return NextResponse.json(
    { messages },
    {
      headers: {
        'Cache-Control': 'private, no-store, must-revalidate',
      },
    },
  );
}
