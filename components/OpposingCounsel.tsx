'use client';

/**
 * AI Opposing Counsel - flagship feature.
 *
 * A practice cross-examination: Bella role-plays opposing counsel
 * and the judge, grilling the litigant one hard question at a time,
 * then breaking character to coach. Builds courtroom nerve and
 * exposes weak answers before they cost a real hearing.
 *
 * Reuses the proven streaming transport. Speaker-aware rendering:
 * OPPOSING COUNSEL (stern), JUDGE (gold/formal), COACH (supportive).
 */

import { useEffect, useRef, useState } from 'react';

type Msg = { role: 'user' | 'assistant'; content: string };

function Line({ text }: { text: string }) {
  const m = text.match(/^(OPPOSING COUNSEL|JUDGE|COACH):\s*(.*)$/);
  if (m) {
    const who = m[1];
    const color =
      who === 'JUDGE'
        ? 'text-gold-700'
        : who === 'COACH'
          ? 'text-emerald-700'
          : 'text-rose-700';
    return (
      <p className="mb-1.5 leading-relaxed">
        <span className={`text-[10px] uppercase tracking-[0.16em] font-bold ${color}`}>
          {who}
        </span>
        <br />
        <span className="text-ink-800">{m[2]}</span>
      </p>
    );
  }
  return <p className="mb-1.5 leading-relaxed text-ink-800">{text}</p>;
}

export function OpposingCounsel({ caseId }: { caseId: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send(history: Msg[]) {
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    // Live assistant message we stream into.
    setMessages([...history, { role: 'assistant', content: '' }]);
    try {
      const res = await fetch('/api/opposing-counsel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId, messages: history }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setMessages([
          ...history,
          {
            role: 'assistant',
            content: `_${j.error || 'Could not reach the sparring partner.'}_`,
          },
        ]);
        setBusy(false);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMessages([...history, { role: 'assistant', content: acc }]);
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setMessages([
          ...history,
          { role: 'assistant', content: '_Round interrupted._' },
        ]);
      }
    } finally {
      setBusy(false);
    }
  }

  function begin() {
    setStarted(true);
    send([]);
  }
  function answer() {
    const t = draft.trim();
    if (!t || busy) return;
    setDraft('');
    send([...messages, { role: 'user', content: t }]);
  }
  function scoreMe() {
    if (busy) return;
    send([
      ...messages,
      {
        role: 'user',
        content:
          'End the session now. Give me a readiness score out of 100, my top 3 strengths, and the top 3 things to fix before the hearing.',
      },
    ]);
  }

  if (!started) {
    return (
      <section className="space-y-5">
        <div>
          <p className="eyebrow mb-1">Practice</p>
          <h2 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900">
            Face opposing counsel - before they face you
          </h2>
          <p className="text-sm text-ink-500 mt-1 max-w-xl leading-relaxed">
            A mock cross-examination grounded in your real exhibits.
            Bella plays the other side and the judge, asks the hard
            questions one at a time, then steps out to coach you.
            Tough, constructive, and entirely private practice.
          </p>
        </div>
        <div className="card p-6 sm:p-8 text-center space-y-4 relative overflow-hidden">
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-br from-rose-50/60 via-transparent to-gold-50/40 pointer-events-none"
          />
          <p className="relative text-sm text-ink-600 max-w-md mx-auto leading-relaxed">
            It will feel uncomfortable. That is the point - better to
            hear the hardest question here first.
          </p>
          <button
            type="button"
            onClick={begin}
            className="relative btn bg-forest-900 hover:bg-forest-800 text-cream-50 font-semibold animate-glow"
          >
            Step up to the stand
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-medium text-forest-900">
          Cross-examination
        </h2>
        <button
          type="button"
          onClick={scoreMe}
          disabled={busy || messages.length < 2}
          className="btn-secondary text-xs disabled:opacity-40"
        >
          End &amp; score me
        </button>
      </div>

      <div
        ref={scrollRef}
        className="card p-4 sm:p-5 max-h-[520px] overflow-y-auto space-y-4"
      >
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-forest-900 text-cream-50 px-4 py-2.5 text-sm leading-relaxed">
                {m.content}
              </p>
            </div>
          ) : (
            <div
              key={i}
              className="max-w-[92%] rounded-2xl rounded-bl-sm bg-cream-50 border border-gold-200/70 px-4 py-3 text-sm animate-fade-up"
            >
              {m.content
                ? m.content
                    .split('\n')
                    .filter((l) => l.trim())
                    .map((l, j) => <Line key={j} text={l} />)
                : <span className="text-ink-400">Thinking...</span>}
            </div>
          ),
        )}
        {busy && (
          <p className="text-[11px] text-ink-400 text-center animate-pulse">
            opposing counsel is responding...
          </p>
        )}
      </div>

      <div className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              answer();
            }
          }}
          rows={2}
          placeholder="Answer as you would in the room. Enter to send."
          className="flex-1 resize-none rounded-xl border border-ink-200 focus:border-gold-400 focus:outline-none px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={answer}
          disabled={busy || !draft.trim()}
          className="btn bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold disabled:opacity-40"
        >
          Answer
        </button>
      </div>
      <p className="text-[11px] text-ink-400 leading-relaxed">
        Private practice and preparation - a role-play, not a real
        proceeding, and not legal advice.
      </p>
    </section>
  );
}
