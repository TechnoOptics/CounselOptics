'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { closeCaseWithSurveyAction, setCaseStatusAction } from '@/lib/actions';
import type { CaseStatus } from '@/lib/types';

type Phase = 'idle' | 'survey' | 'closed';

export function CloseCaseControl({
  caseId,
  status,
  isOwner,
}: {
  caseId: string;
  status: CaseStatus;
  isOwner: boolean;
}) {
  const initialPhase: Phase =
    status === 'closed' || status === 'archived' ? 'closed' : 'idle';
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [rating, setRating] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<string>('');
  const [whatWorked, setWhatWorked] = useState('');
  const [whatCouldImprove, setWhatCouldImprove] = useState('');
  const [mayContact, setMayContact] = useState(false);

  if (!isOwner) return null;

  function reopen() {
    setError(null);
    startTransition(async () => {
      try {
        await setCaseStatusAction(caseId, 'open');
        setPhase('idle');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not reopen.');
      }
    });
  }

  function submit(skipSurvey = false) {
    setError(null);
    startTransition(async () => {
      try {
        await closeCaseWithSurveyAction(caseId, {
          helpfulRating: skipSurvey ? null : rating,
          outcome: skipSurvey ? null : outcome || null,
          whatWorked: skipSurvey ? '' : whatWorked,
          whatCouldImprove: skipSurvey ? '' : whatCouldImprove,
          mayContact: skipSurvey ? false : mayContact,
        });
        setPhase('closed');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not close.');
      }
    });
  }

  // ---------- Closed state ----------
  if (phase === 'closed') {
    return (
      <section className="card relative overflow-hidden p-6">
        <div
          aria-hidden
          className="absolute -right-6 -top-6 text-emerald-500/10 pointer-events-none"
        >
          <CheckCircle size={140} />
        </div>
        <div className="relative space-y-3">
          <p className="eyebrow">Case closed</p>
          <h2 className="text-lg font-semibold tracking-tight text-forest-900">
            Thanks - your case is filed away.
          </h2>
          <div className="text-sm text-ink-700 leading-relaxed space-y-2 max-w-2xl">
            <p>
              You can reopen it any time. Here&apos;s where to find it later:
            </p>
            <ul className="list-disc list-outside pl-5 space-y-1 text-ink-700">
              <li>
                <Link href="/cases" className="underline text-forest-900 hover:text-forest-700">
                  Cases page
                </Link>{' '}
                - expand <strong>Closed cases</strong> at the bottom.
              </li>
              <li>
                Use the <strong>search icon</strong> in the top header (or press{' '}
                <kbd className="font-mono text-[11px] border border-ink-200 rounded px-1">⌘K</kbd>{' '}
                /{' '}
                <kbd className="font-mono text-[11px] border border-ink-200 rounded px-1">/</kbd>
                ) and type any keyword from the case.
              </li>
              <li>
                Bookmark this exact URL for one-click access.
              </li>
            </ul>
            <p className="text-ink-600">
              Exhibits and the Advottic Review review packet stay attached - nothing is deleted.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Link href="/cases" className="btn-secondary">
              Back to cases
            </Link>
            <button
              type="button"
              onClick={reopen}
              disabled={pending}
              className="btn-ghost"
            >
              {pending ? 'Reopening...' : 'Reopen case'}
            </button>
          </div>
          {error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {error}
            </p>
          )}
        </div>
      </section>
    );
  }

  // ---------- Survey form ----------
  if (phase === 'survey') {
    return (
      <section className="card p-6 space-y-5 animate-fade-up">
        <div>
          <p className="eyebrow mb-1">Quick survey</p>
          <h2 className="text-lg font-semibold tracking-tight text-forest-900">
            Before we close - 30 seconds, optional.
          </h2>
          <p className="text-sm text-ink-600 mt-1 max-w-xl leading-relaxed">
            Your answers help us improve Advottic. None of this is shared outside our team.
          </p>
        </div>

        {/* Helpfulness rating */}
        <fieldset>
          <legend className="label mb-2">How helpful was Advottic for this case?</legend>
          <div className="flex flex-wrap gap-2">
            {[
              { v: 1, label: 'Not at all' },
              { v: 2, label: 'A little' },
              { v: 3, label: 'OK' },
              { v: 4, label: 'Helpful' },
              { v: 5, label: 'Very helpful' },
            ].map((o) => {
              const sel = rating === o.v;
              return (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setRating(sel ? null : o.v)}
                  className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                    sel
                      ? 'bg-forest-900 border-forest-900 text-cream-100'
                      : 'bg-white border-ink-200 text-ink-700 hover:border-gold-500'
                  }`}
                >
                  <span className="font-mono text-xs mr-1.5">{o.v}</span>
                  {o.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Outcome */}
        <fieldset>
          <legend className="label mb-2">How did this matter end?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { v: 'resolved', label: 'Resolved in my favor' },
              { v: 'settled', label: 'Settled or compromised' },
              { v: 'dropped', label: 'Dropped or no further action' },
              { v: 'ongoing_other_tool', label: 'Still ongoing - moved elsewhere' },
              { v: 'other', label: 'Other' },
            ].map((o) => {
              const sel = outcome === o.v;
              return (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setOutcome(sel ? '' : o.v)}
                  className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                    sel
                      ? 'bg-cream-50 border-forest-900 text-forest-900 ring-2 ring-forest-900/15'
                      : 'bg-white border-ink-200 text-ink-700 hover:border-gold-500'
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="cs-worked">
              What worked well? (optional)
            </label>
            <textarea
              id="cs-worked"
              value={whatWorked}
              onChange={(e) => setWhatWorked(e.target.value)}
              rows={3}
              maxLength={1000}
              className="input"
              placeholder="Exhibit organization, Advottic Review review, hearing prep..."
            />
          </div>
          <div>
            <label className="label" htmlFor="cs-improve">
              What could be better? (optional)
            </label>
            <textarea
              id="cs-improve"
              value={whatCouldImprove}
              onChange={(e) => setWhatCouldImprove(e.target.value)}
              rows={3}
              maxLength={1000}
              className="input"
              placeholder="Slow exports, missing field, confusing step..."
            />
          </div>
        </div>

        <label className="flex items-start gap-2.5 text-sm text-ink-700 cursor-pointer">
          <input
            type="checkbox"
            checked={mayContact}
            onChange={(e) => setMayContact(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-ink-300 text-forest-900 focus:ring-forest-900"
          />
          <span className="leading-relaxed">
            You may contact me at my account email about this feedback.
          </span>
        </label>

        <div className="rounded-lg border border-gold-200 bg-cream-50 px-4 py-3 text-xs text-forest-900 leading-relaxed">
          After closing, the case stays under{' '}
          <strong>Cases → Closed cases</strong> and is searchable from the header search ({' '}
          <kbd className="font-mono border border-ink-200 rounded px-1">⌘K</kbd> or{' '}
          <kbd className="font-mono border border-ink-200 rounded px-1">/</kbd>). Nothing is
          deleted. You can reopen any time.
        </div>

        {error && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={() => setPhase('idle')}
            disabled={pending}
            className="btn-ghost"
          >
            Back
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => submit(true)}
              disabled={pending}
              className="btn-secondary"
            >
              Skip &amp; close
            </button>
            <button
              type="button"
              onClick={() => submit(false)}
              disabled={pending}
              className="btn bg-forest-900 text-cream-200 hover:bg-forest-800"
            >
              {pending ? 'Closing...' : 'Submit &amp; close'}
            </button>
          </div>
        </div>
      </section>
    );
  }

  // ---------- Idle / entry point ----------
  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow mb-1">Case lifecycle</p>
          <h2 className="text-lg font-semibold tracking-tight text-forest-900">
            Close this case
          </h2>
          <p className="text-sm text-ink-600 mt-1 max-w-xl leading-relaxed">
            We&apos;ll ask a 30-second optional survey, then move this case to your{' '}
            <strong>Closed cases</strong> section. Nothing is deleted - exhibits, the Advottic Review
            review, and PDF export stay accessible. Reopen any time.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPhase('survey')}
          disabled={pending}
          className="btn-secondary"
        >
          Close case
        </button>
      </div>
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 mt-3">
          {error}
        </p>
      )}
    </section>
  );
}

function CheckCircle({ size = 140 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 12.5l3 3 5-6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
