'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createMatterIntakeAction } from '@/lib/conflict-check';

const MATTER_TYPES = [
  'Personal injury',
  'Family / divorce',
  'Estate planning / probate',
  'Real estate',
  'Landlord / tenant',
  'Employment',
  'Immigration',
  'Criminal defense',
  'Business / contracts',
  'Intellectual property',
  'Bankruptcy',
  'Tax',
  'Other',
];

const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

export function CreateIntakeForm({ firmId }: { firmId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [opposing, setOpposing] = useState<string[]>(['']);
  const [related, setRelated] = useState<string[]>(['']);

  function submit(formData: FormData) {
    setError(null);
    const clientName = String(formData.get('clientName') ?? '').trim();
    const clientEmail = String(formData.get('clientEmail') ?? '').trim() || null;
    const clientPhone = String(formData.get('clientPhone') ?? '').trim() || null;
    const matterType = String(formData.get('matterType') ?? '').trim() || null;
    const matterSummary = String(formData.get('matterSummary') ?? '').trim() || null;
    const jurisdictionState = String(formData.get('state') ?? '').trim() || null;
    if (!clientName) {
      setError('Client name is required.');
      return;
    }
    startTransition(async () => {
      const res = await createMatterIntakeAction(firmId, {
        clientName,
        clientEmail,
        clientPhone,
        matterType,
        matterSummary,
        jurisdictionState,
        opposingParties: opposing.map((s) => s.trim()).filter(Boolean),
        relatedParties: related.map((s) => s.trim()).filter(Boolean),
      });
      if (res.ok && res.intakeId) {
        router.push(`/counsel/intake/${res.intakeId}`);
      } else {
        setError(res.error ?? 'Could not create intake.');
      }
    });
  }

  return (
    <form action={submit} className="card p-5 sm:p-6 space-y-5">
      <p className="eyebrow">New intake</p>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Client name
          </span>
          <input name="clientName" required className="input" />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Client email
          </span>
          <input name="clientEmail" type="email" className="input" />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Phone
          </span>
          <input name="clientPhone" type="tel" className="input" />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            State
          </span>
          <select name="state" className="input" defaultValue="">
            <option value="">Pick a state</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Matter type
          </span>
          <select name="matterType" className="input" defaultValue="">
            <option value="">Pick a type</option>
            {MATTER_TYPES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>

      <PartyList
        label="Opposing parties"
        hint="The other side of the dispute (counterparty, defendant, complainant)."
        values={opposing}
        onChange={setOpposing}
      />

      <PartyList
        label="Related parties"
        hint="Co-defendants, employers, family members, witnesses - anyone connected to the matter."
        values={related}
        onChange={setRelated}
      />

      <label className="block">
        <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
          Matter summary
        </span>
        <textarea
          name="matterSummary"
          rows={3}
          className="input"
          placeholder="Brief description of what the client is asking for and any deadlines."
        />
      </label>

      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? 'Creating...' : 'Create intake'}
        </button>
      </div>
    </form>
  );
}

function PartyList({
  label,
  hint,
  values,
  onChange,
}: {
  label: string;
  hint: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  function update(idx: number, value: string) {
    const next = values.slice();
    next[idx] = value;
    onChange(next);
  }
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-forest-900 dark:text-cream-100">
        {label}
      </p>
      <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55">{hint}</p>
      <div className="space-y-1.5">
        {values.map((v, i) => (
          <input
            key={i}
            value={v}
            onChange={(e) => update(i, e.target.value)}
            placeholder={`Party ${i + 1}`}
            className="input"
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...values, ''])}
        className="text-[12px] underline text-ink-700 dark:text-cream-100/85"
      >
        Add another
      </button>
    </div>
  );
}
