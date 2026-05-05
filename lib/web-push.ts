import webpush from 'web-push';
import { createAdminSupabase } from './supabase/admin';

/**
 * Web Push sender. VAPID keys live in env (VAPID_PUBLIC_KEY exposed
 * to the client via NEXT_PUBLIC_VAPID_PUBLIC_KEY; VAPID_PRIVATE_KEY
 * server-only). Generate with `npx web-push generate-vapid-keys`.
 *
 * Send strategy: every notification we insert into the notifications
 * table fans out to push subscriptions for that user. Failures are
 * logged but never throw - a dead subscription should not block the
 * notification flow.
 */

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject =
    process.env.VAPID_SUBJECT?.trim() ?? 'mailto:security@advottic.com';
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body?: string; url?: string },
): Promise<{ sent: number; failed: number }> {
  if (!ensureConfigured()) return { sent: 0, failed: 0 };
  const admin = createAdminSupabase();
  if (!admin) return { sent: 0, failed: 0 };
  const { data } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);
  const subs = (data ?? []) as Array<{
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>;
  let sent = 0;
  let failed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          JSON.stringify(payload),
        );
        sent += 1;
        // touch last_seen_at
        await admin
          .from('push_subscriptions')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', s.id);
      } catch (err) {
        failed += 1;
        const status =
          (err as { statusCode?: number } | undefined)?.statusCode ?? 0;
        // 404 / 410 means the subscription is gone - clean up.
        if (status === 404 || status === 410) {
          await admin.from('push_subscriptions').delete().eq('id', s.id);
        }
      }
    }),
  );
  return { sent, failed };
}
