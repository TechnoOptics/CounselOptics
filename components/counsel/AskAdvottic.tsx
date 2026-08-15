'use client';

import { useEffect, useRef, useState } from 'react';
import { cleanLegalText } from '@/lib/legal-templates';
import { T, useT } from '@/components/i18n/LocaleProvider';
import type { FirmCopy } from '@/lib/firm-vocabulary';

/**
 * The big "Ask Advottic" bar at the top of the Counsel workspace.
 * One box to ask anything about the firm's environment - laws, a
 * case, a clause, a client, a meeting, a prior matter. It streams
 * the answer from the same firm-aware engine that powers Advottic
 * Aid (/api/bella with firmMode), whose tools reach case law, the
 * firm's cases, intakes, signing, billing, trust, etc.
 *
 * Behaviour:
 *   - Submitting clears the input box immediately so the user can
 *     keep typing while the answer streams.
 *   - The question becomes the title of its own answer block; the
 *     panel below the bar accumulates a running thread of Q -> A
 *     turns from this session, newest at the bottom.
 *   - The full message history is sent to /api/bella so a follow-up
 *     question ("and what about for that client?") has context.
 *   - The Clear button wipes the conversation.
 */
type Turn = {
  question: string;
  answer: string;
  error: string | null;
  /** True while this turn's stream is still arriving. */
  busy: boolean;
};

