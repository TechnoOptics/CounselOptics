/**
 * "Facts of the case": a concise, single place that surfaces everything
 * captured when the case was created (subject, jurisdiction, type, posture,
 * status, hearing, description) at the top of the Timeline, so the whole
 * matter reads at a glance before the evidence.
 */

export type CaseFacts = {
  title: string;
  subjectName: string | null;
  subjectType: string | null;
  jurisdiction: string | null;
  caseType: string | null;
  posture: string | null;
  status: string | null;
  description: string | null;
  hearingAt: string | null;
  hearingLocation: string | null;
  createdAt: string | null;
};

function pretty(v: string | null | undefined): string | null {
  if (!v) return null;
  return v
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function FactsPanel({ facts }: { facts: CaseFacts }) {
  const hearing =
    facts.hearingAt
      ? [fmtDate(facts.hearingAt), facts.hearingLocation].filter(Boolean).join(' · ')
      : facts.hearingLocation || 'None scheduled';

  const rows: Array<[string, string | null]> = [
    ['Subject', facts.subjectName],
    ['Subject type', pretty(facts.subjectType)],
    ['Jurisdiction', pretty(facts.jurisdiction)],
    ['Case type', pretty(facts.caseType)],
    ['Posture', pretty(facts.posture)],
    ['Status', pretty(facts.status)],
    ['Next hearing', hearing],
    ['Opened', fmtDate(facts.createdAt)],
  ];
  const shown = rows.filter(([, v]) => Boolean(v));

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-forest-900/10 bg-white shadow-card dark:border-cream-50/10 dark:bg-forest-900/50">
      <div className="border-b border-forest-900/10 bg-forest-900/[0.02] px-5 py-3 dark:border-cream-50/10 dark:bg-cream-50/[0.03]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-700 dark:text-gold-500">
          Facts of the case
        </p>
        <h2 className="mt-0.5 font-display text-lg font-semibold text-forest-900 dark:text-cream-50" data-no-translate>
          {facts.title}
        </h2>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 dark:text-cream-300/50">
              {label}
            </dt>
            <dd className="mt-0.5 truncate text-sm font-medium text-forest-900 dark:text-cream-100" title={value ?? undefined} data-no-translate>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {facts.description && (
        <div className="border-t border-forest-900/10 px-5 py-4 dark:border-cream-50/10">
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink-700 dark:text-cream-200/90" data-no-translate>
            {facts.description}
          </p>
        </div>
      )}
    </section>
  );
}
