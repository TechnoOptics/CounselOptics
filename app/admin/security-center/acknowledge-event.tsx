'use client';

import { useState, useTransition } from 'react';
import { acknowledgeSecurityEventAction } from '@/lib/security-event-actions';

/**
 * The control the Security Center implied and did not have.
 *
 * The feed showed which events were open and the posture grade counted
 * them, but nothing anywhere could close one, so the grade was pinned. This
 * is the missing half.
 *
 * It reports a refusal rather than swallowing it. An update whose filter
 * matched nothing comes back from PostgREST with no error at all, so the
 * action counts the rows it wrote and says so; the operator needs to be able
 * to tell "closed" from "looked closed".
 */
export function AcknowledgeEventButton({ eventId }: { eventId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await acknowledgeSecurityEventAction(eventId);
            if (!res.ok) setError(res.error);
          });
        }}
        className="rounded-md px-2 py-[3px] text-[11px] font-semibold text-cream-100/85 ring-1 ring-white/15 bg-white/[0.06] hover:bg-white/[0.12] disabled:opacity-50"
      >
        {pending ? 'Acknowledging…' : 'Acknowledge'}
      </button>
      {error && (
        <span
          role="status"
          className="max-w-[16rem] text-right text-[10.5px] leading-snug text-amber-100/90"
        >
          {error}
        </span>
      )}
    </span>
  );
}
