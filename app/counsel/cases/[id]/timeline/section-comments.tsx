'use client';

import { useState, useTransition } from 'react';
import { T, useT } from '@/components/i18n/LocaleProvider';
import type { SectionType } from '@/lib/case-collab-types';
import { useCollab } from './collab-context';
import { Avatar, relTime } from './collab-ui';

/**
 * A comment affordance + thread anchored to one section of the case: an
 * evidence item, a timeline event, or a calendar day/period. Collapsed by
 * default to a small "N" pill; expands to the thread + composer. Viewers can
 * read; contributors / represented clients / co-counsel / firm members post.
 */
export function SectionComments({
  sectionType,
  targetRef,
  compact = false,
  label,
}: {
  sectionType: SectionType;
  targetRef: string;
  compact?: boolean;
  label?: string;
}) {
  const t = useT();
  const { commentsFor, countFor, canPost, currentUserId, author, addComment, removeComment } =
    useCollab();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const count = countFor(sectionType, targetRef);
  const list = commentsFor(sectionType, targetRef);

  function submit() {
    const body = draft.trim();
    if (!body) return;
    setError(null);
    setDraft('');
    startTransition(async () => {
      const res = await addComment(sectionType, targetRef, body);
      if (!res.ok) {
        setError(res.error ?? t('Could not post.'));
        setDraft(body);
      }
    });
  }

  return (
    <div className={compact ? '' : 'mt-1'}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={
          'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11.5px] transition-colors ' +
          (count > 0
            ? 'text-forest-800 dark:text-cream-100/80 ring-1 ring-ink-200 dark:ring-forest-700/40 hover:bg-cream-50 dark:hover:bg-forest-800/40'
            : 'text-ink-500 dark:text-cream-100/55 hover:text-forest-900 dark:hover:text-cream-100')
        }
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M21 12a8 8 0 01-11.5 7.2L4 20l1-4.5A8 8 0 1121 12z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {count > 0 ? (
          <span data-no-translate>{count}</span>
        ) : (
          <span><T>Comment</T></span>
        )}
      </button>

      {open && (
        <div className="mt-2 rounded-lg ring-1 ring-ink-100 dark:ring-forest-700/40 bg-cream-50/60 dark:bg-forest-950/30 p-2.5 space-y-2.5">
          {label && (
            <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-ink-400 dark:text-cream-100/50" data-no-translate>
              {label}
            </p>
          )}
          {list.length === 0 ? (
            <p className="text-[12px] text-ink-500 dark:text-cream-100/55 italic">
              <T>No comments yet.</T>
            </p>
          ) : (
            <ul className="space-y-2.5">
              {list.map((c) => {
                const a = author(c.authorUserId);
                const mine = c.authorUserId === currentUserId;
                return (
                  <li key={c.id} className="flex items-start gap-2">
                    <Avatar name={a.displayName} avatarUrl={a.avatarUrl} size={24} ring />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11.5px] flex items-baseline gap-2 text-ink-500 dark:text-cream-100/55">
                        <span className="font-semibold text-forest-900 dark:text-cream-100" data-no-translate>
                          {a.displayName}
                        </span>
                        <span className="tabular-nums" data-no-translate>{relTime(c.createdAt)}</span>
                        {mine && (
                          <button
                            type="button"
                            onClick={() => removeComment(c.id)}
                            className="ml-auto text-ink-400 dark:text-cream-100/40 hover:text-rose-600 dark:hover:text-rose-300"
                            aria-label={t('Delete comment')}
                          >
                            <T>Delete</T>
                          </button>
                        )}
                      </p>
                      <p className="text-[13px] text-ink-800 dark:text-cream-100/85 whitespace-pre-wrap leading-relaxed" data-no-translate>
                        {c.body}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {canPost ? (
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
                rows={1}
                maxLength={4000}
                placeholder={t('Add a comment · Enter to post')}
                className="flex-1 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-950/60 px-2.5 py-1.5 text-[13px] resize-none focus:outline-none focus:ring-forest-500"
              />
              <button
                type="button"
                onClick={submit}
                disabled={pending || !draft.trim()}
                className="inline-flex h-8 items-center rounded-md bg-forest-900 dark:bg-gold-metal text-cream-50 dark:text-forest-950 px-3 text-[12px] font-medium disabled:opacity-50"
              >
                <T>Post</T>
              </button>
            </div>
          ) : (
            <p className="text-[11.5px] text-ink-400 dark:text-cream-100/45 italic">
              <T>You have view-only access to this matter.</T>
            </p>
          )}
          {error && <p className="text-[11.5px] text-rose-700 dark:text-rose-300">{error}</p>}
        </div>
      )}
    </div>
  );
}
