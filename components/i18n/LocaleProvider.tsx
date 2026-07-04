'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { localeDir, type LocaleCode } from '@/lib/i18n/locales';

/**
 * Dictionary-based i18n for the authenticated app (#14).
 *
 * Unlike AutoTranslate (which walks the whole DOM and is used on the
 * public sign page), this only translates strings that are EXPLICITLY
 * wrapped in <T> / passed through the t() from useT(). Dynamic data
 * (case titles, client names, dollar figures) is never wrapped, so it
 * stays verbatim - no risk of a translated case title, and no cost for
 * translating unbounded data.
 *
 * It's pull-based: t(source) returns the cached translation if we have
 * it, otherwise the English source, and schedules the miss to be
 * machine-translated (via /api/i18n/translate, the same cached engine)
 * and merged in, which re-renders with the translation. English is a
 * pure passthrough. Results are cached in localStorage per locale so
 * revisits are instant and offline-tolerant.
 */

type Ctx = {
  locale: LocaleCode;
  t: (source: string) => string;
};

const LocaleContext = createContext<Ctx>({ locale: 'en', t: (s) => s });

function storeKey(locale: string): string {
  return `i18n-dict:${locale}`;
}

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: LocaleCode;
  children: React.ReactNode;
}) {
  const [locale, setLocale] = useState<LocaleCode>(initialLocale);
  const [dict, setDict] = useState<Record<string, string>>({});
  // Strings we've already requested this locale (avoid re-queuing).
  const requested = useRef<Set<string>>(new Set());
  const pending = useRef<Set<string>>(new Set());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // React to the language switcher (no reload).
  useEffect(() => {
    function onChange(e: Event) {
      const next = (e as CustomEvent<string>).detail;
      if (next) setLocale(next as LocaleCode);
    }
    window.addEventListener('adv-locale-change', onChange as EventListener);
    return () =>
      window.removeEventListener(
        'adv-locale-change',
        onChange as EventListener,
      );
  }, []);

  // Keep <html> lang/dir in sync (RTL for Arabic).
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = localeDir(locale);
  }, [locale]);

  // On locale change, reset + hydrate the dictionary from localStorage.
  useEffect(() => {
    requested.current = new Set();
    pending.current = new Set();
    if (locale === 'en') {
      setDict({});
      return;
    }
    let hydrated: Record<string, string> = {};
    try {
      const raw = window.localStorage.getItem(storeKey(locale));
      if (raw) hydrated = JSON.parse(raw) as Record<string, string>;
    } catch {
      /* ignore */
    }
    for (const k of Object.keys(hydrated)) requested.current.add(k);
    setDict(hydrated);
  }, [locale]);

  const flush = useCallback(
    (activeLocale: LocaleCode) => {
      const batch = Array.from(pending.current);
      pending.current = new Set();
      if (batch.length === 0 || activeLocale === 'en') return;
      // Chunk to stay under the API cap.
      (async () => {
        const merged: Record<string, string> = {};
        for (let i = 0; i < batch.length; i += 150) {
          const chunk = batch.slice(i, i + 150);
          try {
            const res = await fetch('/api/i18n/translate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ texts: chunk, locale: activeLocale }),
            });
            if (res.ok) {
              const j = (await res.json()) as {
                map?: Record<string, string>;
              };
              Object.assign(merged, j.map ?? {});
            }
          } catch {
            /* leave English for this chunk */
          }
        }
        if (Object.keys(merged).length === 0) return;
        setDict((prev) => {
          const next = { ...prev, ...merged };
          try {
            window.localStorage.setItem(
              storeKey(activeLocale),
              JSON.stringify(next),
            );
          } catch {
            /* quota - fine */
          }
          return next;
        });
      })();
    },
    [],
  );

  const t = useCallback(
    (source: string) => {
      if (locale === 'en' || !source) return source;
      const hit = dict[source];
      if (hit != null) return hit;
      // Queue the miss (ref mutation during render is safe) + debounce.
      if (!requested.current.has(source)) {
        requested.current.add(source);
        pending.current.add(source);
        if (flushTimer.current) clearTimeout(flushTimer.current);
        flushTimer.current = setTimeout(() => flush(locale), 120);
      }
      return source; // English until the translation lands
    },
    [locale, dict, flush],
  );

  return (
    <LocaleContext.Provider value={{ locale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useT(): (source: string) => string {
  return useContext(LocaleContext).t;
}

export function useLocale(): LocaleCode {
  return useContext(LocaleContext).locale;
}

/**
 * Wrap a literal UI string: <T>Dashboard</T>. Works under both server
 * and client parents because it's a client component - the server
 * renders the English source, the client swaps in the translation.
 * Only pass STATIC UI copy here, never dynamic data.
 */
export function T({ children }: { children: string }): JSX.Element {
  const t = useT();
  return <>{t(children)}</>;
}
