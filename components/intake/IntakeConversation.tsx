'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBrowserSupabase } from '@/lib/supabase/client';
import {
  getIntakeFileUrlAction,
  loadIntakeConversationAction,
  postIntakeMessageAction,
  uploadIntakeChatFilesAction,
} from '@/lib/intake-conversation';
import {
  MAX_CHAT_FILES,
  avatarTint,
  formatBytes,
  initialsOf,
  mergeMessages,
  participantStyle,
  relativeTime,
  shouldGroupWithPrevious,
  type IntakeAttachment,
  type IntakeMessage,
  type IntakePerson,
  type MessageVisibility,
} from '@/lib/intake-conversation-types';

/**
 * The conversation on a legal request: the surface both sides actually live
 * in. Messages stream in over Supabase Realtime (with a poll as a safety
 * net), each person carries an avatar, files dropped here are filed into the
 * ticket's documents, and the legal team can switch the composer to an
 * internal note the requester never sees.
 */
export function IntakeConversation({
  intakeId,
  viewerRole,
  viewerUserId,
  canPost,
  canUseInternal,
  initialMessages,
  mentionables,
  emptyHint,
  fill = false,
}: {
  intakeId: string;
  viewerRole: 'legal' | 'employee';
  viewerUserId: string;
  canPost: boolean;
  canUseInternal: boolean;
  initialMessages: IntakeMessage[];
  mentionables: IntakePerson[];
  emptyHint?: string;
  /** Fill the parent pane's height instead of capping at a share of the viewport. */
  fill?: boolean;
}) {
  const [messages, setMessages] = useState<IntakeMessage[]>(initialMessages);
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState<MessageVisibility>('shared');
  const [pending, setPending] = useState<IntakeAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'shared' | 'internal'>('all');
  const [typing, setTyping] = useState<string[]>([]);
  const [live, setLive] = useState(false);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<ReturnType<
    NonNullable<ReturnType<typeof createBrowserSupabase>>['channel']
  > | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingSentAt = useRef(0);

  const peopleByName = useMemo(
    () => mentionables.slice().sort((a, b) => b.name.length - a.name.length),
    [mentionables],
  );

  // ── live updates ────────────────────────────────────────────────────────
  const pull = useCallback(async () => {
    const res = await loadIntakeConversationAction(intakeId);
    if (res.ok) setMessages((prev) => mergeMessages(prev, res.messages));
  }, [intakeId]);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    if (!supabase) return;
    const channel = supabase
      .channel(`intake-conv:${intakeId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'firm_intake_messages',
          filter: `intake_id=eq.${intakeId}`,
        },
        () => {
          // Re-read through the action so RLS + the viewer's visibility rules
          // decide what they see, rather than trusting the raw payload.
          void pull();
        },
      )
      .on('broadcast', { event: 'typing' }, (payload) => {
        const who = (payload.payload ?? {}) as { userId?: string; name?: string };
        if (!who.name || who.userId === viewerUserId) return;
        setTyping((prev) => (prev.includes(who.name!) ? prev : [...prev, who.name!]));
        window.setTimeout(() => {
          setTyping((prev) => prev.filter((n) => n !== who.name));
        }, 3500);
      })
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    channelRef.current = channel;

    // Safety net: if the socket never connects (or drops), keep the thread
    // current anyway. 20s matches the case-timeline chat.
    const poll = window.setInterval(() => void pull(), 20_000);
    return () => {
      window.clearInterval(poll);
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [intakeId, pull, viewerUserId]);

  const broadcastTyping = useCallback(() => {
    const now = Date.now();
    if (now - typingSentAt.current < 2000) return;
    typingSentAt.current = now;
    const channel = channelRef.current;
    if (!channel) return;
    const me = mentionables.find((p) => p.userId === viewerUserId);
    void channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: viewerUserId, name: me?.name ?? 'Someone' },
    });
  }, [mentionables, viewerUserId]);

  const visible = useMemo(
    () =>
      messages.filter((m) =>
        filter === 'all' ? true : filter === 'internal' ? m.visibility === 'internal' : m.visibility === 'shared',
      ),
    [messages, filter],
  );

  // Pin to the newest message only when the reader is already at the bottom.
  // Otherwise they are reading history and being scrolled away is hostile.
  // Surface a pill instead and let them choose.
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const lastCount = useRef(visible.length);

  const scrollToEnd = useCallback((smooth = false) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setUnseen(0);
  }, []);

  useEffect(() => {
    const grew = visible.length - lastCount.current;
    lastCount.current = visible.length;
    if (atBottom) scrollToEnd();
    else if (grew > 0) setUnseen((n) => n + grew);
  }, [visible.length, atBottom, scrollToEnd]);

  // Deep links from email land on a specific message.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (!hash.startsWith('#m-')) return;
    const el = document.getElementById(hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('ring-2', 'ring-gold-400/70', 'rounded-xl');
    window.setTimeout(() => el.classList.remove('ring-2', 'ring-gold-400/70'), 2600);
  }, [visible.length]);

  // ── @-mention autocomplete ──────────────────────────────────────────────
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return mentionables.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6);
  }, [mentionQuery, mentionables]);

  function syncMentionQuery(value: string, caret: number) {
    const upto = value.slice(0, caret);
    const m = /(?:^|\s)@([\w.\- ]{0,30})$/.exec(upto);
    setMentionQuery(m ? m[1] : null);
    setMentionIndex(0);
  }

  function applyMention(person: IntakePerson) {
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? text.length;
    const upto = text.slice(0, caret);
    const rest = text.slice(caret);
    const replaced = upto.replace(/(^|\s)@([\w.\- ]{0,30})$/, `$1@${person.name} `);
    const next = replaced + rest;
    setText(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      ta?.focus();
      const pos = replaced.length;
      ta?.setSelectionRange(pos, pos);
    });
  }

  function resolveMentions(body: string): string[] {
    const ids: string[] = [];
    for (const p of peopleByName) {
      const re = new RegExp(`@${p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'i');
      if (re.test(body)) ids.push(p.userId);
    }
    return [...new Set(ids)];
  }

  // ── actions ─────────────────────────────────────────────────────────────
  async function attachFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (pending.length + files.length > MAX_CHAT_FILES) {
      setError(`Attach up to ${MAX_CHAT_FILES} files at a time.`);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('files', f));
      const res = await uploadIntakeChatFilesAction(intakeId, fd);
      if (!res.ok || !res.attachments) {
        setError(res.error ?? 'Could not attach that file.');
        return;
      }
      setPending((prev) => [...prev, ...res.attachments!]);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function send() {
    const body = text.trim();
    if (!body && pending.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await postIntakeMessageAction(intakeId, {
        body,
        visibility,
        mentions: resolveMentions(body),
        attachments: pending,
      });
      if (!res.ok) {
        setError(res.error ?? 'Could not send that message.');
        return;
      }
      if (res.message) setMessages((prev) => mergeMessages(prev, [res.message!]));
      setText('');
      setPending([]);
    } finally {
      setBusy(false);
    }
  }

  async function openFile(path: string) {
    const res = await getIntakeFileUrlAction(intakeId, path);
    if (res.ok && res.url) window.open(res.url, '_blank', 'noopener,noreferrer');
    else setError(res.error ?? 'Could not open that file.');
  }

  const internalCount = messages.filter((m) => m.visibility === 'internal').length;

  return (
    <section
      className={`flex flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white dark:border-forest-700/50 dark:bg-forest-900/40 ${
        fill ? 'h-full min-h-0' : ''
      }`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-3.5 py-2 dark:border-forest-800/60">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-500 dark:text-cream-100/55">
            Conversation
          </h2>
          <span
            className={`inline-flex items-center gap-1.5 text-[11px] ${
              live ? 'text-emerald-600 dark:text-emerald-300' : 'text-ink-400 dark:text-cream-100/40'
            }`}
            title={live ? 'Updating live' : 'Reconnecting, messages still refresh'}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                live ? 'bg-emerald-500' : 'bg-ink-300 dark:bg-cream-100/30'
              }`}
            />
            {live ? 'Live' : 'Syncing'}
          </span>
        </div>
        {canUseInternal && internalCount > 0 && (
          <div className="flex items-center gap-1 rounded-lg bg-ink-50 p-0.5 dark:bg-forest-950/50">
            {(['all', 'shared', 'internal'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium capitalize transition-colors ${
                  filter === f
                    ? 'bg-white text-forest-900 shadow-sm dark:bg-forest-800 dark:text-cream-100'
                    : 'text-ink-500 hover:text-forest-900 dark:text-cream-100/55 dark:hover:text-cream-100'
                }`}
              >
                {f === 'all' ? 'All' : f === 'shared' ? 'With requester' : `Internal (${internalCount})`}
              </button>
            ))}
          </div>
        )}
      </header>

      <div
        ref={scrollerRef}
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          const near = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          setAtBottom(near);
          if (near) setUnseen(0);
        }}
        className={`flex flex-col overflow-y-auto overscroll-contain px-3.5 py-3 ${
          fill ? 'min-h-0 flex-1' : 'max-h-[62vh] min-h-[220px]'
        }`}
      >
        {/* Short threads hug the composer rather than floating at the top. */}
        <div className="mt-auto space-y-0.5">
        {visible.length === 0 && (
          <p className="py-10 text-center text-[13px] text-ink-400 dark:text-cream-100/40">
            {emptyHint ?? 'No messages yet.'}
          </p>
        )}

        {visible.map((m, i) => {
          const grouped = shouldGroupWithPrevious(m, visible[i - 1]);
          const mine = m.authorUserId === viewerUserId;
          const isInternal = m.visibility === 'internal';

          if (m.kind === 'event') {
            return (
              <div key={m.id} id={`m-${m.id}`} className="flex justify-center py-2">
                <p
                  className={`max-w-[85%] whitespace-pre-wrap rounded-full px-3 py-1 text-center text-[11.5px] ${
                    isInternal
                      ? 'bg-amber-500/10 text-amber-700 dark:text-amber-200'
                      : 'bg-ink-50 text-ink-500 dark:bg-forest-950/50 dark:text-cream-100/50'
                  }`}
                >
                  {m.body}
                </p>
              </div>
            );
          }

          // Classic two-sided chat: the requester speaks on the left, the
          // legal team on the right (the same way round on both surfaces), so
          // a screenshot of a thread always reads identically.
          const onRight = m.authorRole === 'legal';
          const style = participantStyle(m.authorUserId ?? m.authorName);

          return (
            <div
              key={m.id}
              id={`m-${m.id}`}
              className={`flex gap-2 ${grouped ? 'pt-0.5' : 'pt-2.5'} ${
                onRight ? 'flex-row-reverse' : 'flex-row'
              }`}
            >
              <div className="w-7 shrink-0">
                {!grouped && (
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-[10.5px] font-semibold ${style.avatar}`}
                    aria-hidden
                  >
                    {initialsOf(m.authorName)}
                  </span>
                )}
              </div>

              <div
                className={`flex min-w-0 max-w-[calc(100%-0.5rem)] flex-col ${
                  onRight ? 'items-end' : 'items-start'
                }`}
              >
                {!grouped && (
                  <p
                    className={`mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] ${
                      onRight ? 'flex-row-reverse' : ''
                    }`}
                  >
                    <span className={`font-semibold ${style.name}`}>
                      {mine ? 'You' : m.authorName}
                    </span>
                    <span
                      className={`rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider ${
                        m.authorRole === 'legal'
                          ? 'bg-gold-500/15 text-gold-700 dark:text-gold-300'
                          : 'bg-forest-500/15 text-forest-700 dark:text-cream-100/70'
                      }`}
                    >
                      {m.authorRole === 'legal' ? 'Legal' : 'Requester'}
                    </span>
                    <span
                      className="text-ink-400 dark:text-cream-100/35"
                      title={new Date(m.createdAt).toLocaleString()}
                    >
                      {relativeTime(m.createdAt)}
                    </span>
                  </p>
                )}

                <div
                  className={`border px-3 py-2 text-[13.5px] leading-relaxed text-forest-900 dark:text-cream-100/90 ${
                    onRight ? 'rounded-2xl rounded-tr-sm' : 'rounded-2xl rounded-tl-sm'
                  } ${
                    isInternal
                      ? 'border-amber-400/45 bg-amber-500/[0.09]'
                      : `${style.bubble}`
                  }`}
                >
                  {isInternal && (
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                      Internal note · not visible to the requester
                    </p>
                  )}
                  {m.body && (
                    <p className="whitespace-pre-wrap">{highlightMentions(m.body, mentionables)}</p>
                  )}
                  {m.attachments.length > 0 && (
                    <ul className={`flex flex-wrap gap-1.5 ${m.body ? 'mt-2' : ''}`}>
                      {m.attachments.map((a) => (
                        <li key={a.path}>
                          <button
                            type="button"
                            onClick={() => void openFile(a.path)}
                            className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white/80 px-2.5 py-1.5 text-[12px] text-forest-900 hover:border-gold-500/60 dark:border-forest-700/50 dark:bg-forest-900/70 dark:text-cream-100"
                          >
                            <span aria-hidden>📎</span>
                            <span className="max-w-[170px] truncate">{a.name}</span>
                            {a.size > 0 && (
                              <span className="text-ink-400 dark:text-cream-100/40">
                                {formatBytes(a.size)}
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {typing.length > 0 && (
          <p className="pl-9 pt-2 text-[12px] italic text-ink-400 dark:text-cream-100/40">
            {typing.join(', ')} {typing.length === 1 ? 'is' : 'are'} typing…
          </p>
        )}
        </div>
      </div>

      {unseen > 0 && !atBottom && (
        <div className="relative">
          <button
            type="button"
            onClick={() => scrollToEnd(true)}
            className="absolute inset-x-0 -top-11 mx-auto w-fit rounded-full bg-forest-900 px-3.5 py-1.5 text-[12px] font-medium text-cream-50 shadow-lg dark:bg-gold-500 dark:text-forest-950"
          >
            {unseen} new message{unseen === 1 ? '' : 's'} ↓
          </button>
        </div>
      )}

      {canPost ? (
        <div className="shrink-0 border-t border-ink-100 px-3.5 py-2.5 dark:border-forest-800/60">
          {canUseInternal && (
            <div className="mb-1.5 flex items-center gap-1 rounded-lg bg-ink-50 p-0.5 dark:bg-forest-950/50">
              <button
                type="button"
                onClick={() => setVisibility('shared')}
                className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  visibility === 'shared'
                    ? 'bg-white text-forest-900 shadow-sm dark:bg-forest-800 dark:text-cream-100'
                    : 'text-ink-500 dark:text-cream-100/55'
                }`}
              >
                Reply to requester
              </button>
              <button
                type="button"
                onClick={() => setVisibility('internal')}
                className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  visibility === 'internal'
                    ? 'bg-amber-500/20 text-amber-800 shadow-sm dark:text-amber-200'
                    : 'text-ink-500 dark:text-cream-100/55'
                }`}
              >
                🔒 Internal note
              </button>
            </div>
          )}

          {pending.length > 0 && (
            <ul className="mb-2 flex flex-wrap gap-1.5">
              {pending.map((a) => (
                <li
                  key={a.path}
                  className="flex items-center gap-1.5 rounded-lg border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 text-[12px] text-forest-900 dark:text-cream-100"
                >
                  <span aria-hidden>📎</span>
                  <span className="max-w-[180px] truncate">{a.name}</span>
                  <button
                    type="button"
                    onClick={() => setPending((prev) => prev.filter((x) => x.path !== a.path))}
                    className="text-ink-400 hover:text-rose-600 dark:text-cream-100/40"
                    aria-label={`Remove ${a.name}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="relative">
            {mentionQuery !== null && mentionMatches.length > 0 && (
              <ul className="absolute bottom-full left-0 z-20 mb-1 w-64 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-lg dark:border-forest-700/50 dark:bg-forest-900">
                {mentionMatches.map((p, i) => (
                  <li key={p.userId}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyMention(p);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] ${
                        i === mentionIndex
                          ? 'bg-gold-500/15 text-forest-900 dark:text-cream-100'
                          : 'text-ink-700 dark:text-cream-100/80'
                      }`}
                    >
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${avatarTint(
                          p.userId,
                        )}`}
                      >
                        {initialsOf(p.name)}
                      </span>
                      <span className="truncate">{p.name}</span>
                      <span className="ml-auto text-[10px] uppercase tracking-wider text-ink-400 dark:text-cream-100/35">
                        {p.side === 'legal' ? 'Legal' : 'Team'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <textarea
              ref={taRef}
              rows={2}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                syncMentionQuery(e.target.value, e.target.selectionStart ?? 0);
                broadcastTyping();
              }}
              onKeyDown={(e) => {
                if (mentionQuery !== null && mentionMatches.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setMentionIndex((i) => (i + 1) % mentionMatches.length);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
                    return;
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    applyMention(mentionMatches[mentionIndex]);
                    return;
                  }
                  if (e.key === 'Escape') {
                    setMentionQuery(null);
                    return;
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={
                visibility === 'internal'
                  ? 'Internal note for the legal team. The requester will not see this…'
                  : 'Write a reply…  @ to mention someone, Enter to send'
              }
              className={`w-full rounded-xl border px-3 py-2.5 text-[14px] outline-none transition-colors focus:ring-2 ${
                visibility === 'internal'
                  ? 'border-amber-400/50 bg-amber-500/[0.06] focus:border-amber-500/70 focus:ring-amber-500/20'
                  : 'border-ink-200 bg-white focus:border-gold-500/70 focus:ring-gold-500/25 dark:border-forest-700/50 dark:bg-forest-900/60'
              } text-forest-900 dark:text-cream-100`}
            />
          </div>

          {error && (
            <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800 dark:border-rose-700/40 dark:bg-rose-950/40 dark:text-rose-200">
              {error}
            </p>
          )}

          <div className="mt-1.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => void attachFiles(e.target.files)}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                title="Attach a file: it is saved to this request's documents"
                className="rounded-lg border border-ink-200 px-2.5 py-1 text-[12.5px] font-medium text-forest-900 hover:bg-cream-50 disabled:opacity-50 dark:border-forest-700/50 dark:text-cream-100 dark:hover:bg-forest-800/50"
              >
                {uploading ? 'Attaching…' : '📎 Attach'}
              </button>
            </div>
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || (!text.trim() && pending.length === 0)}
              className="btn-primary !py-1.5 text-[13px] disabled:opacity-50"
            >
              {busy ? 'Sending…' : visibility === 'internal' ? 'Add internal note' : 'Send'}
            </button>
          </div>
        </div>
      ) : (
        <p className="border-t border-ink-100 px-4 py-3 text-[12.5px] text-ink-500 dark:border-forest-800/60 dark:text-cream-100/55">
          Messaging isn&rsquo;t enabled for your role.
        </p>
      )}
    </section>
  );
}

/** Highlight @Name spans that match a real person on the ticket. */
function highlightMentions(text: string, people: IntakePerson[]): React.ReactNode {
  if (people.length === 0) return text;
  const names = people
    .map((p) => p.name)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (names.length === 0) return text;
  const re = new RegExp(`(@(?:${names.join('|')}))`, 'gi');
  return text.split(re).map((part, i) =>
    /^@/.test(part) ? (
      <span
        key={i}
        className="rounded bg-gold-500/20 px-1 font-medium text-gold-800 dark:text-gold-200"
      >
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}
