import { listNotifications, unreadNotificationCount } from '@/lib/notifications';
import { NotificationBell } from '@/components/NotificationBell';

/**
 * Server wrapper that fetches the signed-in firm user's initial notifications
 * and renders the shared NotificationBell in the Counsel header. This is how the
 * case owner / firm gets the bell on the counsel side (the consumer header's
 * bell isn't shown here). Case-activity events (a co-counsel opening the matter,
 * a section, commenting, downloading the packet) fan out into these
 * notifications from lib/case-activity-log.ts.
 */
export async function CounselNotificationBell() {
  const [initial, initialUnread] = await Promise.all([
    listNotifications({ limit: 20 }).catch(() => []),
    unreadNotificationCount().catch(() => 0),
  ]);
  return <NotificationBell initial={initial} initialUnread={initialUnread} />;
}
