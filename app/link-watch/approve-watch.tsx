'use client';

import { useState } from 'react';

type State =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

/**
 * Calls /api/watch/link/approve with the pairing code. On success
 * the server has minted a read-scoped `adv_` token and parked it
 * for the watch's next poll - the watch picks it up within a few
 * seconds and starts syncing over HTTPS (no Data Layer).
 *
 * Visual UX: the previous version was a single muted button users
 * routinely missed after signing in (5 stale pending codes per user
 * in the wild = this was a daily problem). The button is now
 * full-width, bright gold, with a clear icon, big enough to read at
 * arm's length on a phone, and the success state is unmissable.
 */
export function ApproveWatch({ code }: { code: string }) {
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function approve() {
    setState({ kind: 'working' });
    try {
      const res = await fetch('/api/watch/link/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setState({
          kind: 'error',
          message: data.error || `Could not link (HTTP ${res.status}).`,
        });
        return;
      }
      setState({ kind: 'done' });
    } catch {
      setState({
        kind: 'error',
        message: 'Network error. Check your connection and try again.',
      });
    }
  }

  if (state.kind === 'done') {
    return (
      <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-5 text-center">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/30">
          <CheckIcon />
        </div>
        <p className="text-lg font-semibold text-emerald-200">
          Watch linked
        </p>
        <p className="mt-1 text-sm leading-relaxed text-emerald-100/80">
          Look at your watch - it should drop the QR screen and start
          showing your cases within a few seconds. You can close this
          tab now.
        </p>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={approve}
        disabled={state.kind === 'working'}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#E6CE93] px-5 py-4 text-base font-semibold text-[#0B1F19] shadow-lg shadow-amber-900/30 transition hover:bg-[#d8bd7e] disabled:opacity-60"
      >
        {state.kind === 'working' ? (
          <>
            <Spinner />
            <span>Linking your watch…</span>
          </>
        ) : (
          <>
            <WatchIcon />
            <span>Link this watch to my account</span>
          </>
        )}
      </button>
      {state.kind === 'error' && (
        <p className="mt-3 rounded-lg border border-[#E5816B]/40 bg-[#E5816B]/10 p-3 text-sm text-[#E5816B]">
          {state.message}
        </p>
      )}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-emerald-200"
      aria-hidden
    >
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

function WatchIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 6l1-3h4l1 3M9 18l1 3h4l1-3" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden
    >
      <path d="M12 3a9 9 0 1 1-9 9" />
    </svg>
  );
}
