'use client';

import { useState, useTransition } from 'react';
import { setLocaleAction } from '@/lib/i18n/locale';
import { LOCALES, type LocaleCode } from '@/lib/i18n/locales';

/**
 * Language picker (#14). Persists the choice to the locale cookie and
 * tells the AutoTranslate provider to re-translate immediately (no
 * reload) via a window event. Compact by default; pass `variant="light"`
 * for dark surfaces like the sign page header.
 */
export function LanguageSwitcher({
  initialLocale,
  variant = 'default',
}: {
  initialLocale: LocaleCode;
  variant?: 'default' | 'light';
}) {
  const [locale, setLocale] = useState<LocaleCode>(initialLocale);
  const [pending, startTransition] = useTransition();

  function pick(next: LocaleCode) {
    if (next === locale) return;
    setLocale(next);
    // Re-translate the page immediately.
    window.dispatchEvent(
      new CustomEvent('adv-locale-change', { detail: next }),
    );
    // Persist for next visit (best-effort).
    startTransition(async () => {
      await setLocaleAction(next).catch(() => undefined);
    });
  }

  const base =
    variant === 'light'
      ? 'bg-transparent text-cream-100/85 border-cream-100/25'
      : 'bg-white dark:bg-forest-900 text-ink-800 dark:text-cream-100/85 border-ink-200 dark:border-forest-700/50';

  return (
    <label className="inline-flex items-center gap-1.5" data-no-translate>
      <span className="sr-only">Language</span>
      <GlobeIcon />
      <select
        value={locale}
        disabled={pending}
        onChange={(e) => pick(e.target.value as LocaleCode)}
        className={`text-[12.5px] rounded-md border px-2 py-1.5 min-h-[36px] focus:outline-none focus:ring-2 focus:ring-gold-400/50 ${base}`}
        aria-label="Choose language"
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.nativeName}
          </option>
        ))}
      </select>
    </label>
  );
}

function GlobeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="opacity-70"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
    </svg>
  );
}
