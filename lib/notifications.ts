import { createServerSupabase, getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { usingSupabase } from './storage';

export type NotificationType =
  | 'case_invited'
  | 'case_accepted'
  | 'case_exhibit_added'
  | 'case_review_complete'
  | 'case_hearing_reminder'
  | 'case_status_changed'
  | 'signing_request_received'
  | 'signing_request_completed'
  | 'signing_request_canceled'
  | 'meeting_scheduled'
  | 'document_received'
  | 'system';

export type AppNotification = {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  caseId: string | null;
  actorUserId: string | null;
  readAt: string | null;
  createdAt: string;
};

type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  case_id: string | null;
  actor_user_id: string | null;
  read_at: string | null;
  created_at: string;
};

function fromRow(r: NotificationRow): AppNotification {
  return {
    id: r.id,
    userId: r.user_id,
    type: r.type as NotificationType,
    title: r.title,
    body: r.body,
    link: r.link,
    caseId: r.case_id,
    actorUserId: r.actor_user_id,
    readAt: r.read_at,
    createdAt: r.created_at,
  };
}

/**
 * Insert a notification for a user. Uses the service-role client so
 * background jobs and server actions that don't run as the target
 * user can still write. Returns the created row.
 *
 * Best-effort: failures are logged but never thrown so a notification
 * miss doesn't break the underlying flow (e.g. accepting an invite
 * succeeds even if the notification insert fails).
 */
export async function createNotification(input: {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  caseId?: string;
  actorUserId?: string;
}): Promise<AppNotification | null> {
  if (!usingSupabase()) return null;
  const admin = createAdminSupabase();
  if (!admin) return null;
  const { data, error } = await admin
    .from('notifications')
    .insert({
      user_id: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      case_id: input.caseId ?? null,
      actor_user_id: input.actorUserId ?? null,
    })
    .select('*')
    .single();
  if (error) {
    console.error('[createNotification] insert failed', error);
    return null;
  }
  return fromRow(data as NotificationRow);
}

/** Most recent notifications for the current user. */
export async function listNotifications(opts: {
  limit?: number;
  unreadOnly?: boolean;
} = {}): Promise<AppNotification[]> {
  if (!usingSupabase()) return [];
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = createServerSupabase();
  let query = supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 30);
  if (opts.unreadOnly) query = query.is('read_at', null);
  const { data, error } = await query;
  if (error) {
    console.error('[listNotifications] failed', error);
    return [];
  }
  return ((data ?? []) as NotificationRow[]).map(fromRow);
}

/** Number of unread notifications for the current user. */
export async function unreadNotificationCount(): Promise<number> {
  if (!usingSupabase()) return 0;
  const user = await getCurrentUser();
  if (!user) return 0;
  const supabase = createServerSupabase();
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null);
  if (error) {
    console.error('[unreadNotificationCount] failed', error);
    return 0;
  }
  return count ?? 0;
}

/** Mark a single notification read. */
export async function markNotificationRead(id: string): Promise<void> {
  if (!usingSupabase()) return;
  const user = await getCurrentUser();
  if (!user) return;
  const supabase = createServerSupabase();
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);
}

/** Mark every unread notification for the current user read. */
export async function markAllNotificationsRead(): Promise<void> {
  if (!usingSupabase()) return;
  const user = await getCurrentUser();
  if (!user) return;
  const supabase = createServerSupabase();
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('read_at', null);
}

/** Delete a single notification (clear from inbox). */
export async function deleteNotification(id: string): Promise<void> {
  if (!usingSupabase()) return;
  const user = await getCurrentUser();
  if (!user) return;
  const supabase = createServerSupabase();
  await supabase.from('notifications').delete().eq('id', id).eq('user_id', user.id);
}
