'use client';

import { useState } from 'react';
import { Dialog } from '@/components/Dialog';

/**
 * Encrypt-and-send dialog for a court-packet export. Posts the export target to
 * the share endpoint, which encrypts the PDF with a one-time key and emails the
 * recipient TWO separate messages: the secure link in one, the decryption key
 * in another (so a single forwarded email never contains both). The sender gets
 * the link + key back to relay out-of-band if preferred.
 */

export type ShareTarget = { path: string; label: string };
type ShareResult = { link: string; key: string; emailSent: boolean; recipientEmail: string; expiresAt: string };

export function ShareDialog({ caseId, target, onClose }: { caseId: string; target: ShareTarget; onClose: () => void }) {
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
    <Dialog onClose={onClose} ariaLabel="Share securely" size="sm" elevated>
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
              The document is encrypted with a one-time key. The recipient receives two separate emails: the secure link in one, the decryption key in the other.
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
                ? <>Sent to <span className="font-semibold" data-no-translate>{result.recipientEmail}</span> as two emails — the link in one, the key in the other.</>
                : <>Encrypted and stored, but the email could not be sent — copy the link and key below and send them to the recipient yourself (ideally through two different channels).</>}
            </div>
            <Field label="Secure link" value={result.link} copied={copied === 'link'} onCopy={() => copy(result.link, 'link')} />
            <Field label="Decryption key" value={result.key} mono copied={copied === 'key'} onCopy={() => copy(result.key, 'key')} />
            <p className="text-[11.5px] leading-relaxed text-forest-400 dark:text-cream-100/40">
              For maximum security, consider relaying the key through a different channel (a call or text). Link expires {new Date(result.expiresAt).toLocaleDateString()}.
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
