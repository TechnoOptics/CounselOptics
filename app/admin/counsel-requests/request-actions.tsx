'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  approveCounselAccessRequestAction,
  denyCounselAccessRequestAction,
  scheduleCounselRequestAction,
} from '@/lib/firm-actions';

type Mode = 'idle' | 'schedule' | 'deny';

/**
 * Triage controls for a single counsel access request. Three paths:
 *   1. Schedule: propose a discovery call before deciding. Moves the
 *      request to 'scheduled' status; emails the applicant.
 *   2. Approve: mints a grant and emails the setup link.
 *   3. Deny: closes the request with an optional internal note.
 */
export function RequestActions({
  requestId,
  alreadyScheduled,
}: {
  requestId: string;
  alreadyScheduled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [denyNote, setDenyNote] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [scheduledNote, setScheduledNote] = useState('');
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

  function schedule() {
    setError(null);
    if (!scheduledAt) {
      setError('Pick a date and time.');
      return;
    }
    startTransition(async () => {
      const iso = new Date(scheduledAt).toISOString();
      const res = await scheduleCounselRequestAction(requestId, iso, scheduledNote);
      if (!res.ok) setError(res.error ?? 'Could not schedule.');
      else {
        setMode('idle');
        router.refresh();
      }
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

  if (mode === 'schedule') {
    return (
      <div className="space-y-2">
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          className="input"
          disabled={pending}
        />
        <textarea
          value={scheduledNote}
          onChange={(e) => setScheduledNote(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Optional - included in the email to the applicant"
          className="input resize-y"
          disabled={pending}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={schedule}
            disabled={pending}
            className="btn-primary text-sm"
          >
            {pending ? 'Sending...' : 'Send proposal'}
          </button>
          <button
            type="button"
            onClick={() => setMode('idle')}
            disabled={pending}
            className="btn-ghost text-sm"
          >
            Cancel
          </button>
          {error && (
            <span className="text-[12px] text-rose-700 dark:text-rose-300">{error}</span>
          )}
        </div>
      </div>
    );
  }

  if (mode === 'deny') {
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
            onClick={() => setMode('idle')}
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
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={approve}
        disabled={pending}
        className="btn-primary text-sm"
      >
        {pending ? 'Approving...' : 'Approve & email link'}
      </button>
      {!alreadyScheduled && (
        <button
          type="button"
          onClick={() => setMode('schedule')}
          disabled={pending}
          className="btn-ghost text-sm"
        >
          Schedule a call
        </button>
      )}
      <button
        type="button"
        onClick={() => setMode('deny')}
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
