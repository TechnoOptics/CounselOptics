'use client';

import { useState } from 'react';

type State =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

/**
 * Calls /api/watch/link/approve with the pairing code. On success the
 * server has minted a read-scoped adv_ token and parked it for the
 * watch's next poll - the watch picks it up within a few seconds and
 * starts syncing over HTTPS (no Data Layer).
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
      <div className="text-[#FBF7E9]">
        <p className="mb-1 text-lg font-semibold text-[#E6CE93]">
          Watch linked
        </p>
        <p className="text-sm text-[#FBF7E9]/70">
          Your watch will sync within a few seconds. You can close this
          page. To unlink later, revoke the &ldquo;Wear OS watch&rdquo;
          token in API tokens.
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
        className="w-full rounded-xl bg-[#E6CE93] px-5 py-3 font-semibold text-[#0B1F19] transition hover:bg-[#d8bd7e] disabled:opacity-60"
      >
        {state.kind === 'working' ? 'Linking…' : 'Link this watch'}
      </button>
      {state.kind === 'error' && (
        <p className="mt-3 text-sm text-[#E5816B]">{state.message}</p>
      )}
    </div>
  );
}
