'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  approveCounselAccessRequestAction,
  denyCounselAccessRequestAction,
} from '@/lib/firm-actions';

export function RequestActions({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showDeny, setShowDeny] = useState(false);
  const [denyNote, setDenyNote] = useState('');
  const [grantToken, setGrantToken] = useState<string | null>(null);

  function approve() {
    setError(null);
    startTransition(async () => {
      const res = await approveCounselAccessRequestAction(requestId);
      if (!res.ok) {
        setError(res.error ?? 'Could not approve.');
        return;
      }
      setGrantToken(res.grantToken ?? '');
      router.refresh();
    });
  }

  function deny() {
    setError(null);
    startTransition(async () => {
      const res = await denyCounselAccessRequestAction(requestId, denyNote || null);
      if (!res.ok) setError(res.error ?? 'Could not deny.');
      else router.refresh();
    });
  }

  if (grantToken) {
    const link =
      typeof window !== 'undefined'
        ? `${window.location.origin}/counsel/welcome?grant=${grantToken}`
        : `/counsel/welcome?grant=${grantToken}`;
    return (
      <div className="rounded-lg ring-1 ring-emerald-200 dark:ring-emerald-700/40 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-sm space-y-1">
        <p className="text-emerald-900 dark:text-emerald-100 font-semibold">
          Approved. Setup link emailed to applicant.
        </p>
        <p className="text-[11px] text-emerald-900 dark:text-emerald-100/85 font-mono break-all">
          {link}
        </p>
      </div>
    );
  }

  if (showDeny) {
    return (
      <div className="space-y-2">
        <textarea
          value={denyNote}
          onChange={(e) => setDenyNote(e.target.value)}
          rows={2}
          placeholder="Internal note (optional, not sent to applicant)"
          className="input resize-y"
          disabled={pending}
          maxLength={500}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={deny}
            disabled={pending}
            className="btn bg-rose-700 text-white hover:bg-rose-800 text-sm"
          >
            {pending ? 'Denying...' : 'Confirm deny'}
          </button>
          <button
            type="button"
            onClick={() => setShowDeny(false)}
            disabled={pending}
            className="btn-ghost text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={approve}
        disabled={pending}
        className="btn-primary text-sm"
      >
        {pending ? 'Approving...' : 'Approve & email link'}
      </button>
      <button
        type="button"
        onClick={() => setShowDeny(true)}
        disabled={pending}
        className="btn-ghost text-sm text-rose-700 dark:text-rose-300"
      >
        Deny
      </button>
      {error && (
        <span className="text-[12px] text-rose-700 dark:text-rose-300">{error}</span>
      )}
    </div>
  );
}
