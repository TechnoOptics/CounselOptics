'use client';

import { useEffect, useRef, useState } from 'react';
import { T } from '@/components/i18n/LocaleProvider';
import { PacketIcon } from '@/components/counsel/CaseSectionIcons';

/**
 * Court-packet export control. Replaces the single "Court packet" link with a
 * menu so the user can export the WHOLE packet, just ONE section (case summary,
 * timeline, parties, locations, or the record of exhibits), or a specific saved
 * approach — each as its own court-ready PDF. Section scope is passed to the
 * export route as `?section=<key>`; the route renders only that section (and
 * skips the heavy work for the rest).
 */

const SECTIONS: { key: string; label: string }[] = [
  { key: 'overview', label: 'Case summary' },
  { key: 'timeline', label: 'Timeline of events' },
  { key: 'parties', label: 'Parties & entities' },
  { key: 'locations', label: 'Locations' },
  { key: 'exhibits', label: 'Record of exhibits' },
];

export function ExportMenu({
  caseId,
  approaches,
}: {
  caseId: string;
  approaches: { id: string; title: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const base = `/counsel/cases/${caseId}/export`;
  const rowCls =
    'block rounded-md px-3 py-2 text-[13px] text-forest-900 dark:text-cream-100 hover:bg-gold-500/10 hover:text-gold-700 dark:hover:text-gold-300 transition-colors';
  const labelCls =
    'px-3 pt-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-forest-500/70 dark:text-cream-100/40';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center justify-center gap-2.5 rounded-lg px-4 py-3 ring-1 ring-transparent text-forest-900 dark:text-cream-100 hover:bg-white dark:hover:bg-forest-800/60 hover:ring-gold-500/60 hover:shadow-sm transition-all"
      >
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gold-500/10 text-gold-600 ring-1 ring-gold-500/20 transition-colors group-hover:bg-gold-500/20 group-hover:text-gold-500 dark:text-gold-400/90">
          <PacketIcon />
        </span>
        <span className="text-[13px] font-semibold"><T>Export</T></span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-64 max-h-[70vh] overflow-y-auto rounded-xl border border-ink-200 dark:border-forest-700/60 bg-white dark:bg-forest-900 p-1.5 shadow-xl"
        >
          <a href={base} download className={`${rowCls} font-semibold`} onClick={() => setOpen(false)}>
            <T>Full court packet</T>
          </a>

          <div className={labelCls}><T>Just one section</T></div>
          {SECTIONS.map((s) => (
            <a key={s.key} href={`${base}?section=${s.key}`} download className={rowCls} onClick={() => setOpen(false)}>
              <T>{s.label}</T>
            </a>
          ))}

          {approaches.length > 0 && (
            <>
              <div className={labelCls}><T>Export an approach</T></div>
              {approaches.map((a) => (
                <a
                  key={a.id}
                  href={`/counsel/cases/${caseId}/approach/${a.id}/export`}
                  download
                  className={rowCls}
                  onClick={() => setOpen(false)}
                >
                  <span data-no-translate>{a.title || 'Untitled approach'}</span>
                </a>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
