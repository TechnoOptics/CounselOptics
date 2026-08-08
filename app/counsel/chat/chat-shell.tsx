'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createFirmChannelAction,
  sendFirmMessageAction,
} from '@/lib/firm-actions';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { T, useT } from '@/components/i18n/LocaleProvider';
import type { FirmChannel, FirmMessage } from '@/lib/firm-types';
import { runGatedAction } from '@/lib/gated-action';

// Heartbeat refetch interval - the Realtime channel covers the live
// case, this is just a safety net so a missed event (network blip,
// tab unfocused for too long, edge worker reconnect) corrects itself
// within the minute.
const HEARTBEAT_MS = 60_000;

/**
 * Two-pane chat shell. Left pane: channel list + new-channel form.
 * Right pane: message thread for the active channel.
 *
 * Read path: Supabase Realtime subscription on firm_messages filtered
 * to the active channel. INSERTs append to the thread, UPDATEs replace
 * by id (covers edits + soft-delete via deleted_at), DELETEs filter
 * the row out. A single heartbeat refetch every 60s catches any event
 * the websocket missed (rare but possible on flaky networks). RLS on
 * firm_messages still gates which rows reach the subscriber.
 *
 * Send path: server action (sendFirmMessageAction). The action's
 * INSERT triggers the Realtime event that everyone in the channel
 * (including the sender) receives within ~100ms.
 */
