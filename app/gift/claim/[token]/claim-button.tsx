'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { claimGiftAction } from './actions';

/**
 * Activate-gift button. Runs the server action and either refreshes
 * the page (which then renders the already-claimed view) or surfaces
 * an error message inline.
 */
export function ClaimButton({ token }: { token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function activate() {
    setError(null);
    startTransition(async () => {
      const res = await claimGiftAction(token);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn-primary inline-flex"
        onClick={activate}
        disabled={pending}
      >
        {pending ? 'Activating…' : 'Activate my gift'}
      </button>
      {error && (
        <p className="text-[12.5px] text-rose-700 dark:text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
