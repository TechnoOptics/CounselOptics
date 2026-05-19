'use client';

/**
 * Shared browser-push subscription logic.
 *
 * Two callers:
 *  - PushOptIn (explicit button): prompts for permission, then
 *    subscribes. Used when permission is still "default".
 *  - NotificationBell (silent, on mount): subscribes ONLY when
 *    permission was already granted. No prompt - this is what makes
 *    notifications "on by default": a user who granted permission once
 *    (on this or another device, or via the native primer) gets
 *    re-subscribed automatically on every session without having to
 *    hunt for an Enable button.
 *
 * Idempotent: if an active PushSubscription already exists we re-POST
 * it (cheap; the server upserts on endpoint) and return 'subscribed'.
 */

export type PushState =
  | 'subscribed'
  | 'denied'
  | 'unsupported'
  | 'noenv'
  | 'needs-permission'
  | 'error';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = typeof window !== 'undefined' ? window.atob(b64) : '';
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function persist(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
}

/**
 * Ensure this device is subscribed to push.
 *
 * @param prompt when true, request permission if it is still
 *   "default" (must be called from a user gesture). When false, do
 *   nothing unless permission is ALREADY "granted" (safe to call on
 *   mount, no gesture, never shows a prompt).
 */
export async function ensurePushSubscribed(
  prompt: boolean,
): Promise<PushState> {
  if (typeof window === 'undefined') return 'error';
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return 'unsupported';
  }
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapid) return 'noenv';
  if (Notification.permission === 'denied') return 'denied';

  if (Notification.permission !== 'granted') {
    if (!prompt) return 'needs-permission';
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      return perm === 'denied' ? 'denied' : 'needs-permission';
    }
  }

  try {
    const reg = await navigator.serviceWorker.register('/sw-push.js');
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await persist(existing);
      return 'subscribed';
    }
    const keyBytes = urlBase64ToUint8Array(vapid);
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes.buffer.slice(
        keyBytes.byteOffset,
        keyBytes.byteOffset + keyBytes.byteLength,
      ) as ArrayBuffer,
    });
    await persist(sub);
    return 'subscribed';
  } catch {
    return 'error';
  }
}
