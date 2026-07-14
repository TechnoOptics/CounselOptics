'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { HumanCheck } from './human-check';

const TURNSTILE_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

/**
 * Key entry for a secure share. Once a key is pasted, Advottic's own
 * "Confirm you are human" tile appears (Turnstile runs invisibly beneath it;
 * the server re-verifies before decrypting). On the correct key the decrypted
 * PDF opens IN THE BROWSER in a full-screen Advottic viewer — no forced
 * download — with Download and Print available from the viewer's toolbar. The
 * decrypted bytes live only in memory (a blob URL) and are never written to
 * disk unless the reader chooses Download.
 */
export function UnlockForm({ token }: { token: string }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [doc, setDoc] = useState<{ url: string; filename: string } | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);

  const needsHuman = TURNSTILE_CONFIGURED && !turnstileToken;

  // Blob URLs hold the decrypted document in memory; release on unmount.
  useEffect(() => () => { if (doc) URL.revokeObjectURL(doc.url); }, [doc]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim() || busy || needsHuman) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/share/${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, turnstileToken: turnstileToken ?? undefined }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError((b as { error?: string }).error || 'Could not open the document.');
        return;
      }
      const blob = await res.blob();
      const filename =
        /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'document.pdf';
      const url = URL.createObjectURL(blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' }));
      setDoc({ url, filename });
      setViewerOpen(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!doc) return;
    const a = document.createElement('a');
    a.href = doc.url;
    a.download = doc.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Unlocked: the document stays in memory — reopen, download, or print at will.
  if (doc && !viewerOpen) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 p-4 text-[13px] text-emerald-800 dark:text-emerald-300">
        Document unlocked. It stays available on this page until you close the tab.
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => setViewerOpen(true)} className="flex-1 rounded-lg bg-forest-900 dark:bg-gold-metal px-3 py-2 text-[12.5px] font-semibold text-cream-50 dark:text-forest-950 hover:brightness-110">
            View document
          </button>
          <button type="button" onClick={download} className="flex-1 rounded-lg border border-emerald-600/40 px-3 py-2 text-[12.5px] font-semibold hover:bg-emerald-100/50 dark:hover:bg-emerald-500/15">
            Download
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-forest-600 dark:text-cream-100/60">Decryption key</span>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste the key from your email"
            className="w-full rounded-lg border border-ink-200 dark:border-forest-700/60 bg-white dark:bg-forest-950 px-3 py-2.5 font-mono text-[13px] text-forest-900 dark:text-cream-50 outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-500/20"
          />
        </label>
        {/* Advottic's own human-verification tile — appears once a key is
            entered, and must be passed before the unlock button activates. */}
        {key.trim() && <HumanCheck onToken={setTurnstileToken} />}
        {error && <p className="text-[12.5px] text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || !key.trim() || needsHuman}
          className="w-full rounded-lg bg-forest-900 dark:bg-gold-metal px-4 py-2.5 text-[13.5px] font-semibold text-cream-50 dark:text-forest-950 disabled:opacity-50 hover:brightness-110 transition"
        >
          {busy ? 'Decrypting…' : needsHuman && key.trim() ? 'Verify above to unlock' : 'Unlock & view document'}
        </button>
      </form>

      {/* Full-screen Advottic viewer: the document renders in the browser; no
          file touches disk unless the reader chooses Download. Portaled to
          document.body so a transformed ancestor can't trap the fixed overlay. */}
      {doc && viewerOpen && createPortal(
        <div className="fixed inset-0 z-[70] flex flex-col bg-forest-950">
          <header className="flex items-center gap-3 border-b border-cream-50/10 bg-forest-950 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-cream-50" data-no-translate>{doc.filename}</p>
              <p className="text-[10.5px] uppercase tracking-[0.14em] text-gold-metal/70">Decrypted view · Advottic</p>
            </div>
            <button
              type="button"
              onClick={() => { try { const w = (document.getElementById('share-doc-frame') as HTMLIFrameElement)?.contentWindow; w?.focus(); w?.print(); } catch { window.open(doc.url, '_blank'); } }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-semibold text-cream-100/85 ring-1 ring-cream-50/15 hover:bg-gold-metal/15 hover:text-gold-metal hover:ring-gold-metal/40 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M7 8V4h10v4M7 17h10v4H7v-4Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 17H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-1" stroke="currentColor" strokeWidth="1.8" /></svg>
              <span className="hidden sm:inline">Print</span>
            </button>
            <button
              type="button"
              onClick={download}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-semibold text-cream-100/85 ring-1 ring-cream-50/15 hover:bg-gold-metal/15 hover:text-gold-metal hover:ring-gold-metal/40 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><path d="M12 4v11m0 0-4-4m4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span className="hidden sm:inline">Download</span>
            </button>
            <button
              type="button"
              onClick={() => setViewerOpen(false)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gold-metal px-3.5 py-2 text-[12.5px] font-semibold text-forest-950 shadow-sm ring-1 ring-gold-300/40 hover:brightness-105 transition"
            >
              Close
            </button>
          </header>
          <div className="relative flex-1 bg-forest-900/60">
            <iframe id="share-doc-frame" src={doc.url} title={doc.filename} className="absolute inset-0 h-full w-full border-0" />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
