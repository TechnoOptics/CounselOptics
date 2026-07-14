'use client';

import { useState } from 'react';
import { TurnstileWidget } from '@/components/turnstile-widget';

const TURNSTILE_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

/**
 * Key entry for a secure share. Once a key is pasted, a human-verification
 * challenge (Cloudflare Turnstile) appears and must be passed before the
 * unlock button activates — the server re-verifies the challenge before
 * decrypting. Posts the key to the open API; on success the decrypted PDF
 * comes back as a blob which we hand to the browser as a download (and open
 * in a new tab). The key never leaves as a query param. In environments
 * without a Turnstile site key the challenge is skipped (env-gated, same as
 * the community forms).
 */
export function UnlockForm({ token }: { token: string }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileExpired, setTurnstileExpired] = useState(false);

  const needsHuman = TURNSTILE_CONFIGURED && !turnstileToken;

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
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setDone(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 p-4 text-[13px] text-emerald-800 dark:text-emerald-300">
        Document unlocked. Your download should have started. You can re-enter the key to open it again.
        <button
          type="button"
          onClick={() => setDone(false)}
          className="mt-2 block text-[12.5px] font-semibold underline underline-offset-2"
        >
          Open again
        </button>
      </div>
    );
  }

  return (
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
      {/* Human verification: appears once a key has been entered, and must be
          passed before the unlock button activates. */}
      {TURNSTILE_CONFIGURED && key.trim() && (
        <div className="space-y-1.5">
          <span className="block text-[12px] font-medium text-forest-600 dark:text-cream-100/60">Confirm you are human</span>
          <TurnstileWidget
            onToken={setTurnstileToken}
            onExpire={() => setTurnstileExpired(true)}
          />
          {turnstileExpired && !turnstileToken && (
            <p className="text-[12px] text-forest-500 dark:text-cream-100/50">The verification expired — please complete it again.</p>
          )}
        </div>
      )}
      {error && <p className="text-[12.5px] text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy || !key.trim() || needsHuman}
        className="w-full rounded-lg bg-forest-900 dark:bg-gold-metal px-4 py-2.5 text-[13.5px] font-semibold text-cream-50 dark:text-forest-950 disabled:opacity-50 hover:brightness-110 transition"
      >
        {busy ? 'Unlocking…' : needsHuman && key.trim() ? 'Complete verification to unlock' : 'Unlock document'}
      </button>
    </form>
  );
}
