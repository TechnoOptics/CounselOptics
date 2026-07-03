'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { verifyAccessCodeAction } from '@/lib/signing-actions';

/**
 * One-time access-code gate (#5). Shown before the document when an
 * external signer's request requires a code. The code arrives in a
 * separate email from the sign link, so clearing this proves the
 * person controls the mailbox the firm addressed. On success we
 * refresh so the server re-renders the page with the document.
 */
export function AccessCodeGate({
  token,
  firmName,
  documentName,
}: {
  token: string;
  firmName: string;
  documentName: string;
}) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    const cleaned = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleaned.length < 4) {
      setError('Enter the code from your email.');
      return;
    }
    startTransition(async () => {
      const res = await verifyAccessCodeAction(token, cleaned);
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error ?? 'That code did not match.');
      }
    });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-cream-50 to-white dark:from-forest-950 dark:to-forest-900 px-4">
      <div className="max-w-md w-full card p-8">
        <p className="eyebrow mb-2 justify-center">Secure access</p>
        <h1 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 text-center">
          Enter your access code
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed text-center">
          {firmName} sent a one-time code to your email to open{' '}
          <strong>{documentName}</strong>. Enter it below.
        </p>
        <div className="mt-5">
          <label htmlFor="access-code" className="sr-only">
            Access code
          </label>
          <input
            id="access-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            inputMode="text"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            maxLength={8}
            placeholder="ABC 234"
            disabled={pending}
            className="input text-center text-2xl font-mono tracking-[0.3em] uppercase min-h-[56px]"
            aria-describedby={error ? 'access-code-error' : undefined}
          />
        </div>
        {error && (
          <p
            id="access-code-error"
            className="mt-2 text-[13px] text-rose-600 dark:text-rose-300 text-center"
          >
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="btn-primary w-full mt-4 min-h-[48px] justify-center"
        >
          {pending ? 'Checking…' : 'Open document'}
        </button>
        <p className="mt-4 text-[11.5px] text-ink-500 dark:text-cream-100/50 leading-relaxed text-center">
          Didn&rsquo;t get a code? Check spam, or ask {firmName} to resend the
          signing request.
        </p>
      </div>
    </div>
  );
}
