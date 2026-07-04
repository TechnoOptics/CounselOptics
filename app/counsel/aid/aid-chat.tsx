'use client';

import { useEffect, useRef, useState } from 'react';
import { stripBellaMarkdown } from '@/lib/bella-markdown';
import { T, useT } from '@/components/i18n/LocaleProvider';

type Msg = { role: 'user' | 'assistant'; content: string };

/**
 * Advottic Aid - the legal team's research + retrieval assistant.
 *
 * Thin client over the existing /api/bella stream with firmMode on,
 * so the answer is grounded in this firm's jurisdictions + practice
 * areas and Bella's tools are available: search_case_law (real
 * CourtListener opinions, state-aware), search_my_cases /
 * get_case_detail (retrieve past matters), draft_document,
 * add_deadline. We never fabricate citations - Bella cites what the
 * tool returns.
 */
const SUGGESTIONS = [
  'What’s the statute of limitations for a breach of contract claim in our state?',
  'Find our past matters involving non-compete agreements.',
  'Summarize the key risks in an at-will employment termination here.',
  'What recent case law affects vendor indemnification clauses in our jurisdiction?',
];

export function AidChat() {
  const t = useT();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput('');
    const next: Msg[] = [...messages, { role: 'user', content: q }];
    setMessages([...next, { role: 'assistant', content: '' }]);
    setBusy(true);
    try {
      const res = await fetch('/api/bella', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Explicit portal scope: this is the firm Aid panel and must
        // only see firm data. The server validates against the
        // active firm context.
        body: JSON.stringify({ messages: next, portal: 'firm', firmMode: true }),
      });
      if (!res.ok || !res.body) {
        const e = await res
          .json()
          .catch(() => ({ error: t('Aid is unavailable right now.') }));
        setMessages((m) => {
          const c = [...m];
          c[c.length - 1] = {
            role: 'assistant',
            content: e.error || t('Aid is unavailable right now.'),
          };
          return c;
        });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMessages((m) => {
          const c = [...m];
          c[c.length - 1] = { role: 'assistant', content: acc };
          return c;
        });
      }
    } catch {
      setMessages((m) => {
        const c = [...m];
        c[c.length - 1] = {
          role: 'assistant',
          content: t('Network error - try again.'),
        };
        return c;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-col h-full min-h-0">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-4">
            <span className="aurora inline-flex h-12 w-12 items-center justify-center rounded-full bg-forest-950 ring-1 ring-gold-400/40 text-gold-300">
              <SparkIcon />
            </span>
            <div>
              <p className="font-display text-2xl text-forest-900 dark:text-cream-100">
                <T>Ask Advottic Aid</T>
              </p>
              <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1.5 max-w-md leading-relaxed">
                <T>
                  Research questions, grounded in your firm&rsquo;s
                  jurisdictions and real case law, plus instant retrieval
                  of your past matters.
                </T>
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-2 w-full max-w-2xl">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="text-left text-[13px] rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 px-3 py-2.5 text-ink-700 dark:text-cream-100/85 hover:bg-cream-50 dark:hover:bg-forest-800/50 transition-colors"
                >
                  <T>{s}</T>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === 'user' ? 'flex justify-end' : 'flex justify-start'
              }
            >
              <div
                className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-gold-500/15 ring-1 ring-gold-500/25 text-ink-900 dark:text-cream-100'
                    : 'bg-forest-900/40 ring-1 ring-forest-700/40 text-ink-800 dark:text-cream-100/90'
                }`}
              >
                {m.role === 'assistant' && !m.content && busy ? (
                  <span className="text-ink-500 dark:text-cream-100/55 italic">
                    <T>Researching...</T>
                  </span>
                ) : m.role === 'assistant' ? (
                  stripBellaMarkdown(m.content)
                ) : (
                  m.content
                )}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="border-t border-ink-200 dark:border-forest-700/40 p-3 sm:p-4 pb-[calc(0.75rem+var(--safe-bottom))] sm:pb-[calc(1rem+var(--safe-bottom))]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-end gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={2}
            placeholder={t('Ask about the law in your state, or pull up a past matter...')}
            className="input resize-none flex-1"
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="btn-primary"
          >
            {busy ? '...' : <T>Ask</T>}
          </button>
        </form>
        <p className="text-[11px] text-ink-500 dark:text-cream-100/70 mt-2">
          <T>
            Research assistance, not legal advice. Verify citations
            before relying on them.
          </T>
        </p>
      </div>
    </div>
  );
}

function SparkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3l1.8 5L19 9.8 14 12l-2 5-2-5-5-2.2L10 8z"
        fill="currentColor"
      />
    </svg>
  );
}
