'use client';

import { useState, useTransition } from 'react';
import { runDefenseAdviceAction } from '@/lib/actions';
import type { DefenseAdvice } from '@/lib/types';
import type { LegalResource } from '@/lib/legal-resources';

type TabKey = 'overview' | 'defenses' | 'procedure' | 'evidence' | 'help';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'defenses', label: 'Defenses' },
  { key: 'procedure', label: 'Procedure & deadlines' },
  { key: 'evidence', label: 'Evidence to gather' },
  { key: 'help', label: 'Resources & lawyer' },
];

export function DefensePanel({
  caseId,
  advice,
  resources,
  jurisdictionLabel,
}: {
  caseId: string;
  advice: DefenseAdvice | null;
  resources: { state_specific: LegalResource[]; national: LegalResource[]; state: string | null };
  jurisdictionLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');

  function trigger() {
    setError(null);
    startTransition(async () => {
      try {
        await runDefenseAdviceAction(caseId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Defense plan failed.');
      }
    });
  }

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="badge bg-rose-50 text-rose-800 border border-rose-200 mb-2 inline-flex">
            Pro se · Defense
          </span>
          <h2 className="text-xl font-semibold tracking-tight text-ink-950">
            Defense planning
          </h2>
          <p className="text-sm text-ink-500 mt-0.5">
            For someone preparing to defend themselves, until they retain counsel.
          </p>
        </div>
        <button onClick={trigger} disabled={pending} className="btn-primary">
          {pending && <Spinner />}
          {pending ? 'Analyzing…' : advice ? 'Re-run defense plan' : 'Generate defense plan'}
        </button>
      </header>

      <CriminalCarveOut />

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      )}

      {!advice && !pending && (
        <div className="card p-10 text-center">
          <p className="text-ink-600 mb-5">
            No defense plan yet. Generate one to walk through your situation, possible defenses,
            deadlines, and what to gather.
          </p>
          <button onClick={trigger} className="btn-primary">
            Generate defense plan
          </button>
        </div>
      )}

      {advice && (
        <div className="card overflow-hidden">
          {advice.isDemo && (
            <div className="border-b border-amber-200 bg-amber-50/70 px-5 py-2.5 text-xs text-amber-900">
              Demo response — set <code className="font-mono">ANTHROPIC_API_KEY</code> in{' '}
              <code className="font-mono">.env.local</code> to enable real Claude-backed
              analysis.
            </div>
          )}

          <Tabs current={tab} onChange={setTab} />

          <div className="p-6 md:p-7 space-y-5">
            {tab === 'overview' && <Overview advice={advice} jurisdictionLabel={jurisdictionLabel} />}
            {tab === 'defenses' && <Defenses advice={advice} />}
            {tab === 'procedure' && <Procedure advice={advice} />}
            {tab === 'evidence' && <Evidence advice={advice} />}
            {tab === 'help' && (
              <Help advice={advice} resources={resources} jurisdictionLabel={jurisdictionLabel} />
            )}
          </div>

          <div className="border-t border-ink-100 px-5 py-3 bg-ink-50/50">
            <p className="text-[11px] leading-relaxed text-ink-600">
              <strong>Truth & transparency:</strong> {advice.disclaimer}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function CriminalCarveOut() {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
      <p className="font-semibold mb-1">If you are facing criminal charges or jail time</p>
      <p className="leading-relaxed">
        You have a constitutional right to a public defender at no cost. Request one at your
        first court appearance. Do not try to handle a criminal matter pro se using this tool —
        it is for organizational support only.
      </p>
    </div>
  );
}

function Tabs({ current, onChange }: { current: TabKey; onChange: (t: TabKey) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Defense plan sections"
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

function Overview({
  advice,
  jurisdictionLabel,
}: {
  advice: DefenseAdvice;
  jurisdictionLabel: string;
}) {
  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow mb-2">What you're facing</p>
        <p className="text-[15.5px] leading-relaxed text-ink-900 whitespace-pre-wrap">
          {advice.charges}
        </p>
      </div>
      <div>
        <p className="eyebrow mb-2">Summary</p>
        <p className="text-[15px] leading-relaxed text-ink-800 whitespace-pre-wrap">
          {advice.summary}
        </p>
      </div>
      <div className="rounded-lg bg-ink-50 border border-ink-100 px-5 py-4">
        <p className="eyebrow mb-2">Pro se overview · {jurisdictionLabel || 'jurisdiction'}</p>
        <p className="text-[14px] leading-relaxed text-ink-800 whitespace-pre-wrap">
          {advice.proSeOverview}
        </p>
      </div>
      <Bullets title="Risk factors" items={advice.riskFactors} />
    </div>
  );
}

function Defenses({ advice }: { advice: DefenseAdvice }) {
  return (
    <div className="space-y-5">
      <Bullets title="Possible defenses" items={advice.possibleDefenses} />
    </div>
  );
}

function Procedure({ advice }: { advice: DefenseAdvice }) {
  return (
    <div className="space-y-5">
      <Bullets title="Procedural steps and deadlines" items={advice.proceduralPosture} />
      <p className="text-xs text-ink-500 leading-relaxed">
        Verify every deadline against your summons, the local rules, and your state statute. The
        clock starts on the date you were served, which is not always the date on the document.
      </p>
    </div>
  );
}

function Evidence({ advice }: { advice: DefenseAdvice }) {
  return <Bullets title="Evidence to gather to support your defense" items={advice.evidenceToGather} />;
}

function Help({
  advice,
  resources,
  jurisdictionLabel,
}: {
  advice: DefenseAdvice;
  resources: { state_specific: LegalResource[]; national: LegalResource[]; state: string | null };
  jurisdictionLabel: string;
}) {
  return (
    <div className="space-y-6">
      <Bullets
        title="When you should hire a lawyer (or use a public defender)"
        items={advice.whenToHireLawyer}
      />

      <div>
        <h3 className="eyebrow mb-3">Vetted resources</h3>
        {resources.state_specific.length > 0 ? (
          <>
            <p className="text-xs text-ink-500 mb-3">
              State-specific{resources.state ? ` (${resources.state})` : ''} self-help and legal aid.
            </p>
            <ResourceList items={resources.state_specific} />
          </>
        ) : (
          <p className="text-xs text-ink-500 mb-3">
            No state-specific resources catalogued for {jurisdictionLabel || 'this jurisdiction'}.
            Use the national list and look for a state-specific self-help center via LawHelp.org.
          </p>
        )}
        <p className="text-xs text-ink-500 mt-4 mb-2">National resources</p>
        <ResourceList items={resources.national} />
      </div>

      <Bullets title="Topics to research" items={advice.resourceTopics} />

      <Bullets title="Questions to ask at a free consultation" items={advice.questionsForAttorney} />
    </div>
  );
}

function ResourceList({ items }: { items: LegalResource[] }) {
  return (
    <ul className="rounded-lg border border-ink-200 divide-y divide-ink-100 overflow-hidden">
      {items.map((r) => (
        <li key={r.url} className="px-4 py-3 hover:bg-ink-50/50">
          <div className="flex items-start gap-3 flex-wrap">
            <span className="badge bg-ink-100 text-ink-700">{r.category}</span>
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-ink-950 hover:underline text-sm"
            >
              {r.title}
            </a>
          </div>
          <p className="text-xs text-ink-600 mt-1 leading-relaxed">{r.description}</p>
        </li>
      ))}
    </ul>
  );
}

function Bullets({ title, items }: { title: string; items: string[] | undefined }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <h3 className="eyebrow mb-2">{title}</h3>
      <ul className="space-y-2 text-[14px] text-ink-800">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5">
            <span aria-hidden className="mt-[9px] h-1 w-1 flex-none rounded-full bg-ink-400" />
            <span className="whitespace-pre-wrap leading-relaxed">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
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
