'use client';

import { useRef, useState } from 'react';
import { cleanLegalText } from '@/lib/legal-templates';

/**
 * The big "Ask Advottic" bar at the top of the Counsel workspace.
 * One box to ask anything about the firm's environment - laws, a
 * case, a clause, a client, a meeting, a prior matter. It streams
 * the answer from the same firm-aware engine that powers Advottic
 * Aid (/api/bella with firmMode), whose tools reach case law, the
 * firm's cases, and prior intakes.
 */
export function AskAdvottic() {
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setOpen(true);
    setBusy(true);
    setError(null);
    setAnswer('');
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch('/api/bella', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: text }],
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
        setAnswer(cleanLegalText(acc));
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      setError(
        err instanceof Error
          ? err.message
          : 'Could not reach Advottic. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  const SUGGESTIONS = [
    'Statute of limitations for a breach of contract claim in our state',
    'Summarize the risk across my open matters',
    'What did we last discuss with this client?',
    'Draft talking points for an NDA negotiation',
  ];

  return (
    <div className="mb-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
        className="relative"
      >
        <div className="flex items-center gap-2 rounded-2xl bg-forest-900/60 ring-1 ring-forest-700/50 focus-within:ring-gold-500/50 px-4 py-3 transition-shadow">
          <SparkIcon />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask Advottic anything - a law, a case, a clause, a client, a meeting…"
            className="flex-1 bg-transparent outline-none text-[15px] text-cream-100 placeholder:text-cream-100/40"
            aria-label="Ask Advottic"
          />
          {answer || error ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setAnswer('');
                setError(null);
                setQ('');
                abortRef.current?.abort();
              }}
              className="text-[12px] text-cream-100/50 hover:text-cream-100 px-2"
            >
              Clear
            </button>
          ) : null}
          <button
            type="submit"
            disabled={busy || !q.trim()}
            className="btn-primary text-[13px] px-4 py-1.5 disabled:opacity-50"
          >
            {busy ? 'Thinking…' : 'Ask'}
          </button>
        </div>
      </form>

      {!open && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setQ(s);
                ask(s);
              }}
              className="text-[11.5px] rounded-full bg-forest-900/50 ring-1 ring-forest-700/40 px-2.5 py-1 text-cream-100/65 hover:text-cream-100 hover:ring-gold-500/40 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="mt-3 card p-5 max-h-[60vh] overflow-y-auto">
          {error ? (
            <p className="text-[13px] text-rose-300">{error}</p>
          ) : answer ? (
            <div className="text-[13.5px] leading-relaxed text-cream-100/90 whitespace-pre-wrap">
              {answer}
              {busy && (
                <span className="inline-block w-2 h-4 align-text-bottom ml-0.5 bg-gold-400/70 animate-pulse" />
              )}
            </div>
          ) : (
            <p className="text-[13px] text-cream-100/55">
              Searching your firm&rsquo;s environment…
            </p>
          )}
          <p className="mt-4 pt-3 border-t border-forest-700/40 text-[11px] text-cream-100/40">
            Advottic can be wrong - verify anything load-bearing. Not
            legal advice.
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
        d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z"
        fill="currentColor"
      />
      <path
        d="M19 14l.9 2.3 2.3.9-2.3.9L19 20.4l-.9-2.3-2.3-.9 2.3-.9L19 14z"
        fill="currentColor"
        opacity="0.6"
      />
    </svg>
  );
}
