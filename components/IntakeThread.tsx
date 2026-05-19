'use client';

import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  postIntakeThreadMessageAction,
  type ThreadMessage,
} from '@/lib/intake-thread';

export type Mentionable = { id: string; name: string };

/**
 * Employee <-> legal conversation on a request. Shared by the
 * employee portal (/portal/[id]) and the counsel intake detail.
 * Append-only; persisted in intake_answers.thread (no migration).
 *
 * @mentions: click a person to drop `@Name` in; on send we resolve
 * every `@Name` that matches the mentionable list to a user id and
 * the server notifies them (routed to their own surface). Mentions
 * are highlighted in rendered messages.
 */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderWithMentions(
  text: string,
  names: string[],
): ReactNode {
  if (names.length === 0) return text;
  const re = new RegExp(
    `(@(?:${names.map(escapeRe).join('|')}))`,
    'gi',
  );
  const parts = text.split(re);
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <span
        key={i}
        className="font-semibold text-gold-700 dark:text-gold-200"
      >
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

export function IntakeThread({
  intakeId,
  messages,
  viewerRole,
  readOnly = false,
  mentionables = [],
}: {
  intakeId: string;
  messages: ThreadMessage[];
  viewerRole: 'employee' | 'legal';
  readOnly?: boolean;
  mentionables?: Mentionable[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const names = useMemo(
    () => mentionables.map((m) => m.name).filter(Boolean),
    [mentionables],
  );

  function resolveMentions(body: string): string[] {
    const ids: string[] = [];
    for (const m of mentionables) {
      if (!m.name) continue;
      const re = new RegExp(`@${escapeRe(m.name)}(?![\\w])`, 'i');
      if (re.test(body)) ids.push(m.id);
    }
    return [...new Set(ids)];
  }

  function addMention(name: string) {
    setText((t) => {
      const sep = t && !t.endsWith(' ') && t.length ? ' ' : '';
      return `${t}${sep}@${name} `;
    });
  }

  function send() {
    const body = text.trim();
    if (!body) return;
    setError(null);
    const mentions = resolveMentions(body);
    startTransition(async () => {
      const res = await postIntakeThreadMessageAction(
        intakeId,
        body,
        mentions,
      );
      if (res.ok) {
        setText('');
        router.refresh();
      } else {
        setError(res.error ?? 'Could not send.');
      }
    });
  }

  return (
    <section className="card p-5 space-y-4">
      <div>
        <p className="eyebrow mb-1">Messages</p>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
          {viewerRole === 'employee'
            ? 'Ask a question or add context. Legal sees this on the request.'
            : 'Reply to the requester or loop in a colleague with @.'}
        </p>
      </div>

      {messages.length === 0 ? (
        <p className="text-[13px] italic text-ink-500 dark:text-cream-100/55">
          No messages yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {messages.map((m) => {
            const mine = m.role === viewerRole;
            return (
              <li
                key={m.id}
                className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap ${
                    m.role === 'legal'
                      ? 'bg-gold-500/15 text-ink-800 dark:text-cream-100/90 ring-1 ring-gold-500/25'
                      : 'bg-forest-900/40 text-ink-800 dark:text-cream-100/90 ring-1 ring-forest-700/40'
                  }`}
                >
                  {renderWithMentions(m.text, names)}
                </div>
                <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-ink-400 dark:text-cream-100/40">
                  {m.role === 'legal' ? 'Legal' : 'Requester'} · {m.name} ·{' '}
                  {new Date(m.at).toLocaleString()}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {readOnly ? (
        <p className="text-[12px] italic text-ink-500 dark:text-cream-100/55 pt-1">
          Messaging legal isn&rsquo;t enabled for your role. Ask your
          administrator if you need it.
        </p>
      ) : (
        <div className="space-y-2 pt-1">
          {mentionables.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-ink-400 dark:text-cream-100/45 uppercase tracking-[0.14em]">
                Mention
              </span>
              {mentionables.slice(0, 12).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => addMention(m.name)}
                  disabled={pending}
                  className="text-[12px] rounded-full ring-1 ring-ink-200 dark:ring-forest-700/40 px-2 py-0.5 text-ink-700 dark:text-cream-100/85 hover:bg-cream-50 dark:hover:bg-forest-800/50"
                >
                  @{m.name}
                </button>
              ))}
            </div>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder={
              viewerRole === 'employee'
                ? 'Message legal about this request... use @ to mention someone'
                : 'Reply, or @mention a colleague or the requester...'
            }
            className="input resize-y"
            disabled={pending}
          />
          {error && (
            <p className="text-[12px] text-rose-600 dark:text-rose-300">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={send}
              disabled={pending || !text.trim()}
              className="btn-primary"
            >
              {pending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
