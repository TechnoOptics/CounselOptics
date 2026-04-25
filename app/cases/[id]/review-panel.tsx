'use client';

import { useState, useTransition } from 'react';
import { runReviewAction } from '@/lib/actions';
import type { AIReview } from '@/lib/types';

type TabKey = 'overview' | 'facts' | 'evidence' | 'actions';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'facts', label: 'Facts & issues' },
  { key: 'evidence', label: 'Evidence & discovery' },
  { key: 'actions', label: 'Next steps' },
];

export function ReviewPanel({
  caseId,
  review,
}: {
  caseId: string;
  review: AIReview | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');

  function trigger() {
    setError(null);
    startTransition(async () => {
      try {
        await runReviewAction(caseId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Review failed.');
      }
    });
  }

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-ink-950">Case review</h2>
          <p className="text-sm text-ink-500 mt-0.5">
            {review ? (
              <>
                Last reviewed {formatRelative(review.createdAt)} ·{' '}
                <span className="font-mono text-[11px] text-ink-400">{review.modelUsed}</span>
              </>
            ) : (
              'AI-assisted issue spotting based on the case description and exhibits.'
            )}
          </p>
        </div>
        <button onClick={trigger} disabled={pending} className="btn-primary">
          {pending && <Spinner />}
          {pending ? 'Reviewing…' : review ? 'Re-run review' : 'Run review'}
        </button>
      </header>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      )}

      {!review && !pending && (
        <div className="card p-10 text-center">
          <p className="text-ink-600 mb-5">
            No review yet. Generate a structured legal issue-spotting summary for this case.
          </p>
          <button onClick={trigger} className="btn-primary">
            Run review
          </button>
        </div>
      )}

      {review && (
        <div className="card overflow-hidden">
          {review.isDemo && (
            <div className="border-b border-amber-200 bg-amber-50/70 px-5 py-2.5 text-xs text-amber-900">
              Demo response - set <code className="font-mono">ANTHROPIC_API_KEY</code> in{' '}
              <code className="font-mono">.env.local</code> to enable real Claude-backed analysis.
            </div>
          )}

          <Tabs current={tab} onChange={setTab} />

          <div className="p-6 md:p-7 space-y-5">
            {tab === 'overview' && <Overview review={review} />}
            {tab === 'facts' && <Facts review={review} />}
            {tab === 'evidence' && <Evidence review={review} />}
            {tab === 'actions' && <Actions review={review} />}
          </div>

          <div className="border-t border-ink-100 px-5 py-3 bg-ink-50/50">
            <p className="text-[11px] leading-relaxed text-ink-500">{review.disclaimer}</p>
          </div>
        </div>
      )}
    </section>
  );
}

function Tabs({ current, onChange }: { current: TabKey; onChange: (t: TabKey) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Case review sections"
      className="flex items-stretch border-b border-ink-200 bg-white overflow-x-auto"
    >
      {TABS.map((t) => {
        const active = t.key === current;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={`tab ${active ? 'tab-active' : ''}`}
          >
            {t.label}
            {active && <span aria-hidden className="tab-underline" />}
          </button>
        );
      })}
    </div>
  );
}

function Overview({ review }: { review: AIReview }) {
  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="eyebrow">Classification</span>
          <span className="inline-flex items-center rounded-full bg-ink-950 text-white px-2.5 py-1 text-[11px] font-medium tracking-wide leading-none">
            {shortLabel(review.classification)}
          </span>
        </div>
        <p className="text-[15.5px] leading-relaxed text-ink-900 whitespace-pre-wrap">
          {review.summary}
        </p>
      </div>
      {review.classification && (
        <div className="rounded-lg bg-ink-50 border border-ink-100 px-4 py-3 text-sm text-ink-700 leading-relaxed">
          {review.classification}
        </div>
      )}
    </div>
  );
}

function Facts({ review }: { review: AIReview }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Panel title="Timeline" items={review.timeline} />
      <Panel title="Key facts" items={review.keyFacts} />
      <Panel title="Possible legal issues" items={review.possibleIssues} />
      <Panel
        title="Applicable doctrines"
        subtitle="Attorney to verify against current statutes"
        items={review.applicableLegalReferences}
      />
    </div>
  );
}

function Evidence({ review }: { review: AIReview }) {
  const hasEvidence = (review.evidenceToStrengthen ?? []).length > 0;
  const hasSubpoena = (review.subpoenaTargets ?? []).length > 0;
  const hasMapping = review.evidenceMapping.length > 0;

  if (!hasEvidence && !hasSubpoena && !hasMapping) {
    return <p className="text-sm text-ink-500">No evidence recommendations in this review.</p>;
  }

  return (
    <div className="space-y-6">
      <AccentList
        title="Evidence to strengthen the case"
        items={review.evidenceToStrengthen}
        accent="emerald"
      />
      <AccentList
        title="Possible subpoena / records targets"
        subtitle="Attorney must confirm the appropriate legal process."
        items={review.subpoenaTargets}
        accent="sky"
      />
      <Panel title="Evidence mapping to exhibits" items={review.evidenceMapping} />
    </div>
  );
}

function Actions({ review }: { review: AIReview }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Panel title="Missing information" items={review.missingInformation} />
      <Panel title="Suggested next steps" items={review.suggestedNextSteps} />
      <div className="md:col-span-2">
        <Panel title="Questions to ask an attorney" items={review.questionsForAttorney} />
      </div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle?: string;
  items: string[] | undefined;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div className="rounded-lg border border-ink-100 bg-white p-5">
      <div className="mb-3">
        <h3 className="eyebrow">{title}</h3>
        {subtitle && <p className="text-xs text-ink-400 mt-0.5">{subtitle}</p>}
      </div>
      <ul className="space-y-2 text-[14px] text-ink-800">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5">
            <span
              aria-hidden
              className="mt-[9px] h-1 w-1 flex-none rounded-full bg-ink-400"
            />
            <span className="whitespace-pre-wrap leading-relaxed">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AccentList({
  title,
  subtitle,
  items,
  accent,
}: {
  title: string;
  subtitle?: string;
  items: string[] | undefined;
  accent: 'emerald' | 'sky';
}) {
  if (!items || items.length === 0) return null;
  const styles = {
    emerald: {
      border: 'border-emerald-300/80',
      bg: 'bg-emerald-50/40',
      bar: 'bg-emerald-400',
    },
    sky: {
      border: 'border-sky-300/80',
      bg: 'bg-sky-50/40',
      bar: 'bg-sky-400',
    },
  }[accent];
  return (
    <div>
      <div className="mb-2.5">
        <h4 className="text-[13px] font-semibold tracking-tight text-ink-950">{title}</h4>
        {subtitle && <p className="text-xs text-ink-500 mt-0.5">{subtitle}</p>}
      </div>
      <ul
        className={`rounded-lg border ${styles.border} ${styles.bg} divide-y divide-ink-100/70 overflow-hidden`}
      >
        {items.map((item, i) => (
          <li key={i} className="relative px-4 py-3 text-[14px] text-ink-800 leading-relaxed">
            <span
              aria-hidden
              className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-r ${styles.bar}`}
            />
            <span className="whitespace-pre-wrap block pl-1.5">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function shortLabel(c: string): string {
  const cleaned = c.replace(/\s+/g, ' ').trim();
  const first = cleaned.split(/[-:;.]/, 1)[0].trim();
  return first.length > 56 ? first.slice(0, 53) + '…' : first;
}

function formatRelative(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diff = now - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin text-current"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 1-9 9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
