'use client';

import { useEffect, useRef, useState } from 'react';
import { T } from '@/components/i18n/LocaleProvider';
import { PacketIcon } from '@/components/counsel/CaseSectionIcons';
import { ShareDialog, type ShareTarget } from '@/components/counsel/ShareDialog';

/**
 * Court-packet export control. Each export target opens in the Advottic PDF
 * PREVIEW by default (proofread first, then share, download, or print there);
 * the row also carries direct Download and Share actions. Section scope is
 * passed to the export route as `?section=<key>`; the share endpoint rebuilds
 * the same export before encrypting it.
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
  const [share, setShare] = useState<ShareTarget | null>(null);
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
  const previewHref = (path: string, label: string) =>
    `/counsel/cases/${caseId}/preview?src=${encodeURIComponent(path)}&label=${encodeURIComponent(label)}`;
  const labelCls =
    'px-3 pt-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-forest-500/70 dark:text-cream-100/40';
  const iconBtn =
    'grid h-7 w-7 shrink-0 place-items-center rounded-md text-forest-400 hover:bg-gold-500/20 hover:text-gold-600 dark:text-cream-100/40 dark:hover:text-gold-300 transition-colors';

  // One row = preview link (main) + direct download + secure share.
  function Row({ path, label, strong }: { path: string; label: string; strong?: boolean }) {
    return (
      <div className="group/row flex items-center gap-0.5 rounded-md hover:bg-gold-500/10">
        <a
          href={previewHref(path, label)}
          onClick={() => setOpen(false)}
          title="Preview"
          className={`min-w-0 flex-1 truncate rounded-md px-3 py-2 text-[13px] text-forest-900 dark:text-cream-100 group-hover/row:text-gold-700 dark:group-hover/row:text-gold-300 ${strong ? 'font-semibold' : ''}`}
        >
          <span data-no-translate={label.length > 24 ? '' : undefined}>{label.length > 24 ? label : <T>{label}</T>}</span>
        </a>
        <a href={path} download title="Download" aria-label="Download" onClick={() => setOpen(false)} className={iconBtn}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M12 4v11m0 0-4-4m4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
        <button
          type="button"
          title="Share securely by email"
          aria-label="Share securely by email"
          onClick={() => { setShare({ path, label }); setOpen(false); }}
          className={`${iconBtn} mr-1.5`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M12 15V4m0 0L8 8m4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-2.5 rounded-lg px-4 py-3 text-left ring-1 ring-transparent text-forest-900 dark:text-cream-100 hover:bg-white dark:hover:bg-forest-800/60 hover:ring-gold-500/60 hover:shadow-sm transition-all"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gold-500/10 text-gold-600 ring-1 ring-gold-500/20 transition-colors group-hover:bg-gold-500/20 group-hover:text-gold-500 dark:text-gold-400/90">
          <PacketIcon />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold"><T>Export</T></span>
          <span className="block truncate text-[11px] text-ink-500 dark:text-cream-100/50"><T>Preview, download, or share</T></span>
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-72 max-h-[70vh] overflow-y-auto rounded-xl border border-ink-200 dark:border-forest-700/60 bg-white dark:bg-forest-900 p-1.5 shadow-xl"
        >
          <p className="px-3 pt-1.5 pb-1 text-[11px] text-forest-400 dark:text-cream-100/35">
            <T>Click a document to preview it, or download / share it directly with the buttons.</T>
          </p>
          <Row path={base} label="Full court packet" strong />

          <div className={labelCls}><T>Just one section</T></div>
          {SECTIONS.map((s) => (
            <Row key={s.key} path={`${base}?section=${s.key}`} label={s.label} />
          ))}

          {approaches.length > 0 && (
            <>
              <div className={labelCls}><T>Export an approach</T></div>
              {approaches.map((a) => (
                <Row key={a.id} path={`/counsel/cases/${caseId}/approach/${a.id}/export`} label={a.title || 'Untitled approach'} />
              ))}
            </>
          )}
        </div>
      )}

      {share && (
        <ShareDialog caseId={caseId} target={share} onClose={() => setShare(null)} />
      )}
    </div>
  );
}
