'use client';

import { useEffect, useRef, useState } from 'react';
import { T } from '@/components/i18n/LocaleProvider';
import { PacketIcon } from '@/components/counsel/CaseSectionIcons';
import { Dialog } from '@/components/Dialog';

/**
 * Court-packet export control. Each export target has a Download link AND a
 * Share action: Share securely encrypts that PDF, emails a key-gated link to a
 * recipient, and returns the link + key to the sender. Section scope is passed
 * to the export route as `?section=<key>`; the share endpoint rebuilds the same
 * export before encrypting it.
 */

const SECTIONS: { key: string; label: string }[] = [
  { key: 'overview', label: 'Case summary' },
  { key: 'timeline', label: 'Timeline of events' },
  { key: 'parties', label: 'Parties & entities' },
  { key: 'locations', label: 'Locations' },
  { key: 'exhibits', label: 'Record of exhibits' },
];

type ShareTarget = { path: string; label: string };
type ShareResult = { link: string; key: string; emailSent: boolean; recipientEmail: string; expiresAt: string };

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
  const labelCls =
    'px-3 pt-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-forest-500/70 dark:text-cream-100/40';

  // One row = a download link (left) + a share button (right).
  function Row({ path, label, strong }: { path: string; label: string; strong?: boolean }) {
    return (
      <div className="group/row flex items-center gap-1 rounded-md hover:bg-gold-500/10">
        <a
          href={path}
          download
          onClick={() => setOpen(false)}
          className={`min-w-0 flex-1 truncate rounded-md px-3 py-2 text-[13px] text-forest-900 dark:text-cream-100 group-hover/row:text-gold-700 dark:group-hover/row:text-gold-300 ${strong ? 'font-semibold' : ''}`}
        >
          <span data-no-translate={label.length > 24 ? '' : undefined}>{label.length > 24 ? label : <T>{label}</T>}</span>
        </a>
        <button
          type="button"
          title="Share securely by email"
          aria-label="Share securely by email"
          onClick={() => { setShare({ path, label }); setOpen(false); }}
          className="mr-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-md text-forest-400 hover:bg-gold-500/20 hover:text-gold-600 dark:text-cream-100/40 dark:hover:text-gold-300 transition-colors"
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
          className="absolute right-0 z-40 mt-2 w-72 max-h-[70vh] overflow-y-auto rounded-xl border border-ink-200 dark:border-forest-700/60 bg-white dark:bg-forest-900 p-1.5 shadow-xl"
        >
          <p className="px-3 pt-1.5 pb-1 text-[11px] text-forest-400 dark:text-cream-100/35">
            <T>Download, or share securely with the</T>{' '}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden className="inline align-[-1px]">
              <path d="M12 15V4m0 0L8 8m4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>{' '}
            <T>button.</T>
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

function ShareDialog({ caseId, target, onClose }: { caseId: string; target: ShareTarget; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShareResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/counsel/cases/${caseId}/share`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipientEmail: email.trim(), path: target.path, scopeLabel: target.label, note: note.trim() || undefined }),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) { setError((b as { error?: string }).error || 'Could not share the document.'); return; }
      setResult(b as ShareResult);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const copy = (text: string, which: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(which); setTimeout(() => setCopied(null), 1500); }).catch(() => {});
  };

  return (
    <Dialog onClose={onClose} ariaLabel="Share securely" size="sm">
      <div className="p-5">
        <h2 className="text-[15px] font-semibold text-forest-900 dark:text-cream-50">Share securely</h2>
        <p className="mt-1 text-[12.5px] text-forest-500 dark:text-cream-100/50" data-no-translate>{target.label}</p>

        {!result ? (
          <form onSubmit={submit} className="mt-4 space-y-3">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-forest-600 dark:text-cream-100/60">Recipient email</span>
              <input
                type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
                placeholder="name@example.com"
                className="w-full rounded-lg border border-ink-200 dark:border-forest-700/60 bg-white dark:bg-forest-950 px-3 py-2.5 text-[13px] text-forest-900 dark:text-cream-50 outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-500/20"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-forest-600 dark:text-cream-100/60">Note <span className="text-forest-400 dark:text-cream-100/35">(optional)</span></span>
              <textarea
                value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={400}
                className="w-full resize-none rounded-lg border border-ink-200 dark:border-forest-700/60 bg-white dark:bg-forest-950 px-3 py-2 text-[13px] text-forest-900 dark:text-cream-50 outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-500/20"
              />
            </label>
            <p className="text-[11.5px] leading-relaxed text-forest-400 dark:text-cream-100/40">
              The document is encrypted with a one-time key. The recipient gets a link and the key by email and must enter the key to open it.
            </p>
            {error && <p className="text-[12.5px] text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-ink-200 dark:border-forest-700/60 px-4 py-2.5 text-[13px] font-semibold text-forest-600 dark:text-cream-100/70 hover:bg-ink-50 dark:hover:bg-forest-800/50">Cancel</button>
              <button type="submit" disabled={busy || !email.trim()} className="flex-1 rounded-lg bg-forest-900 dark:bg-gold-metal px-4 py-2.5 text-[13px] font-semibold text-cream-50 dark:text-forest-950 disabled:opacity-50 hover:brightness-110">
                {busy ? 'Encrypting…' : 'Encrypt & send'}
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 p-3 text-[12.5px] text-emerald-800 dark:text-emerald-300">
              {result.emailSent
                ? <>Sent to <span className="font-semibold" data-no-translate>{result.recipientEmail}</span>. They'll need the key below to open it.</>
                : <>Encrypted and stored, but the email could not be sent — copy the link and key below and send them to the recipient yourself.</>}
            </div>
            <Field label="Secure link" value={result.link} copied={copied === 'link'} onCopy={() => copy(result.link, 'link')} />
            <Field label="Decryption key" value={result.key} mono copied={copied === 'key'} onCopy={() => copy(result.key, 'key')} />
            <p className="text-[11.5px] leading-relaxed text-forest-400 dark:text-cream-100/40">
              For maximum security, consider sending the key to the recipient through a different channel (a call or text) rather than the same inbox. Link expires {new Date(result.expiresAt).toLocaleDateString()}.
            </p>
            <button type="button" onClick={onClose} className="w-full rounded-lg bg-forest-900 dark:bg-gold-metal px-4 py-2.5 text-[13px] font-semibold text-cream-50 dark:text-forest-950 hover:brightness-110">Done</button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Field({ label, value, mono, copied, onCopy }: { label: string; value: string; mono?: boolean; copied: boolean; onCopy: () => void }) {
  return (
    <div>
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-forest-400 dark:text-cream-100/40">{label}</span>
      <div className="flex items-stretch gap-1.5">
        <div className={`min-w-0 flex-1 truncate rounded-lg border border-ink-200 dark:border-forest-700/60 bg-ink-50 dark:bg-forest-950 px-3 py-2 text-[12.5px] text-forest-800 dark:text-cream-100 ${mono ? 'font-mono' : ''}`} data-no-translate>{value}</div>
        <button type="button" onClick={onCopy} className="shrink-0 rounded-lg border border-ink-200 dark:border-forest-700/60 px-3 text-[12px] font-semibold text-forest-600 dark:text-cream-100/70 hover:bg-gold-500/10 hover:text-gold-700 dark:hover:text-gold-300">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
