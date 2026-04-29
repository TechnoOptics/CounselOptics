import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/supabase/server';
import { listMessages } from '@/lib/firm-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/firm/messages?channelId=...
 *
 * Returns the most recent 50 messages for a channel. RLS gates which
 * channels the caller can read. Used by the chat poller every 3
 * seconds. A real-time WebSocket replacement is on the roadmap.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  const channelId = req.nextUrl.searchParams.get('channelId');
  if (!channelId) {
    return NextResponse.json({ error: 'Missing channelId.' }, { status: 400 });
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
