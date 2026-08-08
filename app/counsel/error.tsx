'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { ACCESS_ENDED_PATH, isAccessEndedError } from '@/lib/firm-access';

/**
 * Error boundary for the counsel segment, and the ONLY place the access-ended
 * refusal is converted into calm copy.
 *
 * Why this and not a catch at the call site: a
 * `try { await requireActiveFirm(id) } catch { return { ok: false } }` beside
 * the gate is byte-identical to the fail-open the whole feature exists to
 * avoid. A reviewer cannot tell intent from accident, and repeating the shape
 * at every gated action multiplies the chance one of them swallows the wrong
 * error.
 *
 * An error boundary is safe where that is not, and the reason is structural
 * rather than a matter of care: a boundary CANNOT let the action continue. By
 * the time it renders, the write has already been refused and the request is
 * over, so there is no door here for it to open. One catch, in a component
 * whose whole job is catching, tested once, far from the gate.
 *
 * Who sees it: the window between an organization's access state flipping
 * mid-session and that person's next full navigation. Their shell was rendered
 * while the organization was still active, so the layout redirect never ran,
 * and the first thing that tells them is a Save that fails. Without this they
 * get "Something went wrong" on work in progress.
 *
 * The match is on IDENTITY, never on the message. See ACCESS_ENDED_CODE.
 */
export default function CounselError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const accessEnded = isAccessEndedError(error);

  useEffect(() => {
    // An access-ended refusal is the product working, not a crash, so it is
    // not reported. Everything else keeps the reporting app/error.tsx does,
    // because adding this boundary must not create a blind spot in
    // crash_reports for the whole counsel segment.
    if (accessEnded) return;
    try {
      const body = JSON.stringify({
        message: `CounselPageError: ${error?.message ?? 'unknown'}`,
        stack: error?.stack ?? null,
        url:
          typeof location !== 'undefined'
            ? location.pathname + (location.search || '')
            : null,
      });
      if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
        navigator.sendBeacon(
          '/api/crash',
          new Blob([body], { type: 'application/json' }),
        );
      } else if (typeof fetch !== 'undefined') {
        fetch('/api/crash', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      /* never let the reporter throw */
    }
  }, [error, accessEnded]);

  if (accessEnded) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <h1 className="text-xl font-medium text-cream-100">
          Your organization&rsquo;s access has ended
        </h1>
        <p className="mt-2 text-sm text-cream-100/70 leading-relaxed">
          That changed while you were working, so this was not saved. Your data
          is not being deleted, and it is all still here.
        </p>
        <div className="mt-6 flex items-center justify-center">
          <Link
            href={ACCESS_ENDED_PATH}
            className="rounded-lg bg-gold-400 px-5 py-2.5 text-sm font-semibold text-forest-950 hover:bg-gold-300"
          >
            See what you can still do
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-6 py-16 text-center">
      <h1 className="text-xl font-medium text-cream-100">
        Something went wrong
      </h1>
      <p className="mt-2 text-sm text-cream-100/60">
        This page ran into a problem. Try again, and if it keeps happening,
        reload the app.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <button
          onClick={() => reset()}
          className="rounded-lg bg-gold-500 px-5 py-2.5 text-sm font-semibold text-forest-950 hover:bg-gold-400"
        >
          Try again
        </button>
        <button
          onClick={() => {
            if (typeof location !== 'undefined') location.reload();
          }}
          className="rounded-lg border border-forest-700/40 px-5 py-2.5 text-sm font-semibold text-cream-100 hover:bg-forest-900/40"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
