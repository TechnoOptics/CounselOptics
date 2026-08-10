'use client';

import { useState, useTransition } from 'react';
import { saveHubProfileAction } from '@/lib/hub-actions';

/**
 * One toggle, because one is what the product can honour.
 *
 * This form used to offer three: email, text message, and due-date
 * reminders, plus a mobile number to text. Nothing read any of them.
 * Text messages and reminders have no send path to an employee anywhere in
 * the codebase, so they are gone rather than left drawn; email is now
 * checked on both paths that mail an employee. See lib/notify-prefs.ts.
 */
export function ProfileForm({
  defaultPrefs,
}: {
  defaultPrefs: { email: boolean };
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

  return (
    <form action={submit} className="popup-panel p-5 sm:p-6 space-y-5">
      <div>
        <p className="text-[11px] uppercase tracking-[0.16em] text-cream-100/60 mb-1">
          How should we notify you?
        </p>
        <label className="flex items-start gap-3 py-3 cursor-pointer">
          <input
            type="checkbox"
            name="notifyEmail"
            defaultChecked={defaultPrefs.email}
            className="mt-0.5 h-4 w-4 accent-gold-400"
          />
          <span>
            <span className="block text-[13.5px] font-medium text-cream-100">
              Email
            </span>
            <span className="block text-[12px] text-cream-100/55">
              Replies from legal on your requests. Turn this off and they
              still appear in the Hub, you just will not be emailed.
            </span>
          </span>
        </label>
      </div>

      {error && (
        <p className="rounded-lg ring-1 ring-rose-700/40 bg-rose-500/10 px-3 py-2 text-[12.5px] text-danger-text">
          {error}
        </p>
      )}
      {/* The same shape as the error line above: a tint that reads on
          either ground and a text colour declared for both. The dark fill
          and near-white type this used to carry were written when the
          portal had one theme, and measured 1.3:1 on the light one. */}
      {saved && (
        <p className="rounded-lg ring-1 ring-emerald-700/40 bg-emerald-500/10 px-3 py-2 text-[12.5px] text-emerald-800 dark:text-emerald-300">
          Saved.
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
