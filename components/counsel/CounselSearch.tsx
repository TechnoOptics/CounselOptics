'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/i18n/LocaleProvider';

/**
 * The counsel top bar's search box.
 *
 * Two things are searchable, and both are real:
 *
 *   - The firm's own MATTERS, from /api/counsel/search, which reads
 *     this firm's cases through the caller's session under RLS. Fetched
 *     once, the first time the palette opens.
 *   - The firm's own NAVIGATION, passed in from the same menu config
 *     the rail renders, so a firm that hid or renamed a destination
 *     gets its own names here and never a destination it hid.
 *
 * Nothing else is offered. The consumer command palette is deliberately
 * NOT mounted inside the counsel shell (see app/layout.tsx, where it
 * sits under `!isShellMode`), so Cmd-K is free here and the two never
 * both open.
 *
 * The box renders as a button rather than an input on purpose: it opens
 * a panel, and a text field that ignores what you type into it until a
 * panel appears is the wrong affordance. The real input is inside the
 * panel and takes focus the moment it opens.
 */
export type CounselSearchNavItem = { href: string; label: string };

type Matter = {
  id: string;
  title: string;
  subjectName: string;
  status: string;
};

export function CounselSearch({
  navItems,
}: {
  navItems: CounselSearchNavItem[];
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matters, setMatters] = useState<Matter[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // e.key can arrive undefined from some WebView keyboards, and
      // toLowerCase() on undefined throws.
      if ((e.metaKey || e.ctrlKey) && e.key?.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    if (loaded) return;
    let cancelled = false;
    fetch('/api/counsel/search')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setMatters(Array.isArray(data?.matters) ? data.matters : []);
        setLoaded(true);
      })
      .catch(() => {
        // The nav half of the palette needs no request, so a failed
        // fetch narrows the results rather than breaking the panel.
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, loaded]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pages = navItems
      .filter((n) => !q || n.label.toLowerCase().includes(q))
      .slice(0, 6)
      .map((n) => ({
        key: `page:${n.href}`,
        href: n.href,
        primary: n.label,
        secondary: '',
        kind: 'page' as const,
      }));
    const hits = matters
      .filter(
        (m) =>
          !q ||
          m.title.toLowerCase().includes(q) ||
          m.subjectName.toLowerCase().includes(q),
      )
      .slice(0, 8)
      .map((m) => ({
        key: `matter:${m.id}`,
        href: `/counsel/cases/${m.id}`,
        primary: m.title,
        secondary: m.subjectName,
        kind: 'matter' as const,
      }));
    return [...hits, ...pages];
  }, [query, matters, navItems]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  function go(href: string) {
    setOpen(false);
    setQuery('');
    router.push(href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="counsel-search-trigger"
        aria-label={t('Search matters and pages')}
        className="hidden lg:flex w-[310px] items-center gap-2 rounded-lg border border-edge bg-surface-2 px-3 py-1.5 text-left text-[13px] text-muted transition-colors hover:border-edge-bright"
      >
        <MagnifierIcon />
        <span className="flex-1 truncate">{t('Search matters and pages')}</span>
        <span className="rounded border border-edge px-1 py-px font-mono text-[10px] tracking-wider">
          &#8984;K
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh]"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-xl overflow-hidden rounded-xl border border-edge bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t('Search matters and pages')}
          >
            <div className="flex items-center gap-2 border-b border-edge px-3 py-2.5 text-muted">
              <MagnifierIcon />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActive((i) => Math.min(i + 1, results.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive((i) => Math.max(i - 1, 0));
                  } else if (e.key === 'Enter') {
                    const hit = results[active];
                    if (hit) go(hit.href);
                  }
                }}
                placeholder={t('Search matters and pages')}
                aria-label={t('Search matters and pages')}
                className="flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted"
              />
            </div>
            <ul className="max-h-[52vh] overflow-y-auto py-1">
              {results.length === 0 && (
                <li className="px-4 py-6 text-center text-[13px] text-muted">
                  {loaded
                    ? t('Nothing here matches that.')
                    : t('Looking through this firm.')}
                </li>
              )}
              {results.map((r, i) => (
                <li key={r.key}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r.href)}
                    className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${
                      i === active ? 'bg-surface-2' : ''
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-[14px] text-foreground"
                        data-no-translate={r.kind === 'matter' ? '' : undefined}
                      >
                        {r.primary}
                      </span>
                      {r.secondary ? (
                        <span
                          className="block truncate text-[12px] text-muted"
                          data-no-translate
                        >
                          {r.secondary}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex-none font-mono text-[10px] uppercase tracking-wider text-muted">
                      {r.kind === 'matter' ? t('Matter') : t('Page')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

function MagnifierIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="flex-none"
    >
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path
        d="m20 20-3.5-3.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
