'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateFirmAction } from '@/lib/firm-actions';

export function SettingsForm({
  firmId,
  defaultValues,
}: {
  firmId: string;
  defaultValues: {
    name: string;
    accentColor: string;
    logoUrl: string;
    jurisdictions: string[];
    practiceAreas: string[];
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function submit(formData: FormData) {
    setError(null);
    setOk(false);
    startTransition(async () => {
      const res = await updateFirmAction(firmId, formData);
      if (res.ok) {
        setOk(true);
        router.refresh();
      } else {
        setError(res.error ?? 'Could not save.');
      }
    });
  }

  return (
    <form action={submit} className="card p-6 space-y-5">
      <div>
        <label className="label" htmlFor="name">
          Firm name
        </label>
        <input
          id="name"
          name="name"
          required
          defaultValue={defaultValues.name}
          className="input"
          maxLength={120}
          disabled={pending}
        />
      </div>
      <div className="grid sm:grid-cols-[1fr,auto] gap-3 items-end">
        <div>
          <label className="label" htmlFor="accentColor">
            Accent color (hex)
          </label>
          <input
            id="accentColor"
            name="accentColor"
            defaultValue={defaultValues.accentColor}
            className="input"
            maxLength={7}
            placeholder="#0f2d24"
            disabled={pending}
          />
        </div>
        <span
          className="h-10 w-10 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/60"
          style={{ backgroundColor: defaultValues.accentColor }}
          aria-hidden
        />
      </div>
      <div>
        <label className="label" htmlFor="logoUrl">
          Logo URL{' '}
          <span className="text-ink-400 dark:text-cream-100/45 font-normal">(optional)</span>
        </label>
        <input
          id="logoUrl"
          name="logoUrl"
          defaultValue={defaultValues.logoUrl}
          className="input"
          maxLength={500}
          placeholder="https://your-cdn.example.com/logo.png"
          disabled={pending}
        />
      </div>
      <div>
        <label className="label" htmlFor="jurisdictions">
          Jurisdictions{' '}
          <span className="text-ink-400 dark:text-cream-100/45 font-normal">
            (comma-separated)
          </span>
        </label>
        <input
          id="jurisdictions"
          name="jurisdictions"
          defaultValue={defaultValues.jurisdictions.join(', ')}
          className="input"
          disabled={pending}
        />
      </div>
      <div>
        <label className="label" htmlFor="practiceAreas">
          Practice areas{' '}
          <span className="text-ink-400 dark:text-cream-100/45 font-normal">
            (comma-separated)
          </span>
        </label>
        <input
          id="practiceAreas"
          name="practiceAreas"
          defaultValue={defaultValues.practiceAreas.join(', ')}
          className="input"
          disabled={pending}
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? 'Saving...' : 'Save changes'}
        </button>
      </div>
      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}
      {ok && (
        <p className="rounded-lg border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-100">
          Saved.
        </p>
      )}
    </form>
  );
}
