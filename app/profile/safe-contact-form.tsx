'use client';

import { useState, useTransition } from 'react';
import { updateSafeContactEmailAction } from '@/lib/actions';

/**
 * Safe Witness contact email setter on /profile. Single email
 * (v1); future iteration can grow to multiple contacts. Empty
 * value disables Safe Witness entirely.
 */
export function SafeContactForm({
  initial,
}: {
  initial: string | null;
}) {
  const [email, setEmail] = useState(initial ?? '');
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<
    null | { kind: 'ok'; text: string } | { kind: 'error'; text: string }
  >(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('safeContactEmail', email.trim());
      const res = await updateSafeContactEmailAction(fd);
      if (!res.ok) {
        setMessage({ kind: 'error', text: res.error });
        return;
      }
      setMessage({
        kind: 'ok',
        text: res.email
          ? `Saved. ${res.email} will be alerted on Safe Witness triggers.`
          : 'Safe Witness disabled. No contact will be alerted.',
      });
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="block">
        <span className="block text-[12px] uppercase tracking-[0.16em] text-ink-500 dark:text-cream-100/55 mb-1">
          Contact email
        </span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="someone@example.com"
          className="input"
          disabled={pending}
          autoComplete="email"
          inputMode="email"
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="btn-primary text-[13px] px-4 py-2 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save contact'}
        </button>
        {initial && (
          <button
            type="button"
            onClick={() => {
              setEmail('');
            }}
            disabled={pending}
            className="text-[12px] text-ink-500 dark:text-cream-100/55 hover:text-ink-900 dark:hover:text-cream-100 underline"
          >
            Clear (disable)
          </button>
        )}
      </div>
      {message && (
        <p
          className={`text-[12.5px] rounded-md px-3 py-2 ${
            message.kind === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-1 ring-emerald-300/50 dark:ring-emerald-500/30'
              : 'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 ring-1 ring-rose-300/50 dark:ring-rose-500/30'
          }`}
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