export function AskAdvottic({ copy }: {
  /**
   * Resolved by the caller from the firm's type. REQUIRED on purpose: this bar
   * renders on the dashboard and in the shell layout, and a default would have
   * quietly said "client" on every page but one. See lib/firm-vocabulary.ts.
   */
  copy: FirmCopy;
}) {
  const t = useT();
  const [q, setQ] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Whether any turn is mid-stream. Used to disable the submit
  // button and to gate certain UI affordances.
  const busy = turns.some((turn) => turn.busy);

  // Auto-scroll the answer panel during streaming, but only when the
  // user is already near the bottom - if they have scrolled up to
  // re-read an earlier answer we don't yank them back down.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 96;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [turns]);

  function patchLast(updater: (turn: Turn) => Turn) {
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice();
      next[next.length - 1] = updater(next[next.length - 1]!);
      return next;
    });
  }

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;

    // Snapshot the conversation BEFORE we append the new turn so
    // the API payload is exactly what the user has seen so far
    // (question + answer pairs).
    const history = turns;

    // Clear the input immediately so the user can type their next
    // question while this one is still streaming.
    setQ('');
    setTurns((prev) => [
      ...prev,
      { question: text, answer: '', error: null, busy: true },
    ]);
    // Re-focus the box so the user can keep typing without
    // clicking back in.
    requestAnimationFrame(() => inputRef.current?.focus());

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const messages = [
        ...history.flatMap((turn) => [
          { role: 'user' as const, content: turn.question },
          { role: 'assistant' as const, content: turn.answer },
        ]),
        { role: 'user' as const, content: text },
      ];

      const res = await fetch('/api/bella', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          // Explicit portal scope - the server validates this
          // against the user's actual firm context and refuses if
          // they don't belong to a firm, so personal cases never
          // leak into the enterprise workspace.
          portal: 'firm',
          firmMode: true,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`Request failed (${res.status}).`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        const cleaned = cleanLegalText(acc);
        patchLast((turn) => ({ ...turn, answer: cleaned }));
      }
      patchLast((turn) => ({ ...turn, busy: false }));
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      patchLast((turn) => ({
        ...turn,
        busy: false,
        error:
          err instanceof Error
            ? err.message
            : t('Could not reach Advottic. Try again.'),
      }));
    }
  }

  function clearConversation() {
    abortRef.current?.abort();
    setTurns([]);
    setQ('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const SUGGESTIONS = [
    'Statute of limitations for a breach of contract claim in our state',
    'Summarize the risk across my open matters',
    copy.askSuggestion,
    'Draft talking points for an NDA negotiation',
  ];

  return (
    // `relative` so the absolutely-positioned answer panel below
    // anchors to this wrapper. The panel overlays the content
    // below (Customize button, tiles) instead of pushing them
    // down on every new question.
    <div className="mb-6 relative">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
        className="relative"
      >
        {/* Gentle gold border that breathes (no moving light). The
            SparkIcon stars in front of the placeholder twinkle out
            of phase to add a touch of life. */}
        <div className="ask-frame relative flex items-center gap-2 rounded-2xl bg-forest-900/70 px-4 py-3 transition-shadow overflow-visible">
          <SparkIcon />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={
              turns.length > 0
                ? t('Ask a follow-up…')
                : t(copy.askPlaceholder)
            }
            className="flex-1 bg-transparent outline-none text-[15px] text-cream-100 placeholder:text-cream-100/60"
            aria-label={t('Ask Advottic')}
            autoComplete="off"
          />
          {turns.length > 0 ? (
            <button
              type="button"
              onClick={clearConversation}
              className="text-[12px] text-cream-100/50 hover:text-cream-100 px-2"
              title={t('Clear the conversation')}
            >
              <T>Clear</T>
            </button>
          ) : null}
          <button
            type="submit"
            disabled={busy || !q.trim()}
            className="btn-primary text-[13px] px-4 py-1.5 disabled:opacity-50"
          >
            {busy ? <T>Thinking…</T> : <T>Ask</T>}
          </button>
        </div>
      </form>

      {turns.length === 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => ask(s)}
              className="text-[11.5px] rounded-full bg-forest-900/50 ring-1 ring-forest-700/40 px-2.5 py-1 text-cream-100/65 hover:text-cream-100 hover:ring-gold-500/40 transition-colors"
            >
              <T>{s}</T>
            </button>
          ))}
        </div>
      )}

      {turns.length > 0 && (
        // `absolute` so the answer panel floats over the content
        // below (Customize button + tile grid) rather than pushing
        // them down with every new question. shadow-2xl + a solid
        // forest backdrop give it a clear floating-card feel.
        <div
          ref={scrollerRef}
          className="absolute left-0 right-0 top-full mt-3 z-30 card p-5 max-h-[60dvh] overflow-y-auto bg-forest-900/95 backdrop-blur-md shadow-2xl shadow-forest-950/60 ring-1 ring-gold-500/15"
        >
          {turns.map((turn, i) => (
            <div
              key={i}
              className={
                i === 0
                  ? ''
                  : 'mt-5 pt-5 border-t border-forest-700/30'
              }
            >
              {/* The question becomes the title of its own answer block,
                  rendered in a premium gold gradient that pulses slowly
                  - distinct headline from the calm cream body below. */}
              <p className="ask-question-title text-[15.5px] font-semibold tracking-[-0.005em] mb-2 leading-snug">
                {turn.question}
              </p>
              {turn.error ? (
                <p className="text-[13px] text-danger-text">{turn.error}</p>
              ) : turn.answer ? (
                <div className="text-[13.5px] leading-relaxed text-cream-100/90 whitespace-pre-wrap">
                  {turn.answer}
                  {turn.busy && (
                    <span className="inline-block w-2 h-4 align-text-bottom ml-0.5 bg-gold-400/70 animate-pulse" />
                  )}
                </div>
              ) : (
                <p className="text-[13px] text-cream-100/55">
                  <T>Searching your firm&rsquo;s environment…</T>
                </p>
              )}
            </div>
          ))}
          <p className="mt-5 pt-3 border-t border-forest-700/40 text-[11px] text-cream-100/60">
            <T>
              Advottic can be wrong - verify anything load-bearing. Not
              legal advice.
            </T>
          </p>
        </div>
      )}
    </div>
  );
}

function SparkIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className="shrink-0 text-gold-400"
      aria-hidden
    >
      <path
        className="ask-spark-primary"
        d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z"
        fill="currentColor"
      />
      <path
        className="ask-spark-accent"
        d="M19 14l.9 2.3 2.3.9-2.3.9L19 20.4l-.9-2.3-2.3-.9 2.3-.9L19 14z"
        fill="currentColor"
      />
    </svg>
  );
}
