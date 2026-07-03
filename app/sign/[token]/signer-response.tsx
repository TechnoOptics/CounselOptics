'use client';

import { useState, useTransition } from 'react';
import { respondToSignatureAction } from '@/lib/signing-actions';

type Mode = 'changes_requested' | 'rejected';

/**
 * Lets a signer decline to sign or ask for changes instead of signing.
 * Token-scoped (the sign page is unauthenticated); on submit the firm
 * is notified and the request is put on hold.
 */
export function SignerResponse({ token, firmName }: { token: string; firmName: string }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Mode | null>(null);

  if (done) {
    return (
      <div className="card p-5 text-center">
        <p className="font-semibold text-forest-900 dark:text-cream-100">
          {done === 'rejected' ? 'You declined to sign.' : 'Change request sent.'}
        </p>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1">
          {firmName} has been notified and will follow up. You can close this page.
        </p>
      </div>
    );
  }

  function submit() {
    if (!mode) return;
    setError(null);
    startTransition(async () => {
      const res = await respondToSignatureAction(token, mode, note);
      if (res.ok) setDone(mode);
      else setError(res.error ?? 'Could not send your response.');
    });
  }

  return (
    <div className="card p-4 sm:p-5 space-y-3">
      <p className="text-[13px] text-ink-600 dark:text-cream-100/70">
        Not ready to sign? You can ask for changes or decline.
      </p>
      {!mode ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode('changes_requested')}
            className="inline-flex items-center min-h-[40px] px-3 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 text-[13px] hover:bg-cream-50 dark:hover:bg-forest-800/30"
          >
            Request changes
          </button>
          <button
            type="button"
            onClick={() => setMode('rejected')}
            className="inline-flex items-center min-h-[40px] px-3 rounded-md ring-1 ring-rose-200 dark:ring-rose-900/40 text-rose-700 dark:text-rose-300 text-[13px] hover:bg-rose-50 dark:hover:bg-rose-950/30"
          >
            Decline to sign
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="label" htmlFor="signer-note">
            {mode === 'rejected'
              ? 'Let them know why (optional)'
              : 'What needs to change? (optional)'}
          </label>
          <textarea
            id="signer-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={
              mode === 'rejected'
                ? 'e.g. This isn’t the agreement we discussed.'
                : 'e.g. Please correct the effective date and the fee amount.'
            }
            className="input resize-y"
          />
          {error && <p className="text-[12px] text-rose-600 dark:text-rose-300">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setMode(null)}
              disabled={pending}
              className="inline-flex items-center min-h-[40px] px-3 rounded-md text-[13px] text-ink-600 dark:text-cream-100/70"
            >
              Back
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className={`inline-flex items-center min-h-[40px] px-4 rounded-md text-[13px] font-semibold text-white disabled:opacity-50 ${
                mode === 'rejected' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-forest-700 hover:bg-forest-800'
              }`}
            >
              {pending
                ? 'Sending…'
                : mode === 'rejected'
                  ? 'Decline to sign'
                  : 'Send change request'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
