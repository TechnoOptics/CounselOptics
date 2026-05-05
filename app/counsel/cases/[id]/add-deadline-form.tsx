'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addDeadlineAction, type DeadlineKind } from '@/lib/deadlines-actions';
import { suggestSOL } from '@/lib/deadlines-data';

const KIND_LABEL: Record<DeadlineKind, string> = {
  statute_of_limitations: 'Statute of limitations',
  response_due: 'Response due',
  discovery_due: 'Discovery due',
  motion_due: 'Motion due',
  hearing: 'Hearing',
  trial: 'Trial',
  filing_deadline: 'Filing deadline',
  appeal: 'Appeal',
  custom: 'Custom',
};

export function AddDeadlineForm({
  caseId,
  firmId,
  jurisdictionState,
}: {
  caseId: string;
  firmId: string;
  jurisdictionState: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<DeadlineKind>('custom');
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [solHint, setSolHint] = useState<string | null>(null);

  function submit() {
    setError(null);
    if (!title.trim() || !dueAt) {
      setError('Title and date are required.');
      return;
    }
    startTransition(async () => {
      const res = await addDeadlineAction(caseId, {
        firmId,
        kind,
        title: title.trim(),
        dueAt: new Date(dueAt).toISOString(),
        jurisdiction: jurisdictionState ?? null,
      });
      if (res.ok) {
        setOpen(false);
        setTitle('');
        setDueAt('');
        setKind('custom');
        setSolHint(null);
        router.refresh();
      } else {
        setError(res.error ?? 'Failed.');
      }
    });
  }

  function onPickSOL(claimType: string) {
    if (!jurisdictionState) {
      setSolHint('Set the matter jurisdiction first to suggest a SOL date.');
      return;
    }
    const suggested = suggestSOL(
      new Date().toISOString(),
      jurisdictionState,
      claimType as Parameters<typeof suggestSOL>[2],
    );
    if (suggested) {
      setKind('statute_of_limitations');
      setTitle(`SOL: ${claimType.replace(/_/g, ' ')}`);
      setDueAt(suggested.dueAt.slice(0, 16));
      setSolHint(suggested.reminder);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary text-sm"
      >
        Add a deadline
      </button>
    );
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="grid sm:grid-cols-3 gap-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.currentTarget.value as DeadlineKind)}
          className="input text-sm"
        >
          {(Object.entries(KIND_LABEL) as Array<[DeadlineKind, string]>).map(
            ([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ),
          )}
        </select>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="input text-sm sm:col-span-2"
        />
      </div>
      <input
        type="datetime-local"
        value={dueAt}
        onChange={(e) => setDueAt(e.target.value)}
        className="input text-sm"
      />

      <div className="text-[11px] text-ink-600 dark:text-cream-100/70 space-y-1.5">
        <p className="font-semibold">Quick SOL suggestions:</p>
        <div className="flex flex-wrap gap-1.5">
          {[
            'personal_injury',
            'breach_of_written_contract',
            'fraud',
            'wrongful_death',
            'medical_malpractice',
          ].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onPickSOL(c)}
              className="px-2 py-0.5 rounded ring-1 ring-ink-200 dark:ring-forest-700/40 hover:bg-ink-50 dark:hover:bg-forest-900/40"
            >
              {c.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
        {solHint && (
          <p className="italic text-amber-700 dark:text-amber-300 leading-snug">
            {solHint}
          </p>
        )}
      </div>

      {error && (
        <p className="text-[11px] text-rose-700 dark:text-rose-300">{error}</p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn-ghost text-sm"
          disabled={pending}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          className="btn-primary text-sm"
          disabled={pending}
        >
          {pending ? 'Adding...' : 'Add deadline'}
        </button>
      </div>
    </div>
  );
}
