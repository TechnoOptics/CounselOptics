'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export type SearchItem = {
  type: 'exhibit' | 'activity' | 'note' | 'collaborator';
  title: string;
  snippet?: string;
  href?: string;
};

/**
 * Per-case command-palette-style search. Takes a flat list of items
 * pre-extracted from the case (exhibits, activity events, hearing
 * notes, collaborators) and filters by substring as the user types.
 *
 * Lives at the top of the case page so a user with 30 exhibits
 * doesn't have to scroll. Cmd/Ctrl-K focuses it.
 */
export function CaseSearch({ items }: { items: SearchItem[] }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Cmd/Ctrl-K focuses the input.
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
        ev.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (ev.key === 'Escape') {
        setQ('');
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Click-outside to close.
  useEffect(() => {
    function onDoc(ev: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [] as SearchItem[];
    return items
      .map((it) => {
        const hay = `${it.title} ${it.snippet ?? ''}`.toLowerCase();
        return hay.includes(needle) ? it : null;
      })
      .filter((x): x is SearchItem => x !== null)
      .slice(0, 30);
  }, [q, items]);

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2 rounded-xl bg-white dark:bg-forest-900/60 border border-ink-200 dark:border-forest-700/60 px-3 py-2 shadow-sm focus-within:border-forest-700 focus-within:ring-2 focus-within:ring-forest-300/40 dark:focus-within:border-gold-500 dark:focus-within:ring-gold-500/30">
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
          className="text-ink-400 dark:text-cream-100/55 flex-none"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          placeholder="Search this case (exhibits, activity, notes)…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-ink-400 dark:placeholder:text-cream-100/45 text-ink-950 dark:text-cream-100"
        />
        <kbd className="hidden md:inline-flex items-center text-[10px] font-mono uppercase tracking-wider text-ink-500 dark:text-cream-100/70 border border-ink-200 dark:border-forest-700/60 rounded px-1.5 py-0.5">
          ⌘K
        </kbd>
      </div>

      {open && q.trim().length >= 2 && (
        <div className="absolute z-30 mt-2 left-0 right-0 rounded-xl bg-white dark:bg-forest-900 border border-ink-200 dark:border-forest-700/60 shadow-card-hover overflow-hidden max-h-[60vh] overflow-y-auto">
          {matches.length === 0 ? (
            <p className="text-sm text-ink-500 dark:text-cream-100/60 p-4">
              No matches for &ldquo;{q.trim()}&rdquo;.
            </p>
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-forest-700/40">
              {matches.map((m, i) => (
                <li key={i}>
                  <a
                    href={m.href ?? '#'}
                    target={m.href?.startsWith('/api/') ? '_blank' : undefined}
                    rel={m.href?.startsWith('/api/') ? 'noreferrer' : undefined}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-cream-50 dark:hover:bg-forest-800/60"
                  >
                    <span
                      className={`flex-none mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-mono uppercase tracking-wider ring-1 ${
                        m.type === 'exhibit'
                          ? 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300'
                          : m.type === 'activity'
                            ? 'bg-cream-100/30 text-ink-700 ring-ink-300/40 dark:text-cream-100/85'
                            : m.type === 'collaborator'
                              ? 'bg-gold-500/15 text-gold-700 ring-gold-500/30 dark:text-gold-300'
                              : 'bg-forest-500/15 text-forest-700 ring-forest-500/30 dark:text-forest-200'
                      }`}
                    >
                      {m.type === 'exhibit'
                        ? 'EX'
                        : m.type === 'activity'
                          ? 'AC'
                          : m.type === 'collaborator'
                            ? 'CO'
                            : 'NT'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink-950 dark:text-cream-100 truncate">
                        {m.title}
                      </p>
                      {m.snippet && (
                        <p className="text-xs text-ink-500 dark:text-cream-100/60 truncate mt-0.5">
                          {m.snippet}
                        </p>
                      )}
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
