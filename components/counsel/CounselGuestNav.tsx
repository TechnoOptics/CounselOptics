'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * Section navigator + case-wide smart search for the case-scoped Counsel
 * GUEST shell. A guest is locked to a single matter, so this gives them an
 * always-present way around it: Matter overview · Timeline · Evidence Center
 * (· Folders once any exist), then — separated by a gold gradient hairline so
 * the two read as distinct rows — a search that works from the very first
 * screen. Suggestions come from THIS matter's own data (exhibit numbers,
 * item titles, people, places, organizations, folders) via the lightweight
 * /search-index route; picking one lands in the Evidence Center with the
 * query (or folder) already applied.
 *
 * `caseHref` is the guest's matter landing (/counsel/cases/<id>).
 */

type SearchDoc = {
  id: string;
  title: string;
  kind: string;
  exhibit: string | null;
  people: string[];
  places: string[];
  orgs: string[];
  folders: string[];
};

export function CounselGuestNav({ caseHref }: { caseHref: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onFolders =
    pathname.startsWith(`${caseHref}/evidence`) && searchParams?.get('tab') === 'folders';

  // One fetch powers both the Folders tab visibility and the suggestions.
  const [docs, setDocs] = useState<SearchDoc[]>([]);
  useEffect(() => {
    let alive = true;
    fetch(`${caseHref}/search-index`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j && Array.isArray(j.docs)) setDocs(j.docs as SearchDoc[]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [caseHref]);
  const folderNames = useMemo(() => {
    const s = new Set<string>();
    for (const d of docs) for (const f of d.folders) s.add(f);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [docs]);

  const items: { href: string; label: string; active: boolean }[] = [
    { href: caseHref, label: 'Matter overview', active: pathname === caseHref },
    {
      href: `${caseHref}/timeline`,
      label: 'Timeline',
      active: pathname.startsWith(`${caseHref}/timeline`),
    },
    {
      href: `${caseHref}/evidence`,
      label: 'Evidence Center',
      active: pathname.startsWith(`${caseHref}/evidence`) && !onFolders,
    },
    ...(folderNames.length > 0
      ? [
          {
            href: `${caseHref}/evidence?tab=folders`,
            label: 'Folders',
            active: onFolders,
          },
        ]
      : []),
  ];

  return (
    <>
      <nav
        aria-label="Matter sections"
        className="mx-auto max-w-none px-4 sm:px-6 lg:px-10 pt-2 flex items-center gap-1 overflow-x-auto pb-2"
      >
        {items.map((it) => (
          <Link
            key={it.label}
            href={it.href}
            aria-current={it.active ? 'page' : undefined}
            className={`shrink-0 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
              it.active
                ? 'bg-cream-100/10 text-cream-100 ring-1 ring-gold-metal/40'
                : 'text-cream-100/70 hover:text-cream-100 hover:bg-cream-100/5'
            }`}
          >
            <T>{it.label}</T>
          </Link>
        ))}
      </nav>
      {/* Gold gradient hairline: keeps the section tabs and the search visually
          distinct rows inside the same header. */}
      <div className="gold-rule" aria-hidden />
      <GuestCaseSearch caseHref={caseHref} docs={docs} folderNames={folderNames} />
    </>
  );
}

/** Grouped type-ahead over the matter's own data; every pick lands in the
 *  Evidence Center with the query / folder applied. */
function GuestCaseSearch({
  caseHref,
  docs,
  folderNames,
}: {
  caseHref: string;
  docs: SearchDoc[];
  folderNames: string[];
}) {
  const t = useT();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const goSearch = (query: string) => {
    setOpen(false);
    router.push(`${caseHref}/evidence?q=${encodeURIComponent(query)}`);
  };
  const goFolder = (name: string) => {
    setOpen(false);
    router.push(`${caseHref}/evidence?tab=folders&open=${encodeURIComponent(name)}`);
  };

  // Distinct values per field, filtered by the typed text (case-insensitive).
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hit = (s: string) => !needle || s.toLowerCase().includes(needle);
    const distinct = (pick: (d: SearchDoc) => string[], cap: number) => {
      const counts = new Map<string, number>();
      for (const d of docs) for (const v of pick(d)) {
        const k = v.trim();
        if (k && hit(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, cap).map(([v]) => v);
    };
    const itemDocs = docs
      .filter((d) => hit(d.title) || (d.exhibit ? hit(d.exhibit) : false))
      .slice(0, 5);
    return {
      items: itemDocs,
      people: distinct((d) => d.people, 4),
      places: distinct((d) => d.places, 3),
      orgs: distinct((d) => d.orgs, 3),
      folders: folderNames.filter(hit).slice(0, 4),
    };
  }, [docs, folderNames, q]);

  const hasAny =
    groups.items.length + groups.people.length + groups.places.length + groups.orgs.length + groups.folders.length >
    0;

  const groupLabel =
    'px-3 pt-2 pb-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-cream-100/40';
  const row =
    'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[13px] text-cream-100/85 hover:bg-cream-100/10 hover:text-cream-100';

  return (
    <div className="mx-auto max-w-none px-4 sm:px-6 lg:px-10 py-2">
      <div ref={boxRef} className="relative mx-auto max-w-2xl">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) goSearch(q.trim());
          }}
        >
          <span aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-cream-100/40">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={t('Search this matter — a name, a place, an exhibit number, anything…')}
            aria-label={t('Search this matter')}
            className="w-full rounded-full bg-forest-900/80 py-2 pl-9 pr-4 text-[13.5px] text-cream-100 placeholder:text-cream-100/40 ring-1 ring-forest-700/60 outline-none transition-shadow focus:ring-2 focus:ring-gold-metal/50"
            data-no-translate
          />
        </form>

        {open && hasAny && (
          <div className="absolute inset-x-0 top-full z-40 mt-2 max-h-[60vh] overflow-y-auto rounded-xl bg-forest-950 p-1.5 shadow-2xl ring-1 ring-forest-700/60">
            {groups.items.length > 0 && (
              <>
                <p className={groupLabel}><T>Evidence</T></p>
                {groups.items.map((d) => (
                  <button key={d.id} type="button" onClick={() => goSearch(d.exhibit ?? d.title)} className={row}>
                    {d.exhibit && (
                      <span className="shrink-0 rounded bg-gold-metal/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-gold-300" data-no-translate>
                        {d.exhibit}
                      </span>
                    )}
                    <span className="min-w-0 truncate" data-no-translate>{d.title}</span>
                  </button>
                ))}
              </>
            )}
            {groups.people.length > 0 && (
              <>
                <p className={groupLabel}><T>People</T></p>
                {groups.people.map((v) => (
                  <button key={v} type="button" onClick={() => goSearch(v)} className={row}>
                    <span aria-hidden className="text-cream-100/40">👤</span>
                    <span className="min-w-0 truncate" data-no-translate>{v}</span>
                  </button>
                ))}
              </>
            )}
            {groups.places.length > 0 && (
              <>
                <p className={groupLabel}><T>Places</T></p>
                {groups.places.map((v) => (
                  <button key={v} type="button" onClick={() => goSearch(v)} className={row}>
                    <span aria-hidden className="text-cream-100/40">📍</span>
                    <span className="min-w-0 truncate" data-no-translate>{v}</span>
                  </button>
                ))}
              </>
            )}
            {groups.orgs.length > 0 && (
              <>
                <p className={groupLabel}><T>Organizations</T></p>
                {groups.orgs.map((v) => (
                  <button key={v} type="button" onClick={() => goSearch(v)} className={row}>
                    <span aria-hidden className="text-cream-100/40">🏢</span>
                    <span className="min-w-0 truncate" data-no-translate>{v}</span>
                  </button>
                ))}
              </>
            )}
            {groups.folders.length > 0 && (
              <>
                <p className={groupLabel}><T>Folders</T></p>
                {groups.folders.map((v) => (
                  <button key={v} type="button" onClick={() => goFolder(v)} className={row}>
                    <span aria-hidden className="text-cream-100/40">📁</span>
                    <span className="min-w-0 truncate" data-no-translate>{v}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
