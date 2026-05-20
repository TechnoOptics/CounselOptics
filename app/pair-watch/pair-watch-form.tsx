'use client';

import { useState } from 'react';

type State =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

/**
 * The 6-digit pair code entry form. Submits to
 * /api/watch/link/approve-by-pair which uses the current Supabase
 * session - the user is already signed in on the phone, no second
 * roundtrip needed.
 */
export function PairWatchForm() {
  const [code, setCode] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === 'working' || code.replace(/\D/g, '').length !== 6) return;
    setState({ kind: 'working' });
    try {
      const res = await fetch('/api/watch/link/approve-by-pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairCode: code }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setState({
          kind: 'error',
          message: data.error || `Pairing failed (HTTP ${res.status}).`,
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
          Watch paired
        </p>
        <p className="mt-1 text-sm leading-relaxed text-emerald-100/80">
          Look at your watch - the QR drops within a few seconds and
          your cases appear.
        </p>
        <button
          type="button"
          onClick={() => {
            setCode('');
            setState({ kind: 'idle' });
          }}
          className="mt-3 text-[12px] text-emerald-200/70 underline hover:text-emerald-100"
        >
          Pair another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="block text-[11px] uppercase tracking-[0.2em] text-[#FBF7E9]/55 mb-1.5">
          6-digit code from watch
        </span>
        <input
          type="text"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          disabled={state.kind === 'working'}
          placeholder="000000"
          className="w-full rounded-lg border border-[#E6CE93]/30 bg-[#0B1F19] px-4 py-3 text-center font-mono text-2xl tracking-[0.4em] text-[#E6CE93] outline-none focus:border-[#E6CE93]/70"
          autoFocus
        />
      </label>
      <button
        type="submit"
        disabled={state.kind === 'working' || code.length !== 6}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#E6CE93] px-5 py-4 text-base font-semibold text-[#0B1F19] shadow-lg shadow-amber-900/30 transition hover:bg-[#d8bd7e] disabled:opacity-50"
      >
        {state.kind === 'working' ? (
          <>
            <Spinner />
            <span>Pairing…</span>
          </>
        ) : (
          <>
            <WatchIcon />
            <span>Pair this watch</span>
          </>
        )}
      </button>
      {state.kind === 'error' && (
        <p className="rounded-lg border border-[#E5816B]/40 bg-[#E5816B]/10 p-3 text-sm text-[#E5816B]">
          {state.message}
        </p>
      )}
    </form>
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
