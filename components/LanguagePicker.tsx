'use client';

import { useState, useTransition } from 'react';
import { setLanguageAction } from '@/lib/actions';
import { SUPPORTED_LANGUAGES } from '@/lib/types';

/**
 * Language preference. Saves to profiles.language so the choice carries
 * across devices. Full UI translation is staged separately - today the
 * preference is captured but only a small set of strings is localized.
 * Setting it now means once translations land, every existing user
 * already has their preferred locale on file.
 */
export function LanguagePicker({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial || 'en');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function pick(next: string) {
    if (pending || next === value) return;
    setValue(next);
    setError(null);
    setSaved(false);
    start(async () => {
      const result = await setLanguageAction(next);
      if (result.ok) setSaved(true);
      else setError(result.error ?? 'Could not save language.');
    });
  }

  return (
    <div className="space-y-2">
      <p className="label">Language</p>
      <p className="text-xs text-ink-500 dark:text-cream-100/55 -mt-1">
        Pick your preferred language. Full translation is rolling out; today this saves your
        preference so the app reflects it as soon as your language is available.
      </p>
      <select
        value={value}
        onChange={(e) => pick(e.target.value)}
        disabled={pending}
        className="input max-w-xs"
        aria-label="Preferred language"
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.label}
          </option>
        ))}
      </select>
      <div className="text-[11px] h-4">
        {pending && <span className="text-ink-500 dark:text-cream-100/55">Saving...</span>}
        {saved && !pending && <span className="text-emerald-700 dark:text-emerald-400">Saved.</span>}
        {error && <span className="text-rose-700 dark:text-rose-300">{error}</span>}
      </div>
    </div>
  );
}
