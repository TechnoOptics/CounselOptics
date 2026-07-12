'use client';

import { useMemo, useState } from 'react';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { EvidenceHeatmap } from '@/components/EvidenceHeatmap';
import { KindIcon } from '@/components/counsel/KindIcon';
import {
  KIND_LABEL,
  relevanceBand,
  type TimelineEvent,
  type TimelineKind,
} from '@/lib/timeline-types';

/**
 * The evidence intake dashboard: a persistent read of where the case's evidence
 * stands. It shows how far analysis has run, how the items bucket by relevance
 * to the matter, what kinds of files are on file, and (on a firm plan) an
 * on-demand coverage read via the shared Evidence Coverage component. It derives
 * entirely from the live `events` list the intake already keeps in sync, so it
 * updates the moment items land or fresh scores arrive.
 */
export function EvidenceDashboard({
  events,
  caseId,
  aiEnabled,
}: {
  events: TimelineEvent[];
  caseId: string;
  aiEnabled: boolean;
}) {
  const t = useT();
  const [showCoverage, setShowCoverage] = useState(false);

  const stats = useMemo(() => {
    let analysed = 0; // reached a terminal analysis state (done or error)
    let high = 0;
    let medium = 0;
    let low = 0;
    let unsure = 0; // analysed but no case-relevance score
    let needsReview = 0; // not yet analysed or failed
    const kinds = new Map<TimelineKind, number>();

    for (const e of events) {
      kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
      const s = e.aiStatus;
      if (s === 'done' || s === 'error') analysed += 1;
      if (s === 'error' || s === 'skipped' || s === 'pending' || s === 'running') {
        needsReview += 1;
      }
      if (s === 'done') {
        const band = relevanceBand(e.aiExtracted?.relevance_score);
        if (band === 'high') high += 1;
        else if (band === 'medium') medium += 1;
        else if (band === 'low') low += 1;
        else unsure += 1;
      }
    }

    const types = [...kinds.entries()].sort((a, b) => b[1] - a[1]);
    return { total: events.length, analysed, high, medium, low, unsure, needsReview, types };
  }, [events]);

  const pct = stats.total ? Math.round((stats.analysed / stats.total) * 100) : 0;

  return (
    <section className="card space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-[15px] font-medium text-forest-900 dark:text-cream-100">
          <T>Case evidence at a glance</T>
        </h2>
        {aiEnabled && (
          <button
            type="button"
            onClick={() => setShowCoverage((v) => !v)}
            className="text-[12px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 px-2.5 py-1 text-ink-700 dark:text-cream-100/85 hover:bg-cream-50 dark:hover:bg-forest-800/30"
          >
            {showCoverage ? <T>Hide coverage</T> : <T>Evidence coverage</T>}
          </button>
        )}
      </div>

      {/* Analysis progress */}
      {aiEnabled && (
        <div>
          <div className="mb-1 flex items-center justify-between text-[11.5px] text-ink-500 dark:text-cream-100/55">
            <span data-no-translate>
              {t('{d} of {n} analysed').replace('{d}', String(stats.analysed)).replace('{n}', String(stats.total))}
            </span>
            <span className="font-mono" data-no-translate>{pct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-forest-800/50">
            <div
              className="h-full rounded-full bg-forest-600 transition-all duration-500 dark:bg-forest-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Count tiles */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label={t('Total uploaded')} value={stats.total} tone="neutral" />
        {aiEnabled ? (
          <>
            <Tile label={t('Highly relevant')} value={stats.high} tone="high" />
            <Tile label={t('Relevant')} value={stats.medium} tone="medium" />
            <Tile label={t('Low relevance')} value={stats.low} tone="low" />
            <Tile label={t('Unsure')} value={stats.unsure} tone="neutral" />
            <Tile label={t('Needs review')} value={stats.needsReview} tone="review" />
          </>
        ) : (
          <Tile label={t('File types')} value={stats.types.length} tone="neutral" />
        )}
      </div>

      {/* Relevance distribution bar */}
      {aiEnabled && stats.analysed > 0 && (
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-forest-800/50">
          <Seg n={stats.high} total={stats.analysed} className="bg-emerald-500" />
          <Seg n={stats.medium} total={stats.analysed} className="bg-amber-500" />
          <Seg n={stats.low} total={stats.analysed} className="bg-ink-300 dark:bg-forest-600" />
          <Seg n={stats.unsure} total={stats.analysed} className="bg-ink-200 dark:bg-forest-700/60" />
        </div>
      )}

      {/* Evidence types */}
      {stats.types.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] uppercase tracking-[0.06em] text-ink-400 dark:text-cream-100/45">
            <T>Evidence types</T>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {stats.types.map(([kind, n]) => (
              <span
                key={kind}
                className="inline-flex items-center gap-1 rounded-full bg-cream-100/80 px-2.5 py-1 text-[11.5px] text-ink-700 dark:bg-forest-800/50 dark:text-cream-100/80"
                data-no-translate
              >
                <KindIcon kind={kind} className="h-3.5 w-3.5 shrink-0" />
                {KIND_LABEL[kind]}
                <span className="font-mono text-ink-400 dark:text-cream-100/45">{n}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Coverage / strength (reuses the firm Evidence Coverage read) */}
      {aiEnabled && showCoverage && (
        <div className="border-t border-ink-100 pt-4 dark:border-forest-700/40">
          <EvidenceHeatmap caseId={caseId} variant="firm" />
        </div>
      )}
    </section>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'neutral' | 'high' | 'medium' | 'low' | 'review';
}) {
  const toneCls =
    tone === 'high'
      ? 'text-emerald-700 dark:text-emerald-300'
      : tone === 'medium'
        ? 'text-amber-700 dark:text-amber-300'
        : tone === 'review'
          ? 'text-rose-600 dark:text-rose-300'
          : 'text-forest-900 dark:text-cream-100';
  return (
    <div className="rounded-lg bg-cream-50/70 p-2.5 ring-1 ring-ink-100 dark:bg-forest-900/30 dark:ring-forest-800/40">
      <p className={`font-display text-xl font-semibold tabular-nums ${toneCls}`} data-no-translate>
        {value}
      </p>
      <p className="mt-0.5 text-[10.5px] leading-tight text-ink-500 dark:text-cream-100/55">{label}</p>
    </div>
  );
}

function Seg({ n, total, className }: { n: number; total: number; className: string }) {
  if (n <= 0) return null;
  return <div className={className} style={{ width: `${(n / total) * 100}%` }} />;
}
