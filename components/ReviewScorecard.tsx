import type { DocScorecard } from '@/lib/doc-review';

/**
 * Read-only Advottic Review scorecard. Presentational + server-safe
 * so it can render on the Counsel intake detail (legal sees what the
 * employee's contract scored) and on the employee's own request.
 */
/*
 * A solid fill needs a foreground that can be read ON it, and white
 * cannot be read on a bright green: `bg-emerald-500 text-white` was
 * 2.54:1 and `bg-emerald-600 text-white` 3.77:1, on both themes,
 * because the badge never depended on the theme at all. The C row
 * already had the answer. Bright fills take the near-black foreground,
 * deep fills keep white, and A stays lighter than B so the ramp still
 * reads top to bottom. tests/accent-text.test.ts measures every pair.
 */
const GRADE_STYLE: Record<string, string> = {
  A: 'bg-emerald-400 text-forest-950',
  B: 'bg-emerald-500 text-forest-950',
  C: 'bg-amber-500 text-forest-950',
  D: 'bg-rose-600 text-white',
  F: 'bg-rose-700 text-white',
};

export function ReviewScorecard({
  data,
  audience,
}: {
  data: DocScorecard;
  /** 'legal' = counsel viewing; 'employee' = the submitter. */
  audience: 'legal' | 'employee';
}) {
  const s = data;
  return (
    <section className="card p-5 space-y-3">
      <p className="eyebrow">Advottic Review</p>
      <div className="flex items-center gap-3">
        <span
          className={`inline-flex h-11 w-11 items-center justify-center rounded-xl font-display text-2xl font-bold ${
            GRADE_STYLE[s.grade] ?? 'bg-ink-500 text-white'
          }`}
        >
          {s.grade}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-forest-900 dark:text-cream-100">
            Grade {s.grade}{' '}
            <span
              className={
                s.passes
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-rose-700 dark:text-rose-300'
              }
            >
              · {s.passes ? 'Cleared' : 'Below threshold'}
            </span>
          </p>
          <p className="text-[12px] text-ink-600 dark:text-cream-100/65 leading-snug">
            {audience === 'legal'
              ? 'Score the submitter saw before this was filed.'
              : 'How your document scored when you submitted it.'}
          </p>
        </div>
      </div>

      <p className="text-[13px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
        {s.summary}
      </p>

      <div>
        <div className="flex items-center justify-between text-[11.5px] text-ink-600 dark:text-cream-100/65 mb-1">
          <span>Bias: {s.biasToward}</span>
          <span className="font-mono">{s.biasScore}/100</span>
        </div>
        <div className="h-2 rounded-full bg-ink-200 dark:bg-forest-800 overflow-hidden">
          <div
            className={`h-full rounded-full ${
              s.biasScore < 34
                ? 'bg-emerald-500'
                : s.biasScore < 67
                  ? 'bg-amber-500'
                  : 'bg-rose-500'
            }`}
            style={{ width: `${s.biasScore}%` }}
          />
        </div>
      </div>

      {s.vulnerabilities.length > 0 && (
        <div>
          <p className="text-[12px] font-semibold text-forest-900 dark:text-cream-100 mb-1">
            Vulnerabilities
          </p>
          <ul className="space-y-1">
            {s.vulnerabilities.map((v, i) => (
              <li
                key={i}
                className="text-[12.5px] text-ink-700 dark:text-cream-100/75 flex gap-2"
              >
                <span className="text-rose-500">•</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-[12px] font-semibold text-forest-900 dark:text-cream-100 mb-1">
          State-law relevance
        </p>
        <p className="text-[12.5px] text-ink-700 dark:text-cream-100/75 leading-relaxed">
          {s.stateLawNotes}
        </p>
      </div>

      {s.suggestedRevisions.length > 0 && (
        <div>
          <p className="text-[12px] font-semibold text-forest-900 dark:text-cream-100 mb-1">
            Suggested revisions
          </p>
          <ol className="space-y-1 list-decimal pl-4">
            {s.suggestedRevisions.map((v, i) => (
              <li
                key={i}
                className="text-[12.5px] text-ink-700 dark:text-cream-100/75"
              >
                {v}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
