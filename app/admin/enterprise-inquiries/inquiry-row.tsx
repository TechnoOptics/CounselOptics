'use client';

import { useState } from 'react';
import { updateEnterpriseInquiryAction } from '@/lib/actions';
import { LocaleTime } from '@/components/LocaleTime';

const STATUS_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'demo-scheduled', label: 'Demo scheduled' },
  { value: 'pilot', label: 'Pilot' },
  { value: 'signed', label: 'Signed' },
  { value: 'closed-lost', label: 'Closed lost' },
  { value: 'archived', label: 'Archived' },
];

const STATUS_TONE: Record<string, string> = {
  new: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200',
  contacted: 'bg-sky-100 text-sky-900 dark:bg-sky-900/30 dark:text-sky-200',
  'demo-scheduled': 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200',
  pilot: 'bg-gold-200 text-gold-900 dark:bg-gold-400/15 dark:text-gold-200',
  signed: 'bg-forest-200 text-forest-900 dark:bg-forest-700/40 dark:text-cream-100',
  'closed-lost': 'bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200',
  archived: 'bg-ink-100 text-ink-700 dark:bg-forest-800/60 dark:text-cream-100/70',
};

export function InquiryRow(props: {
  id: string;
  firmName: string;
  contactName: string;
  contactRole: string | null;
  email: string;
  sector: string;
  teamSize: string | null;
  message: string | null;
  status: string;
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(props.status);
  const [notes, setNotes] = useState(props.adminNotes ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      await updateEnterpriseInquiryAction({
        id: props.id,
        status,
        adminNotes: notes,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="font-semibold tracking-tight text-forest-900 dark:text-cream-100 text-base">
              {props.firmName}
            </h2>
            <span
              className={`text-[10px] tracking-[0.18em] uppercase font-semibold rounded-full px-2 py-0.5 ${
                STATUS_TONE[status] ?? STATUS_TONE.new
              }`}
            >
              {status.replace(/-/g, ' ')}
            </span>
          </div>
          <p className="text-sm text-ink-700 dark:text-cream-100/80 mt-1">
            {props.contactName}
            {props.contactRole && (
              <span className="text-ink-500 dark:text-cream-100/55"> · {props.contactRole}</span>
            )}
            {' · '}
            <a className="underline hover:text-forest-900 dark:hover:text-cream-100" href={`mailto:${props.email}`}>
              {props.email}
            </a>
          </p>
          <p className="text-xs text-ink-500 dark:text-cream-100/55 mt-1">
            {props.sector}
            {props.teamSize && ` · ${props.teamSize}`}
            {' · '}
            received <LocaleTime iso={props.createdAt} />
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="btn-secondary text-xs"
        >
          {open ? 'Close' : 'Triage'}
        </button>
      </div>

      {props.message && (
        <p className="text-sm text-ink-700 dark:text-cream-100/75 leading-relaxed mt-3 whitespace-pre-wrap">
          {props.message}
        </p>
      )}

      {open && (
        <div className="mt-5 space-y-3 border-t border-ink-200 dark:border-forest-700/40 pt-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <label className="label" htmlFor={`status-${props.id}`}>
                Status
              </label>
              <select
                id={`status-${props.id}`}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="input"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="btn-primary"
            >
              {pending ? 'Saving...' : saved ? 'Saved' : 'Save'}
            </button>
          </div>
          <div>
            <label className="label" htmlFor={`notes-${props.id}`}>
              Internal notes
            </label>
            <textarea
              id={`notes-${props.id}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={4000}
              className="input"
              placeholder="Demo on Tuesday at 2pm. They mentioned $80/seat budget."
            />
          </div>
          {error && (
            <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>
          )}
        </div>
      )}
    </article>
  );
}
