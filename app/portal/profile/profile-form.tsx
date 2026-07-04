'use client';

import { useState, useTransition } from 'react';
import { saveHubProfileAction } from '@/lib/hub-actions';

export function ProfileForm({
  defaultPhone,
  defaultPrefs,
}: {
  defaultPhone: string;
  defaultPrefs: { email: boolean; sms: boolean; reminders: boolean };
}) {
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const res = await saveHubProfileAction(formData);
      if (res.ok) setSaved(true);
      else setError(res.error ?? 'Could not save.');
    });
  }

  const Toggle = ({
    name,
    label,
    hint,
    defaultChecked,
  }: {
    name: string;
    label: string;
    hint: string;
    defaultChecked: boolean;
  }) => (
    <label className="flex items-start gap-3 py-3 cursor-pointer">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 h-4 w-4 accent-gold-400"
      />
      <span>
        <span className="block text-[13.5px] font-medium text-cream-100">
          {label}
        </span>
        <span className="block text-[12px] text-cream-100/55">{hint}</span>
      </span>
    </label>
  );

  return (
    <form action={submit} className="popup-panel p-5 sm:p-6 space-y-5">
      <div>
        <label className="block">
          <span className="block text-sm font-medium text-cream-100 mb-1.5">
            Mobile number{' '}
            <span className="text-cream-100/60 font-normal">
              (for text reminders)
            </span>
          </span>
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            defaultValue={defaultPhone}
            placeholder="+1 555 123 4567"
            className="input"
          />
        </label>
      </div>

      <div className="border-t border-forest-700/40 pt-2">
        <p className="text-[11px] uppercase tracking-[0.16em] text-cream-100/60 mb-1">
          How should we notify you?
        </p>
        <div className="divide-y divide-forest-700/30">
          <Toggle
            name="notifyEmail"
            label="Email"
            hint="Replies from legal, approvals, and confirmations."
            defaultChecked={defaultPrefs.email}
          />
          <Toggle
            name="notifySms"
            label="Text message"
            hint="Time-sensitive pings to the number above."
            defaultChecked={defaultPrefs.sms}
          />
          <Toggle
            name="notifyReminders"
            label="Due-date reminders"
            hint="A heads-up before anything is due or expiring."
            defaultChecked={defaultPrefs.reminders}
          />
        </div>
      </div>

      {error && (
        <p className="rounded-lg ring-1 ring-rose-700/40 bg-rose-950/30 px-3 py-2 text-[12.5px] text-rose-200">
          {error}
        </p>
      )}
      {saved && (
        <p className="rounded-lg ring-1 ring-emerald-700/40 bg-emerald-950/30 px-3 py-2 text-[12.5px] text-emerald-200">
          Saved. Your notification preferences are updated.
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="btn bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save preferences'}
        </button>
      </div>
    </form>
  );
}
