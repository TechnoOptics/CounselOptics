'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createTokenAction } from './actions';

export function NewTokenForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ token: string; prefix: string } | null>(
    null,
  );

  function submit(formData: FormData) {
    setError(null);
    const name = String(formData.get('name') ?? '').trim();
    if (!name) {
      setError('Name is required.');
      return;
    }
    startTransition(async () => {
      const res = await createTokenAction(name);
      if (res.ok && res.token) {
        setCreated({ token: res.token, prefix: res.prefix ?? '' });
        router.refresh();
      } else {
        setError(res.error ?? 'Could not create token.');
      }
    });
  }

  if (created) {
    return (
      <div className="card p-5 ring-1 ring-amber-300/50 dark:ring-amber-700/40 bg-amber-50/40 dark:bg-amber-950/20 space-y-3">
        <p className="eyebrow text-amber-800 dark:text-amber-200">
          Token created - save it now
        </p>
        <p className="text-[12.5px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
          This is the only time we&rsquo;ll show the full token. After you
          leave this page, only the prefix is visible.
        </p>
        <pre className="text-[12px] font-mono p-3 rounded-md bg-white dark:bg-forest-950 ring-1 ring-amber-200 dark:ring-amber-700/40 break-all whitespace-pre-wrap select-all">
{created.token}
        </pre>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(created.token)}
            className="btn-secondary text-sm"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={() => setCreated(null)}
            className="btn-ghost text-sm"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={submit} className="card p-5 space-y-3">
      <p className="eyebrow">Issue a new token</p>
      <label className="block">
        <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
          Name
        </span>
        <input
          name="name"
          required
          placeholder="Browser extension on my laptop"
          className="input"
        />
      </label>
      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-ink-500 dark:text-cream-100/55">
          Default scope is <code className="font-mono">read</code>. Tokens
          never expire automatically; revoke them from the list below when
          you&rsquo;re done.
        </p>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? 'Creating...' : 'Create token'}
        </button>
      </div>
    </form>
  );
}
