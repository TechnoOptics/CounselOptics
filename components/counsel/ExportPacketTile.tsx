'use client';

import { useState, type ReactNode } from 'react';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { T } from '@/components/i18n/LocaleProvider';
import { isNativeApp } from '@/lib/platform';

/**
 * Export tile that shows the full-screen loading veil while the PDF is being
 * generated, so the reader gets immediate feedback and does not keep clicking.
 * Fetches the packet as a blob (so we can detect completion) then triggers the
 * download; on native it hands the URL to the in-app browser.
 */
export function ExportPacketTile({
  href,
  title,
  blurb,
  icon,
  filename = 'advottic-case-packet.pdf',
}: {
  href: string;
  title: string;
  blurb: string;
  icon: ReactNode;
  filename?: string;
}) {
  const [loading, setLoading] = useState(false);

  async function run() {
    if (loading) return;
    setLoading(true);
    try {
      if (isNativeApp()) {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url: href });
        return;
      }
      const res = await fetch(href);
      if (!res.ok) throw new Error('export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      // Fall back to a plain navigation so the user still gets the file.
      window.location.assign(href);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={loading}
        aria-busy={loading}
        className="group block w-full rounded-xl border border-cream-50/10 bg-forest-900/30 p-4 text-left transition-all hover:border-gold-metal/30 hover:bg-forest-900/55 disabled:opacity-70"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-gold-metal/[0.12] text-gold-metal ring-1 ring-gold-metal/25">
            {icon}
          </span>
          {loading ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="animate-spin text-gold-metal">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
              <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="text-cream-100/40 transition-transform group-hover:translate-x-0.5">
              <path d="M7 17L17 7M9 7h8v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
        <p className="mt-3 text-[15px] font-semibold text-cream-50">
          <T>{title}</T>
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-cream-100/55">
          {loading ? <T>Preparing your packet…</T> : <T>{blurb}</T>}
        </p>
      </button>
      <LoadingOverlay show={loading} label="Preparing your export" />
    </>
  );
}
