'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { acceptFirmAction } from '@/lib/marketplace-actions';

export function AcceptFirmButton({
  leadId,
  firmId,
}: {
  leadId: string;
  firmId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function go() {
    setError(null);
    startTransition(async () => {
      const res = await acceptFirmAction(leadId, firmId);
      if (res.ok) router.refresh();
      else setError(res.error ?? 'Could not accept.');
    });
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="btn-ghost text-sm"
          disabled={pending}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={go}
          className="btn-primary"
          disabled={pending}
        >
          {pending ? 'Accepting...' : 'Confirm - share my contact'}
        </button>
        {error && (
          <span className="text-rose-600 dark:text-rose-300 text-sm ml-2">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="btn-primary"
    >
      Accept and share contact
    </button>
  );
}
