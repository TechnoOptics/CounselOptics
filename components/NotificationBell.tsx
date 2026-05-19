'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  deleteNotificationAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/lib/actions';
import type { AppNotification } from '@/lib/notifications';
import { PushOptIn } from './PushOptIn';
import { ensurePushSubscribed } from '@/lib/push-client';

/**
 * Bell icon + dropdown for in-app notifications. Mounted once in the
 * header for signed-in users. Server fetches the initial 20 most
 * recent on every authed render; client polls /api/notifications
 * every 60s while the dropdown is closed (cheap), and every 15s
 * while it's open (cheaper to feel live).
 *
 * Push banners (Android / iOS) are a separate channel that would
 * land via FCM/APNs once the server-side fan-out is wired - this
 * component is the in-app surface that the user always has.
 */
export function NotificationBell({
  initial,
  initialUnread,
}: {
  initial: AppNotification[];
  initialUnread: number;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>(initial);
  const [unread, setUnread] = useState<number>(initialUnread);
  const [, startTransition] = useTransition();
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Notifications-on-by-default: the bell is mounted once for every
  // signed-in user, so this is the right place to silently re-subscribe
  // this device to push whenever permission was already granted. No
  // prompt is shown (silent mode) - it just means a user who enabled
  // notifications once stays subscribed across sessions and devices
  // without having to find the Enable button again.
  useEffect(() => {
    void ensurePushSubscribed(false);
  }, []);

  // Poll for new notifications. Tighter cadence while the panel is
  // open so the user sees changes appear; lighter cadence while
  // closed so we only refresh the badge counter.
  useEffect(() => {
    const cadence = open ? 15_000 : 60_000;
    const tick = async () => {
      try {
        const res = await fetch('/api/notifications', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as {
          items: AppNotification[];
          unread: number;
        };
        setItems(data.items);
        setUnread(data.unread);
      } catch {
        /* offline / transient - skip this tick */
      }
    };
    const t = setInterval(tick, cadence);
    return () => clearInterval(t);
  }, [open]);

  // Click-outside-to-close
  useEffect(() => {
    if (!open) return;
    function handle(ev: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  function handleItemClick(n: AppNotification) {
    if (!n.readAt) {
      // Optimistic mark-read for snappy UX
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      setUnread((u) => Math.max(0, u - 1));
      startTransition(() => {
        void markNotificationReadAction(n.id);
      });
    }
    setOpen(false);
  }

  function handleMarkAll() {
    setItems((prev) => prev.map((x) => ({ ...x, readAt: x.readAt || new Date().toISOString() })));
    setUnread(0);
    startTransition(() => {
      void markAllNotificationsReadAction();
    });
  }

  function handleDelete(id: string) {
    setItems((prev) => prev.filter((x) => x.id !== id));
    setUnread((u) => {
      const wasUnread = items.find((x) => x.id === id && !x.readAt);
      return wasUnread ? Math.max(0, u - 1) : u;
    });
    startTransition(() => {
      void deleteNotificationAction(id);
    });
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-forest-900 dark:text-cream-100 hover:bg-ink-100 dark:hover:bg-forest-800/60 transition-colors"
      >
        <BellIcon />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white tabular-nums"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          // Mobile: pin to viewport with 8px margins so the panel
          // never overflows on narrow screens. Desktop: anchor
          // under the bell with the original 360px column.
          className="fixed inset-x-2 top-[calc(env(safe-area-inset-top)+3.5rem)] sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-[360px] max-h-[70vh] overflow-y-auto rounded-2xl border border-ink-200 dark:border-forest-700/40 bg-white dark:bg-forest-950 shadow-card-hover z-50 animate-fade-up"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-ink-100 dark:border-forest-800/60">
            <p className="text-sm font-semibold text-forest-900 dark:text-cream-100">
              Notifications
            </p>
            {unread > 0 && (
              <button
                type="button"
                onClick={handleMarkAll}
                className="text-[11px] text-forest-700 dark:text-gold-300 hover:underline underline-offset-2"
              >
                Mark all read
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-ink-500 dark:text-cream-100/55">
                No notifications yet.
              </p>
              <p className="text-[11px] text-ink-400 dark:text-cream-100/45 mt-1">
                You&apos;ll see updates here when collaborators add to your case or your review
                completes.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-forest-800/60">
              {items.map((n) => (
                <li
                  key={n.id}
                  className={`relative ${!n.readAt ? 'bg-cream-50/40 dark:bg-forest-900/40' : ''}`}
                >
                  <Link
                    href={n.link || '#'}
                    onClick={() => handleItemClick(n)}
                    className="block px-4 py-3 hover:bg-ink-50 dark:hover:bg-forest-800/40 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      {!n.readAt && (
                        <span
                          aria-hidden
                          className="mt-1.5 h-2 w-2 flex-none rounded-full bg-forest-700 dark:bg-gold-400"
                        />
                      )}
                      <div className={`flex-1 min-w-0 ${n.readAt ? 'opacity-70' : ''}`}>
                        <p className="text-sm font-semibold text-forest-900 dark:text-cream-100 truncate">
                          {n.title}
                        </p>
                        {n.body && (
                          <p className="text-xs text-ink-600 dark:text-cream-100/70 mt-0.5 line-clamp-2">
                            {n.body}
                          </p>
                        )}
                        <p className="text-[10px] text-ink-400 dark:text-cream-100/45 mt-1 tabular-nums">
                          {timeAgo(n.createdAt)}
                        </p>
                      </div>
                    </div>
                  </Link>
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      handleDelete(n.id);
                    }}
                    aria-label="Dismiss"
                    className="absolute top-3 right-3 inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-400 hover:text-ink-700 dark:text-cream-100/45 dark:hover:text-cream-100 hover:bg-ink-100 dark:hover:bg-forest-800/60"
                  >
                    <CloseIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* Push opt-in pill at the footer. Renders nothing when
              push is unsupported (desktop pre-Sonoma Safari, etc.)
              or when the user is already subscribed. Closes the
              gap between in-app notifications and OS-level alerts
              that ping the device when Advottic is in the
              background. */}
          <div className="border-t border-ink-100 dark:border-forest-800/60 px-4 py-3">
            <PushOptIn />
          </div>
        </div>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms) || ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
