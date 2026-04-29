'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createFirmChannelAction,
  sendFirmMessageAction,
} from '@/lib/firm-actions';
import type { FirmChannel, FirmMessage } from '@/lib/firm-types';

const POLL_MS = 3000;

/**
 * Two-pane chat shell. Left pane: channel list + new-channel form.
 * Right pane: message thread for the active channel.
 *
 * The message read path polls /api/firm/messages?channelId=... every
 * 3s. Sending is a server action. This is the deliberate "polled v1"
 * pattern - real-time WebSockets land in a follow-on session.
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

  // Poll messages for the active channel.
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    async function fetchOnce() {
      try {
        const res = await fetch(
          `/api/firm/messages?channelId=${encodeURIComponent(activeId!)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const json = (await res.json()) as { messages: FirmMessage[] };
        if (cancelled) return;
        setMessages(json.messages);
      } catch {
        /* ignore - next tick */
      }
    }
    fetchOnce();
    const id = setInterval(fetchOnce, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
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
      const res = await sendFirmMessageAction(activeId, body);
      if (!res.ok) {
        setSendError(res.error ?? 'Could not send message.');
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
        setSendError(res.error ?? 'Could not create channel.');
      }
    });
  }

  return (
    <div className="grid md:grid-cols-[240px,1fr] gap-4 h-[70vh]">
      <aside className="card p-3 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <p className="eyebrow">Channels</p>
          <button
            type="button"
            onClick={() => setShowNewChannel((v) => !v)}
            className="text-[11px] text-forest-900 dark:text-cream-100/85 hover:underline"
          >
            + New
          </button>
        </div>
        {showNewChannel && (
          <form
            action={newChannel}
            className="mb-3 p-2 rounded bg-cream-50 dark:bg-forest-800/40 ring-1 ring-ink-200 dark:ring-forest-700/40 space-y-2"
          >
            <input
              name="name"
              required
              placeholder="general"
              className="input py-1 text-sm"
              maxLength={40}
            />
            <input name="topic" placeholder="Topic (optional)" className="input py-1 text-sm" />
            <button type="submit" className="btn-primary text-xs w-full" disabled={pending}>
              Create
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
                    : 'text-ink-700 dark:text-cream-100/85 hover:bg-ink-50 dark:hover:bg-forest-800/60'
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
        <header className="px-4 py-3 border-b border-ink-100 dark:border-forest-700/40">
          <p className="font-semibold text-forest-900 dark:text-cream-100">
            #{active?.name ?? '—'}
          </p>
          {active?.topic && (
            <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-0.5">
              {active.topic}
            </p>
          )}
        </header>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <p className="text-sm text-ink-500 dark:text-cream-100/55 italic">
              No messages yet. Say hi.
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
                      : 'bg-ink-100 text-ink-900 dark:bg-forest-800/60 dark:text-cream-100 rounded-tl-sm'
                  }`}
                >
                  {m.body}
                </p>
                <p className="text-[10px] text-ink-400 dark:text-cream-100/45 mt-0.5 font-mono tabular-nums">
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
          className="border-t border-ink-100 dark:border-forest-700/40 p-2 flex items-end gap-2"
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
            placeholder="Message"
            rows={1}
            className="input resize-none flex-1"
            disabled={pending || !activeId}
            maxLength={4000}
          />
          <button
            type="submit"
            disabled={pending || !draft.trim() || !activeId}
            className="btn-primary"
            aria-label="Send"
          >
            Send
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
