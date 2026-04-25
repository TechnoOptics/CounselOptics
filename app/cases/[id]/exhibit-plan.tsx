'use client';

import { useState, useTransition } from 'react';
import { planExhibitsAction } from '@/lib/actions';
import type { Exhibit, ExhibitPlanItem } from '@/lib/types';
import { UploadForm } from './upload-form';

export function ExhibitPlanSection({
  caseId,
  plans,
  exhibits,
}: {
  caseId: string;
  plans: ExhibitPlanItem[];
  exhibits: Exhibit[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [openSlot, setOpenSlot] = useState<string | null>(null);

  function trigger() {
    setError(null);
    startTransition(async () => {
      try {
        await planExhibitsAction(caseId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Plan generation failed.');
      }
    });
  }

  const filledCount = plans.filter((p) => p.filledByExhibitId).length;

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-ink-950">Exhibit plan</h2>
          <p className="text-sm text-ink-500 mt-0.5">
            {plans.length === 0
              ? 'AI-generated list of exhibit slots (A–Z) tailored to this case.'
              : `${filledCount} of ${plans.length} slot${plans.length === 1 ? '' : 's'} filled.`}
          </p>
        </div>
        <button onClick={trigger} disabled={pending} className="btn-secondary">
          {pending && <Spinner />}
          {pending
            ? 'Generating…'
            : plans.length === 0
              ? 'Generate exhibit plan'
              : 'Regenerate plan'}
        </button>
      </header>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      )}

      {plans.length > 0 && (
        <ul className="card divide-y divide-ink-100 overflow-hidden">
          {plans.map((p) => {
            const filled = p.filledByExhibitId
              ? exhibits.find((e) => e.id === p.filledByExhibitId)
              : null;
            const isOpen = openSlot === p.id;
            return (
              <li key={p.id} className="px-5 py-4">
                <div className="flex items-start gap-4">
                  <span
                    className={`badge font-mono tracking-wide ${filled ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-ink-100 text-ink-700'}`}
                  >
                    {p.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold text-ink-950 text-[15px] leading-tight">
                        {p.title}
                      </p>
                      {filled ? (
                        <span className="text-xs text-emerald-700 whitespace-nowrap">
                          ✓ {filled.fileName}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setOpenSlot(isOpen ? null : p.id)}
                          className="text-xs text-ink-700 hover:text-ink-950 underline"
                        >
                          {isOpen ? 'Cancel' : 'Upload'}
                        </button>
                      )}
                    </div>
                    {p.description && (
                      <p className="text-sm text-ink-600 mt-1 leading-relaxed">
                        {p.description}
                      </p>
                    )}
                    {isOpen && !filled && (
                      <div className="mt-4 rounded-lg border border-ink-200 bg-ink-50/50 p-4">
                        <UploadForm caseId={caseId} planItemId={p.id} />
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
