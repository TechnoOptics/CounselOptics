'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { getChatThread, postChatMessage } from '@/lib/case-collab-actions';
import { GENERAL_THREAD_KEY, dmThreadKey, type ChatMessage } from '@/lib/case-collab-types';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { useCollab } from './collab-context';
import { Avatar, relTime } from './collab-ui';

/**
 * Case chat + presence, docked to the right of the timeline. A general room
 * for everyone on the matter plus a private thread with each other participant
 * ("the chat with each person"), including invited external collaborators, not
 * just firm members. Names + avatars come from their accounts (profiles).
 *
 * Live updates use Supabase Realtime (postgres_changes for messages, presence
 * for who's online); a slow poll of the active thread reconciles anything
 * Realtime misses.
 */
const POLL_MS = 20_000;

export function CaseChatPanel({ initialGeneralChat }: { initialGeneralChat: ChatMessage[] }) {
  const t = useT();
  const { firmId, caseId, currentUserId, participants, canPost, author } = useCollab();

  // Everyone else on the matter is a possible DM partner.
  const others = useMemo(
    () => participants.filter((p) => p.userId && p.userId !== currentUserId),
    [participants, currentUserId],
  );

  const [activeOther, setActiveOther] = useState<string | null>(null); // null = general
  const activeKey = activeOther ? dmThreadKey(currentUserId, activeOther) : GENERAL_THREAD_KEY;

  // Per-thread message cache. Seeded with the general room from the server.
  const [threads, setThreads] = useState<Record<string, ChatMessage[]>>({
    [GENERAL_THREAD_KEY]: initialGeneralChat,
  });
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const messages = threads[activeKey] ?? [];

  const mergeInto = useCallback((key: string, incoming: ChatMessage[]) => {
    setThreads((prev) => {
      const existing = prev[key] ?? [];
      const seen = new Set(existing.map((m) => m.id));
      const merged = [...existing, ...incoming.filter((m) => !seen.has(m.id))];
      merged.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      return { ...prev, [key]: merged };
    });
  }, []);

  // Load a DM thread the first time it is opened.
  useEffect(() => {
    if (activeOther && threads[activeKey] === undefined) {
      let cancelled = false;
      getChatThread(firmId, caseId, activeKey).then((rows) => {
        if (!cancelled) mergeInto(activeKey, rows);
      });
      return () => {
        cancelled = true;
      };
    }
  }, [activeOther, activeKey, threads, firmId, caseId, mergeInto]);

  // Realtime: all inserts for this case (RLS scopes them to the general room +
  // the caller's own DMs); route each to its thread cache by thread_key.
  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserSupabase();
    const msgSub = supabase
      .channel(`case-chat:${caseId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'case_chat_messages', filter: `case_id=eq.${caseId}` },
        (payload) => {
          if (cancelled) return;
          const r = payload.new as Record<string, unknown>;
          if (r.deleted_at) return;
          const msg: ChatMessage = {
            id: r.id as string,
            caseId: r.case_id as string,
            threadKind: r.thread_kind as 'general' | 'dm',
            threadKey: r.thread_key as string,
            participants: (r.participants as string[]) ?? [],
            authorUserId: r.author_user_id as string,
            body: r.body as string,
            createdAt: r.created_at as string,
          };
          mergeInto(msg.threadKey, [msg]);
        },
      )
      .subscribe();

    // Presence: who is viewing this matter right now.
    const presence = supabase.channel(`case-presence:${caseId}`, {
      config: { presence: { key: currentUserId } },
    });
    presence
      .on('presence', { event: 'sync' }, () => {
        if (cancelled) return;
        setOnline(new Set(Object.keys(presence.presenceState())));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void presence.track({ at: Date.now() });
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(msgSub);
      supabase.removeChannel(presence);
    };
  }, [caseId, currentUserId, mergeInto]);

  // Poll fallback for the active thread.
  useEffect(() => {
    let cancelled = false;
    const id = setInterval(async () => {
      const rows = await getChatThread(firmId, caseId, activeKey);
      if (!cancelled) mergeInto(activeKey, rows);
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [firmId, caseId, activeKey, mergeInto]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, activeKey]);

  function submit() {
    const body = draft.trim();
    if (!body) return;
    setError(null);
    setDraft('');
    const key = activeKey;
    startTransition(async () => {
      const res = await postChatMessage(firmId, caseId, {
        threadKind: activeOther ? 'dm' : 'general',
        otherUserId: activeOther ?? undefined,
        body,
      });
      if (res.ok && res.message) mergeInto(key, [res.message]);
      else {
        setError(res.error ?? t('Could not send message.'));
        setDraft(body);
      }
    });
  }

  const activePartner = activeOther ? participants.find((p) => p.userId === activeOther) : null;

  return (
    <section className="rounded-2xl border border-ink-200 dark:border-forest-700/40 bg-white dark:bg-forest-900/40 overflow-hidden flex flex-col max-h-[calc(100dvh-8rem)]">
      <header className="border-b border-ink-100 dark:border-forest-700/40 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <p className="eyebrow text-[10px] tracking-[0.22em]"><T>Case chat</T></p>
          <span className="inline-flex items-center gap-1.5 text-[10px] text-emerald-700 dark:text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
            {online.size} <T>online</T>
          </span>
        </div>

        {/* Thread switcher: General + one per participant */}
        <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setActiveOther(null)}
            aria-pressed={!activeOther}
            title={t('Everyone on the matter')}
            className={
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] whitespace-nowrap transition-colors ' +
              (!activeOther
                ? 'bg-forest-900/10 dark:bg-cream-100/10 font-semibold text-forest-900 dark:text-cream-100'
                : 'text-ink-600 dark:text-cream-100/70 hover:bg-cream-50 dark:hover:bg-forest-800/40')
            }
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="9" cy="8" r="3.5" stroke="currentColor" strokeWidth="2" />
              <circle cx="17" cy="9" r="2.5" stroke="currentColor" strokeWidth="2" />
              <path d="M3 20c0-3 3-5 6-5s6 2 6 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <T>General</T>
          </button>
          {others.map((p) => (
            <button
              key={p.userId}
              type="button"
              onClick={() => setActiveOther(p.userId)}
              aria-pressed={activeOther === p.userId}
              title={p.displayName}
              className={
                'relative inline-flex items-center gap-1.5 rounded-full pl-1 pr-2.5 py-0.5 text-[11.5px] whitespace-nowrap transition-colors ' +
                (activeOther === p.userId
                  ? 'bg-forest-900/10 dark:bg-cream-100/10 font-semibold text-forest-900 dark:text-cream-100'
                  : 'text-ink-600 dark:text-cream-100/70 hover:bg-cream-50 dark:hover:bg-forest-800/40')
              }
            >
              <span className="relative">
                <Avatar name={p.displayName} avatarUrl={p.avatarUrl} size={20} />
                {online.has(p.userId) && (
                  <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-1 ring-white dark:ring-forest-900" aria-hidden />
                )}
              </span>
              <span data-no-translate>{p.displayName.split(/\s+/)[0]}</span>
            </button>
          ))}
        </div>
        {activePartner && (
          <p className="mt-1 text-[11px] text-ink-500 dark:text-cream-100/55">
            <T>Private thread with</T>{' '}
            <span className="font-medium text-forest-900 dark:text-cream-100" data-no-translate>{activePartner.displayName}</span>
            {activePartner.kind === 'collaborator' && <span className="text-ink-400 dark:text-cream-100/45"> · <T>invited</T></span>}
          </p>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-[220px]">
        {messages.length === 0 ? (
          <p className="text-[12.5px] text-ink-500 dark:text-cream-100/55 italic">
            {activeOther ? <T>No messages yet. Start the conversation.</T> : <T>No messages yet. Be the first to post.</T>}
          </p>
        ) : (
          messages.map((m) => {
            const a = author(m.authorUserId);
            const mine = m.authorUserId === currentUserId;
            return (
              <div key={m.id} className="flex items-start gap-2.5">
                <Avatar name={a.displayName} avatarUrl={a.avatarUrl} size={26} ring />
                <div className="flex-1 min-w-0">
                  <p className="text-[11.5px] flex items-baseline gap-2 text-ink-500 dark:text-cream-100/55">
                    <span className={'font-semibold ' + (mine ? 'text-forest-800 dark:text-gold-200' : 'text-forest-900 dark:text-cream-100')} data-no-translate>
                      {a.displayName}
                    </span>
                    <span className="tabular-nums" data-no-translate>{relTime(m.createdAt)}</span>
                  </p>
                  <p className="text-[13px] text-ink-800 dark:text-cream-100/85 whitespace-pre-wrap leading-relaxed" data-no-translate>
                    {m.body}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {canPost ? (
        <div className="border-t border-ink-100 dark:border-forest-700/40 px-2.5 py-2 space-y-1.5">
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={2}
              maxLength={4000}
              placeholder={
                activePartner
                  ? t('Message {name}').replace('{name}', activePartner.displayName)
                  : t('Message everyone on the matter')
              }
              className="flex-1 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-950/60 px-2.5 py-1.5 text-[13px] resize-none focus:outline-none focus:ring-forest-500"
            />
            <button
              type="button"
              onClick={submit}
              disabled={pending || !draft.trim()}
              aria-label={t('Send')}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-gold-metal text-forest-950 disabled:opacity-50 shadow-sm"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M5 12h14m0 0l-5-5m5 5l-5 5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          {error && <p className="text-[11.5px] text-rose-700 dark:text-rose-300">{error}</p>}
        </div>
      ) : (
        <p className="border-t border-ink-100 dark:border-forest-700/40 px-3 py-2.5 text-[11.5px] text-ink-400 dark:text-cream-100/45 italic">
          <T>You have view-only access to this matter.</T>
        </p>
      )}
    </section>
  );
}
