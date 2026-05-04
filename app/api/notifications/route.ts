import { NextResponse } from 'next/server';
import { listNotifications, unreadNotificationCount } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

/**
 * Notification feed endpoint. The NotificationBell client polls
 * this every 15-60s. Returns the most recent 30 notifications +
 * unread count for the current user. Empty arrays + 0 if signed
 * out (the bell hides itself in that case anyway).
 */
export async function GET() {
  try {
    const [items, unread] = await Promise.all([
      listNotifications({ limit: 30 }),
      unreadNotificationCount(),
    ]);
    return NextResponse.json(
      { items, unread },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (err) {
    console.error('[GET /api/notifications] failed', err);
    return NextResponse.json({ items: [], unread: 0 }, { status: 200 });
  }
}
