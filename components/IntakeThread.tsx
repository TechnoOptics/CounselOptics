'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  postIntakeThreadMessageAction,
  type ThreadMessage,
} from '@/lib/intake-thread';

/**
 * Employee <-> legal conversation on a request. Shared by the
 * employee portal (/portal/[id]) and the counsel intake detail.
 * Append-only; persisted in intake_answers.thread (no migration).
 */
export function IntakeThread({
  intakeId,
  messages,
  viewerRole,
  readOnly = false,
}: {
  intakeId: string;
  messages: ThreadMessage[];
  viewerRole: 'employee' | 'legal';
  /** Hide the composer (role lacks the messaging capability). */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  function send() {
    const body = text.trim();
    if (!body) return;
    setError(null);
    startTransition(async () => {
      const res = await postIntakeThreadMessageAction(intakeId, body);
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
            : 'Reply to the requester. They see this in their portal.'}
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
                  {m.text}
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
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder={
              viewerRole === 'employee'
                ? 'Message legal about this request...'
                : 'Reply to the requester...'
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
