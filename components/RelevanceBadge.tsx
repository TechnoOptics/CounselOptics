import { relevanceBand } from '@/lib/timeline-types';

/**
 * A small badge showing how relevant an evidence item is to its case (0-100),
 * scored by the reader against the case facts. Distinct from extraction
 * confidence. Renders nothing when the item was not scored.
 */
export function RelevanceBadge({
  score,
  reason,
  size = 'sm',
}: {
  score: number | undefined | null;
  reason?: string | null;
  size?: 'sm' | 'xs';
}) {
  const band = relevanceBand(score ?? undefined);
  if (!band || typeof score !== 'number') return null;

  const tone =
    band === 'high'
      ? 'bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:ring-emerald-700/40'
      : band === 'medium'
        ? 'bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-700/40'
        : 'bg-ink-100 text-ink-600 ring-ink-200 dark:bg-forest-800/50 dark:text-cream-100/70 dark:ring-forest-700/40';
  const label = band === 'high' ? 'Highly relevant' : band === 'medium' ? 'Relevant' : 'Low relevance';
  const pad = size === 'xs' ? 'px-1.5 py-[1px] text-[10px]' : 'px-2 py-0.5 text-[11px]';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold uppercase tracking-[0.08em] ring-1 ${pad} ${tone}`}
      title={reason || `Relevance to this case: ${score}/100`}
      data-no-translate
    >
      {label}
      <span className="font-mono opacity-70">{score}</span>
    </span>
  );
}
