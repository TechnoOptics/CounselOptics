'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { T } from '@/components/i18n/LocaleProvider';
import { ShareDialog } from '@/components/counsel/ShareDialog';

/**
 * The viewer itself: fetches the export once (session cookies authorize it),
 * holds the bytes as a blob URL, and renders them in the browser's PDF engine
 * inside Advottic-themed chrome. The same bytes back every toolbar action:
 * Print reuses the loaded document instead of re-downloading, Download saves
 * it, Share opens the encrypt-and-send dialog for the same export target.
 */
export function PreviewClient({ caseId, src, label }: { caseId: string; src: string; label: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState('document.pdf');
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(src, { credentials: 'same-origin' });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          if (!cancelled) setError((b as { error?: string }).error || 'Could not build the document.');
          return;
        }
        const blob = await res.blob();
        const fn = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1];
        url = URL.createObjectURL(blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' }));
        if (cancelled) return;
        if (fn) setFilename(fn);
        setBlobUrl(url);
      } catch {
        if (!cancelled) setError('Could not load the document. Please try again.');
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src]);

  function download() {
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function print() {
    if (!blobUrl) return;
    // Same-origin blob iframe: ask the embedded PDF viewer to print. Falls back
    // to opening the document in a new tab (where the viewer has its own print).
    try {
      const w = frameRef.current?.contentWindow;
      if (!w) throw new Error('no frame');
      w.focus();
      w.print();
    } catch {
      window.open(blobUrl, '_blank');
    }
  }

  const btn =
    'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-semibold text-cream-100/85 ring-1 ring-cream-50/15 hover:bg-gold-metal/15 hover:text-gold-metal hover:ring-gold-metal/40 transition-colors disabled:opacity-40 disabled:pointer-events-none';

  return (
    <div className="flex h-[100dvh] flex-col bg-forest-950">
      {/* Toolbar: firm black + gold chrome. */}
      <header className="flex items-center gap-3 border-b border-cream-50/10 bg-forest-950 px-4 py-2.5">
        <Link
          href={`/counsel/cases/${caseId}`}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[12.5px] font-semibold text-cream-100/70 hover:bg-cream-50/5 hover:text-cream-50 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <T>Back</T>
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-[13px] font-semibold text-cream-50" data-no-translate>{label}</p>
          <p className="text-[10.5px] uppercase tracking-[0.14em] text-gold-metal"><T>Preview</T> · Advottic</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={print} disabled={!blobUrl} className={btn} title="Print">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M7 8V4h10v4M7 17h10v4H7v-4Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5 17H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-1" stroke="currentColor" strokeWidth="1.8" />
            </svg>
            <span className="hidden sm:inline"><T>Print</T></span>
          </button>
          <button type="button" onClick={download} disabled={!blobUrl} className={btn} title="Download">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M12 4v11m0 0-4-4m4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="hidden sm:inline"><T>Download</T></span>
          </button>
          <button
            type="button"
            onClick={() => setShare(true)}
            disabled={!blobUrl && !error}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gold-metal px-3.5 py-2 text-[12.5px] font-semibold text-forest-950 shadow-sm ring-1 ring-gold-300/40 hover:brightness-105 transition disabled:opacity-40 disabled:pointer-events-none"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M12 15V4m0 0L8 8m4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <T>Share</T>
          </button>
        </div>
      </header>

      {/* Document surface. */}
      <div className="relative flex-1 bg-forest-900/60">
        {error ? (
          <div className="flex h-full items-center justify-center px-6">
            <div className="max-w-sm rounded-xl border border-cream-50/10 bg-surface p-6 text-center">
              <p className="text-[13.5px] text-cream-100/80">{error}</p>
              <Link href={`/counsel/cases/${caseId}`} className="mt-4 inline-block rounded-lg bg-gold-metal px-4 py-2 text-[13px] font-semibold text-forest-950">
                <T>Back to the matter</T>
              </Link>
            </div>
          </div>
        ) : !blobUrl ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-gold-metal/30 border-t-gold-metal" aria-hidden />
            <p className="text-[13px] text-cream-100/60"><T>Preparing your document…</T></p>
            <p className="text-[11.5px] text-cream-100/35"><T>Large matters can take a moment.</T></p>
          </div>
        ) : (
          <iframe
            ref={frameRef}
            src={blobUrl}
            title={label}
            className="absolute inset-0 h-full w-full border-0"
          />
        )}
      </div>

      {share && <ShareDialog caseId={caseId} target={{ path: src, label }} onClose={() => setShare(false)} />}
    </div>
  );
}
