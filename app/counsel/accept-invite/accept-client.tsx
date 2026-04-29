'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { acceptFirmInvitationAction } from '@/lib/firm-actions';

export function AcceptInviteClient({ token }: { token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState(token);

  function accept() {
    setError(null);
    const t = tokenInput.trim();
    if (!t) {
      setError('Paste the token from your invitation email.');
      return;
    }
    startTransition(async () => {
      const res = await acceptFirmInvitationAction(t);
      if (res.ok) {
        router.push('/counsel');
        router.refresh();
      } else {
        setError(res.error ?? 'Could not accept invitation.');
      }
    });
  }

  return (
    <div className="space-y-3">
      {!token && (
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Invitation token
          </span>
          <input
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Paste the token from your email"
            className="input"
            disabled={pending}
          />
        </label>
      )}
      <button
        type="button"
        onClick={accept}
        disabled={pending || !tokenInput.trim()}
        className="btn-primary w-full"
      >
        {pending ? 'Accepting...' : 'Accept invitation'}
      </button>
      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}
    </div>
  );
}
