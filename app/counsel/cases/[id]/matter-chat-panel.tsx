'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { sendFirmMessageAction } from '@/lib/firm-actions';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { T, useT } from '@/components/i18n/LocaleProvider';
import type { FirmMessage } from '@/lib/firm-types';

/**
 * Matter-scoped chat panel. Mounts inline on /counsel/cases/[id] and
 * binds to a single firm_channels row (the matter channel created /
 * fetched server-side via getOrCreateMatterChannelAction). The send
 * path goes through sendFirmMessageAction which already handles:
 *   - @-mention parsing + inbox + email fan-out
 *   - Slack/Teams/generic webhook fan-out
 * so this component stays focused on the read path: Realtime
 * subscription + send box + render.
 *
 * Mirror of /counsel/chat's ChatShell but smaller: no channel sidebar
 * (this panel only ever shows the matter channel), no edit/delete UI
 * (those are still possible in the /counsel/chat view).
 */
type Author = { userId: string; displayName: string | null; email: string | null };

export function MatterChatPanel({
  channelId,
  initialMessages,
  authors,
  currentUserId,
}: {
  channelId: string;
  initialMessages: FirmMessage[];
  authors: Author[];
  currentUserId: string;
}) {
  const t = useT();
  const authorIndex = new Map(authors.map((a) => [a.userId, a]));
  const [messages, setMessages] = useState<FirmMessage[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Realtime: INSERT events for this channel arrive here in ~100ms.
  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserSupabase();
    const sub = supabase
      .channel(`matter-chat:${channelId}`)
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
          if (msg.deletedAt) return;
          setMessages((prev) =>
            prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
          );
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(sub);
    };
  }, [channelId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function onSubmit(formData: FormData) {
    const body = String(formData.get('body') ?? '').trim();
    if (!body) return;
    setError(null);
    setDraft('');
    startTransition(async () => {
      const res = await sendFirmMessageAction(channelId, body);
      if (!res.ok) {
        setError(res.error ?? t('Could not send message.'));
        setDraft(body);
      }
      // On success the Realtime INSERT event will append the message;
      // no need to optimistically push here.
    });
  }

  return (
    <section className="rounded-2xl border border-ink-200 dark:border-forest-700/40 bg-white dark:bg-forest-900/40 overflow-hidden">
      <header className="border-b border-ink-100 dark:border-forest-700/40 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="eyebrow text-[10px] tracking-[0.22em] mb-0.5">
            <T>Matter room</T>
          </p>
          <p className="text-[12px] text-ink-500 dark:text-cream-100/55">
            <T>Realtime · @-mention teammates · echoes to firm webhooks</T>
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[10px] text-emerald-700 dark:text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
          <T>Live</T>
        </span>
      </header>

      <div
        ref={scrollRef}
        className="max-h-[420px] overflow-y-auto px-4 py-3 space-y-3"
      >
        {messages.length === 0 ? (
          <p className="text-sm text-ink-500 dark:text-cream-100/55 italic">
            <T>No messages yet. Be the first to post.</T>
          </p>
        ) : (
          messages.map((m) => {
            const author = authorIndex.get(m.userId);
            const mine = m.userId === currentUserId;
            return (
              <MatterChatMessage
                key={m.id}
                body={m.body}
                createdAt={m.createdAt}
                authorName={author?.displayName ?? author?.email ?? 'Member'}
                mine={mine}
              />
            );
          })
        )}
      </div>

      <form action={onSubmit} className="border-t border-ink-100 dark:border-forest-700/40 px-3 py-2.5 space-y-1.5">
        <div className="flex items-end gap-2">
          <textarea
            name="body"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement).requestSubmit();
              }
            }}
            placeholder={t('Message this matter room · @-mention to notify · Enter to send, Shift+Enter for newline')}
            rows={2}
            maxLength={4000}
            className="flex-1 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-950/60 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-forest-500"
          />
          <button
            type="submit"
            disabled={pending || !draft.trim()}
            aria-label={t('Send')}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-gold-metal text-forest-950 disabled:opacity-50 shadow-sm"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M5 12h14m0 0l-5-5m5 5l-5 5"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        {error && (
          <p className="text-[12px] text-rose-700 dark:text-rose-300">{error}</p>
        )}
      </form>
    </section>
  );
}

function MatterChatMessage({
  body,
  createdAt,
  authorName,
  mine,
}: {
  body: string;
  createdAt: string;
  authorName: string;
  mine: boolean;
}) {
  const initials = authorName
    .split(/[\s.@]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const ts = new Date(createdAt).toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  });
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold shrink-0 ${
          mine
            ? 'bg-gold-100 text-forest-900 ring-1 ring-gold-300/60 dark:bg-gold-900/30 dark:text-gold-200'
            : 'bg-forest-100 text-forest-900 ring-1 ring-forest-300/40 dark:bg-forest-800/60 dark:text-cream-100'
        }`}
      >
        {initials || '·'}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[11.5px] flex items-baseline gap-2 text-ink-500 dark:text-cream-100/55">
          <span className="font-semibold text-forest-900 dark:text-cream-100">
            {authorName}
          </span>
          <span className="tabular-nums">{ts}</span>
        </p>
        <p className="text-[13.5px] text-ink-800 dark:text-cream-100/85 whitespace-pre-wrap leading-relaxed">
          {renderWithMentions(body)}
        </p>
      </div>
    </div>
  );
}

/**
 * Lightweight @-mention rendering: wrap @handle tokens in a styled
 * span so the visual matches the enterprise mock without needing a
 * full markdown parser. Anything else passes through as text.
 */
function renderWithMentions(text: string): React.ReactNode {
  const out: React.ReactNode[] = [];
  const re = /(^|\s)(@[a-zA-Z][a-zA-Z0-9._-]{1,30})\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let keyCount = 0;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[1].length;
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <span
        key={`mention-${keyCount++}`}
        className="rounded bg-gold-100 dark:bg-gold-900/40 ring-1 ring-gold-300/50 text-gold-800 dark:text-gold-200 px-1 font-mono text-[12px]"
      >
        {m[2]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
