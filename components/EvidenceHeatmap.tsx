'use client';

/**
 * Evidence Strength Heatmap - flagship.
 *
 * Answers the question every litigant actually has: "do I have
 * enough to win?" The model names the elements a case of this kind
 * must establish, rates how well the litigant's real exhibits
 * support each, and says the single most useful thing to add next.
 * A premium readiness gauge + per-element heat meters + gap coaching.
 */

import { useState } from 'react';

type Strength = 'strong' | 'some' | 'thin' | 'missing';
type Element = {
  name: string;
  strength: Strength;
  why: string;
  supportedBy: string[];
  addNext: string;
};
type Result = {
  overall: number;
  summary: string;
  elements: Element[];
  exhibitCount: number;
};

const HEAT: Record<
  Strength,
  { bar: string; chip: string; pct: string; label: string }
> = {
  strong: {
    bar: 'bg-emerald-500',
    chip: 'text-emerald-800 bg-emerald-50 border-emerald-200',
    pct: 'w-full',
    label: 'Strong',
  },
  some: {
    bar: 'bg-gold-500',
    chip: 'text-forest-800 bg-cream-50 border-gold-200',
    pct: 'w-2/3',
    label: 'Some',
  },
  thin: {
    bar: 'bg-amber-500',
    chip: 'text-amber-900 bg-amber-50 border-amber-200',
    pct: 'w-1/3',
    label: 'Thin',
  },
  missing: {
    bar: 'bg-rose-500',
    chip: 'text-rose-700 bg-rose-50 border-rose-200',
    pct: 'w-[8%]',
    label: 'Missing',
  },
};

function gaugeColor(n: number) {
  if (n >= 75) return 'text-emerald-600';
  if (n >= 50) return 'text-gold-600';
  if (n >= 30) return 'text-amber-600';
  return 'text-rose-600';
}

export function EvidenceHeatmap({
  caseId,
  variant = 'consumer',
}: {
  caseId: string;
  /**
   * 'consumer' - "Evidence Strength / Do you have enough to win?": the
   * self-represented litigant asking whether they can prevail.
   * 'firm' - "Evidence Coverage / discovery gaps": same element-by-element
   * /api/strength analysis, reframed as a coverage + gap-closing read for
   * counsel working up the matter. Not "can I win" but "what's thin and
   * what do we still need to pull in discovery".
   */
  variant?: 'consumer' | 'firm';
}) {
  const isFirm = variant === 'firm';
  const [data, setData] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function run() {
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/strength', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error || 'Could not analyze right now.');
      } else {
        setData(j as Result);
      }
    } catch {
      setErr('Network error - try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-1">
            {isFirm ? 'Evidence Coverage' : 'Evidence Strength'}
          </p>
          <h2 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            {isFirm ? 'Where are the discovery gaps?' : 'Do you have enough to win?'}
          </h2>
          <p className="text-sm text-ink-500 dark:text-cream-100/70 mt-1 max-w-xl leading-relaxed">
            {isFirm
              ? 'An element-by-element read of how well the exhibits on file cover what this kind of matter has to establish - and the single item worth pulling in next to close the thinnest gap.'
              : 'An honest, element-by-element read of how well your exhibits back the things a case like this has to prove - and the one piece that would help most next.'}
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="btn bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold disabled:opacity-50"
        >
          {busy
            ? 'Analyzing...'
            : data
              ? 'Re-analyze'
              : isFirm
                ? 'Analyze coverage'
                : 'Analyze my evidence'}
        </button>
      </div>

      {err && (
        <div className="card p-5 text-sm text-rose-700 bg-rose-50/50 border-rose-200">
          {err}
        </div>
      )}

      {busy && !data && (
        <div className="card p-10 text-center text-sm text-ink-500 animate-pulse">
          Weighing each element against your exhibits...
        </div>
      )}

      {data && (
        <div className="space-y-5">
          {/* Overall gauge */}
          <div className="card p-6 flex items-center gap-6">
            <div className="relative flex-none">
              <svg width="92" height="92" viewBox="0 0 92 92" aria-hidden>
                <circle
                  cx="46"
                  cy="46"
                  r="40"
                  fill="none"
                  stroke="#e7e5e4"
                  strokeWidth="8"
                />
                <circle
                  cx="46"
                  cy="46"
                  r="40"
                  fill="none"
                  stroke="currentColor"
                  className={gaugeColor(data.overall)}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${(data.overall / 100) * 251} 251`}
                  transform="rotate(-90 46 46)"
                />
              </svg>
              <span
                className={`absolute inset-0 flex items-center justify-center text-xl font-bold tabular-nums ${gaugeColor(
                  data.overall,
                )}`}
              >
                {data.overall}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-ink-400">
                {isFirm ? 'Evidence coverage' : 'Evidence readiness'}
              </p>
              <p className="text-sm text-ink-700 mt-1 leading-relaxed">
                {data.summary}
              </p>
              <p className="text-[11px] text-ink-400 mt-1">
                Based on {data.exhibitCount} exhibit
                {data.exhibitCount === 1 ? '' : 's'}.
              </p>
            </div>
          </div>

          {/* Elements */}
          <div className="space-y-3 stagger">
            {data.elements.map((el, i) => {
              const h = HEAT[el.strength];
              return (
                <div
                  key={i}
                  className="card p-5 animate-fade-up"
                  style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[15px] font-semibold text-ink-950 leading-snug">
                      {el.name}
                    </h3>
                    <span
                      className={`badge border ${h.chip} text-[10px] flex-none`}
                    >
                      {h.label}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-ink-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${h.bar} ${h.pct} transition-all duration-700`}
                    />
                  </div>
                  <p className="text-sm text-ink-600 mt-2.5 leading-relaxed">
                    {el.why}
                  </p>
                  {el.supportedBy.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      {el.supportedBy.map((s, j) => (
                        <span
                          key={j}
                          className="badge bg-cream-50 text-forest-800 border border-gold-200 text-[10px]"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                  {el.addNext && (
                    <p className="mt-3 text-xs text-forest-800 bg-cream-50 border border-gold-200/70 rounded-lg px-3 py-2 leading-relaxed">
                      <span className="font-semibold text-gold-700">
                        Add next:{' '}
                      </span>
                      {el.addNext}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-ink-400 leading-relaxed">
            {isFirm
              ? 'A working read of the typical elements for this kind of matter - a drafting aid for the team, not a substitute for counsel judgment. Jurisdictions and facts vary; use it to prioritize what to pull in discovery.'
              : 'A general organizational read of typical elements - jurisdictions and facts vary, and this is not legal advice. Use it to find and close gaps before they matter.'}
          </p>
        </div>
      )}
    </section>
  );
}
