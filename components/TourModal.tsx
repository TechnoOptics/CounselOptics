'use client';

import { useState, useTransition } from 'react';
import { markTourCompletedAction } from '@/lib/actions';

const STEPS = [
  {
    title: 'Cases organize everything',
    body: 'Each case file holds the parties, jurisdiction, posture, exhibits, and AI review. Click "New case" in the header to start one.',
  },
  {
    title: 'Subject profile',
    body: 'When you create a case you can capture details about the person, business, agency, or entity at the center of it - address, contact info, identifying details, all kept on the case.',
  },
  {
    title: 'Exhibits with metadata',
    body: 'Upload evidence on the case detail page. Each upload becomes an auto-numbered exhibit with category, source, and incident date captured.',
  },
  {
    title: 'AI review (Standard / Pro)',
    body: 'Run a Claude-backed review for jurisdiction-aware issue spotting, evidence to gather, and possible subpoena targets.',
  },
  {
    title: 'Collaborators (Pro)',
    body: 'Invite your attorney by email - they can read the case and add exhibits, but cannot modify the matter.',
  },
  {
    title: 'Bella, on demand',
    body: 'Click "Ask Bella" any time for plain-language legal info, app help, or to summarize the case you\'re viewing.',
  },
];

export function TourModal({ visible }: { visible: boolean }) {
  const [open, setOpen] = useState(visible);
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();

  if (!open) return null;

  function dismiss(opts: { saveCompleted?: boolean } = {}) {
    setOpen(false);
    if (opts.saveCompleted) {
      startTransition(async () => {
        try {
          await markTourCompletedAction();
        } catch {
          /* ignore */
        }
      });
    }
  }

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-forest-950/40 backdrop-blur-sm">
      <div
        role="dialog"
        aria-label="Welcome tour"
        className="relative w-full max-w-md bg-white rounded-2xl shadow-card-hover border border-forest-200 overflow-hidden"
      >
        <div className="brand-mark px-6 py-5 text-cream-100">
          <p className="text-[10px] uppercase tracking-[0.2em] text-gold-400 font-semibold">
            Quick tour · Step {step + 1} of {STEPS.length}
          </p>
          <h2 className="text-lg font-semibold tracking-tight mt-1">{current.title}</h2>
        </div>
        <div className="px-6 py-5">
          <p className="text-sm text-ink-700 leading-relaxed">{current.body}</p>
          <div className="flex items-center justify-between mt-5">
            <button
              type="button"
              onClick={() => dismiss({ saveCompleted: true })}
              className="text-xs text-ink-500 hover:text-ink-900 underline"
            >
              Skip tour
            </button>
            <div className="flex items-center gap-2">
              {step > 0 && (
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                  className="btn-secondary"
                >
                  Back
                </button>
              )}
              {!isLast ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                  className="btn-primary"
                >
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => dismiss({ saveCompleted: true })}
                  disabled={pending}
                  className="btn-primary"
                >
                  {pending ? 'Saving…' : 'Got it'}
                </button>
              )}
            </div>
          </div>
        </div>
        {/* Progress dots */}
        <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1 rounded-full transition-all ${
                i === step ? 'w-6 bg-forest-900' : 'w-1.5 bg-ink-300'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
