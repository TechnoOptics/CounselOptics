'use client';

/**
 * Case Story - flagship feature.
 *
 * A cinematic, auto-assembled chronological timeline of the case
 * (opening, every exhibit anchored to when the event actually
 * happened, the hearing, key activity) - and a one-tap AI composer
 * that turns that spine into a clear first-person narrative the
 * litigant can use as the basis of a written declaration.
 *
 * Premium motion: a living gradient spine, staggered beat reveals,
 * a "today" fulcrum between what has happened and what's ahead,
 * and a streaming, typewriter-paced narrative panel.
 */

import { useEffect, useRef, useState } from 'react';
import { ShowMore } from '@/components/ShowMore';

export type StoryItem = {
  id: string;
  at: string; // ISO
  kind: 'opened' | 'evidence' | 'hearing' | 'event';
  title: string;
  detail?: string;
  category?: string | null;
  future?: boolean;
};

const CATEGORY_ACCENT: Record<string, string> = {
  Photo: 'from-sky-400 to-sky-600',
  Screenshot: 'from-sky-400 to-sky-600',
  Document: 'from-forest-500 to-forest-700',
  Contract: 'from-forest-500 to-forest-700',
  Communication: 'from-violet-400 to-violet-600',
  Audio: 'from-amber-400 to-amber-600',
  Video: 'from-rose-400 to-rose-600',
  Receipt: 'from-emerald-400 to-emerald-600',
  Report: 'from-indigo-400 to-indigo-600',
  'Medical record': 'from-rose-400 to-rose-600',
  'Witness statement': 'from-gold-400 to-gold-600',
};
const KIND_ACCENT: Record<StoryItem['kind'], string> = {
  opened: 'from-gold-400 to-gold-600',
  evidence: 'from-forest-500 to-forest-700',
  hearing: 'from-rose-400 to-rose-600',
  event: 'from-ink-300 to-ink-500',
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function CaseStory({
  caseId,
  items,
}: {
  caseId: string;
  items: StoryItem[];
}) {
  const sorted = [...items].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );
  const now = Date.now();
  const firstFutureIdx = sorted.findIndex((i) => Date.parse(i.at) > now);

  const [narrative, setNarrative] = useState('');
  const [composing, setComposing] = useState(false);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const narrativeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function compose() {
    setComposing(true);
    setDone(false);
    setNarrative('');
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch('/api/case-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setNarrative(`_${j.error || 'Could not compose the story right now.'}_`);
        setComposing(false);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done: rDone } = await reader.read();
        if (rDone) break;
        const chunk = dec.decode(value, { stream: true });
        setNarrative((p) => p + chunk);
        narrativeRef.current?.scrollTo({
          top: narrativeRef.current.scrollHeight,
        });
      }
      setDone(true);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setNarrative((p) => p + '\n\n_The composer was interrupted._');
      }
    } finally {
      setComposing(false);
    }
  }

  function copyNarrative() {
    navigator.clipboard?.writeText(narrative).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      },
      () => {},
    );
  }

  function downloadNarrative() {
    const blob = new Blob([narrative], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'case-story-draft.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-1">Case Story</p>
          <h2 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900">
            Your case, told as a story
          </h2>
          <p className="text-sm text-ink-500 mt-1 max-w-xl leading-relaxed">
            Every exhibit, hearing and milestone, placed on the day it
            actually happened. When you&rsquo;re ready, compose it into
            a clear written narrative you can hand to an attorney or
            adapt into a declaration.
          </p>
        </div>
        <button
          type="button"
          onClick={composing ? () => abortRef.current?.abort() : compose}
          className={`btn ${
            composing
              ? 'bg-ink-100 text-ink-700 hover:bg-ink-200'
              : 'bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold animate-glow'
          }`}
        >
          {composing
            ? 'Stop composing'
            : narrative
              ? 'Re-compose the story'
              : 'Compose the story'}
        </button>
      </div>

      {/* Timeline */}
      {sorted.length === 0 ? (
        <div className="card p-10 text-center text-sm text-ink-600">
          The story starts when you add your first exhibit with a date.
        </div>
      ) : (
        <ol className="relative ml-3 stagger">
          {/* living spine */}
          <span
            aria-hidden
            className="absolute left-[7px] top-1 bottom-1 w-px bg-gradient-to-b from-gold-400/70 via-forest-400/50 to-forest-200"
          />
          <ShowMore initial={3}>
          {sorted.map((it, idx) => {
            const accent =
              (it.category && CATEGORY_ACCENT[it.category]) ||
              KIND_ACCENT[it.kind];
            const isFuture = Date.parse(it.at) > now;
            return (
              <li key={it.id}>
                {idx === firstFutureIdx && firstFutureIdx > 0 && (
                  <div className="relative my-4 flex items-center gap-3 pl-7">
                    <span className="h-px flex-1 bg-gradient-to-r from-gold-400/60 to-transparent" />
                    <span className="text-[10px] uppercase tracking-[0.2em] font-semibold text-gold-600">
                      Today
                    </span>
                    <span className="h-px flex-[3] bg-gradient-to-l from-gold-400/60 to-transparent" />
                  </div>
                )}
                <div
                  className="relative pl-7 pb-7 animate-fade-up"
                  style={{ animationDelay: `${Math.min(idx, 12) * 55}ms` }}
                >
                  <span
                    aria-hidden
                    className={`absolute left-0 top-1 h-[15px] w-[15px] rounded-full bg-gradient-to-br ${accent} ring-4 ring-white shadow-[0_0_0_1px_rgba(15,45,36,0.08)] ${
                      isFuture ? 'opacity-60 animate-pulse' : ''
                    }`}
                  />
                  <p className="text-[11px] uppercase tracking-[0.16em] text-ink-400 font-medium">
                    {fmtDate(it.at)}
                    {isFuture && (
                      <span className="ml-2 text-gold-600">upcoming</span>
                    )}
                  </p>
                  <p className="text-[15px] font-semibold text-ink-950 mt-0.5 leading-snug">
                    {it.title}
                  </p>
                  {it.detail && (
                    <p className="text-sm text-ink-600 mt-1 leading-relaxed">
                      {it.detail}
                    </p>
                  )}
                  {it.category && (
                    <span className="badge bg-cream-50 text-forest-800 border border-gold-200 mt-2 text-[10px]">
                      {it.category}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
          </ShowMore>
        </ol>
      )}

      {/* AI narrative */}
      {(composing || narrative) && (
        <div className="card overflow-hidden">
          <div className="brand-mark px-5 py-3 flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-[0.2em] font-semibold text-gold-300">
              {composing ? 'Composing your story...' : 'Draft narrative'}
            </p>
            {done && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={copyNarrative}
                  className="text-[11px] font-semibold text-cream-100/80 hover:text-cream-100"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <span className="text-cream-100/30">·</span>
                <button
                  type="button"
                  onClick={downloadNarrative}
                  className="text-[11px] font-semibold text-cream-100/80 hover:text-cream-100"
                >
                  Download
                </button>
              </div>
            )}
          </div>
          <div
            ref={narrativeRef}
            className="max-h-[460px] overflow-y-auto px-5 py-4 text-sm leading-relaxed text-ink-800 whitespace-pre-wrap font-serif"
          >
            {narrative || (
              <span className="text-ink-400">
                Reading your timeline and composing...
              </span>
            )}
            {composing && (
              <span className="inline-block w-2 h-4 ml-0.5 bg-gold-500 align-middle animate-pulse" />
            )}
          </div>
          <p className="px-5 py-2 text-[11px] text-ink-400 border-t border-ink-100">
            Draft only - an organizational aid, not legal advice. Review
            every line for accuracy before relying on it.
          </p>
        </div>
      )}
    </section>
  );
}