export function ChatShell({
  firmId,
  initialChannels,
  userId,
}: {
  firmId: string;
  initialChannels: FirmChannel[];
  userId: string;
}) {
  const t = useT();
  const router = useRouter();
  const [channels, setChannels] = useState<FirmChannel[]>(initialChannels);
  const [activeId, setActiveId] = useState<string | null>(
    initialChannels[0]?.id ?? null,
  );
  const active = channels.find((c) => c.id === activeId) ?? null;
  const [messages, setMessages] = useState<FirmMessage[]>([]);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [showNewChannel, setShowNewChannel] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Read path: Realtime subscription + initial backfill + heartbeat.
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    const channelId = activeId;

    // Initial backfill via the same REST endpoint - we still need to
    // load the existing message history; Realtime only delivers
    // changes from the moment we subscribe.
    async function loadHistory() {
      try {
        const res = await fetch(
          `/api/firm/messages?channelId=${encodeURIComponent(channelId)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const json = (await res.json()) as { messages: FirmMessage[] };
        if (cancelled) return;
        setMessages(json.messages);
      } catch {
        /* next tick will retry via heartbeat */
      }
    }
    loadHistory();

    // Realtime subscription. Postgres-level filter keeps us off
    // every-channel chatter; the client still respects RLS so we
    // could only receive what we're allowed to see anyway, but
    // narrowing here is a bandwidth win.
    const supabase = createBrowserSupabase();
    const sub = supabase
      .channel(`firm-messages:${channelId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'firm_messages',
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as Record<string, unknown>;
          const msg: FirmMessage = {
            id: row.id as string,
            channelId: row.channel_id as string,
            userId: row.user_id as string,
            body: row.body as string,
            attachments: (row.attachments as FirmMessage['attachments']) ?? [],
            createdAt: row.created_at as string,
            editedAt: (row.edited_at as string | null) ?? null,
            deletedAt: (row.deleted_at as string | null) ?? null,
          };
          // Drop soft-deleted inserts (shouldn't happen in practice)
          // and dedupe in case the heartbeat already brought us this id.
          if (msg.deletedAt) return;
          setMessages((prev) =>
            prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
          );
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'firm_messages',
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as Record<string, unknown>;
          const id = row.id as string;
          const deletedAt = (row.deleted_at as string | null) ?? null;
          setMessages((prev) => {
            // UPDATE with deleted_at != null is a soft delete: drop the row.
            if (deletedAt) return prev.filter((m) => m.id !== id);
            return prev.map((m) =>
              m.id === id
                ? {
                    ...m,
                    body: row.body as string,
                    attachments:
                      (row.attachments as FirmMessage['attachments']) ?? [],
                    editedAt: (row.edited_at as string | null) ?? null,
                  }
                : m,
            );
          });
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'firm_messages',
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          if (cancelled) return;
          const row = payload.old as Record<string, unknown>;
          const id = row.id as string;
          setMessages((prev) => prev.filter((m) => m.id !== id));
        },
      )
      .subscribe();

    // Safety-net heartbeat. If the websocket drops or a tab was
    // backgrounded long enough that the connection was reaped, this
    // refetch repairs the message list within the minute.
    const heartbeat = setInterval(loadHistory, HEARTBEAT_MS);

    return () => {
      cancelled = true;
      clearInterval(heartbeat);
      supabase.removeChannel(sub);
    };
  }, [activeId]);

  // Scroll to bottom when messages change.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, activeId]);

  function send() {
    if (!activeId || !draft.trim()) return;
    setSendError(null);
    const body = draft;
    setDraft('');
    startTransition(async () => {
      const res = await runGatedAction(() => sendFirmMessageAction(activeId, body));
      if (!res.ok) {
        setSendError(res.error ?? t('Could not send message.'));
        setDraft(body);
      }
    });
  }

  function newChannel(formData: FormData) {
    setSendError(null);
    startTransition(async () => {
      const res = await createFirmChannelAction(firmId, formData);
      if (res.ok && res.channelId) {
        setShowNewChannel(false);
        router.refresh();
        setActiveId(res.channelId);
      } else {
        setSendError(res.error ?? t('Could not create channel.'));
      }
    });
  }

  return (
    <div className="grid md:grid-cols-[240px,1fr] gap-4 h-full min-h-0">
      <aside className="card p-3 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <p className="eyebrow"><T>Channels</T></p>
          <button
            type="button"
            onClick={() => setShowNewChannel((v) => !v)}
            className="text-[11px] text-foreground hover:underline"
          >
            <T>+ New</T>
          </button>
        </div>
        {showNewChannel && (
          <form
            action={newChannel}
            className="mb-3 p-2 rounded bg-surface-2 ring-1 ring-edge space-y-2"
          >
            <input
              name="name"
              required
              placeholder={t('general')}
              className="input py-1 text-sm"
              maxLength={40}
            />
            <input name="topic" placeholder={t('Topic (optional)')} className="input py-1 text-sm" />
            <button type="submit" className="btn-primary text-xs w-full" disabled={pending}>
              <T>Create</T>
            </button>
          </form>
        )}
        <ul className="space-y-0.5">
          {channels.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setActiveId(c.id)}
                className={`w-full text-left px-2 py-1 rounded text-sm flex items-center gap-1.5 ${
                  c.id === activeId
                    ? 'bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950 font-semibold'
                    : 'text-foreground hover:bg-surface-2'
                }`}
              >
                <span aria-hidden>#</span>
                <span className="truncate">{c.name ?? 'untitled'}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="card flex flex-col min-h-0">
        <header className="px-4 py-3 border-b border-edge">
          <p className="font-semibold text-foreground">
            {active ? `#${active.name}` : <T>No channel selected</T>}
          </p>
          {active?.topic && (
            <p className="text-[11px] text-muted mt-0.5">
              {active.topic}
            </p>
          )}
        </header>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <p className="text-sm text-muted italic">
              <T>No messages yet. Say hi.</T>
            </p>
          ) : (
            messages.map((m) => (
              <article
                key={m.id}
                className={`max-w-[80%] ${
                  m.userId === userId ? 'ml-auto text-right' : ''
                }`}
              >
                <p
                  className={`inline-block px-3 py-1.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                    m.userId === userId
                      ? 'bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950 rounded-tr-sm'
                      : 'bg-surface-2 text-foreground rounded-tl-sm'
                  }`}
                >
                  {m.body}
                </p>
                <p className="text-[10px] text-muted mt-0.5 font-mono tabular-nums">
                  {new Date(m.createdAt).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
              </article>
            ))
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="border-t border-edge p-2 pb-[calc(0.5rem+var(--safe-bottom))] flex items-end gap-2"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={t('Message')}
            rows={1}
            className="input resize-none flex-1"
            disabled={pending || !activeId}
            maxLength={4000}
          />
          <button
            type="submit"
            disabled={pending || !draft.trim() || !activeId}
            className="btn-primary"
            aria-label={t('Send')}
          >
            <T>Send</T>
          </button>
        </form>
        {sendError && (
          <p className="px-3 pb-2 text-[11px] text-rose-700 dark:text-rose-300">
            {sendError}
          </p>
        )}
      </section>
    </div>
  );
}
