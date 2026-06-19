'use client';

import { useEffect, useState } from 'react';
import { TopUpModal } from './TopUpModal';

type Snapshot = {
  combined: number;
  firmPool: number | null;
  personal: number;
  monthlyGrant: number;
};

/**
 * Compact Bella token balance gauge. Drops into the consumer
 * header (sidebar) and the firm-side header.
 *
 * Shows the combined balance as a horizontal bar; ring tone shifts
 * to amber under 30% and rose under 10%. Click opens the top-up
 * modal with the four packs.
 *
 * Polls /api/billing/token-balance every 30s; the polling cost is
 * negligible (one indexed select on profiles.token_balance per
 * tick). Falls back to the SSR snapshot if the API errors.
 */
export function TokenBalanceGauge({
  initial,
}: {
  initial: Snapshot;
}) {
  const [snap, setSnap] = useState<Snapshot>(initial);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const r = await fetch('/api/billing/token-balance', { cache: 'no-store' });
        if (!r.ok) return;
        const j = (await r.json()) as Snapshot;
        if (alive) setSnap(j);
      } catch {
        /* ignore */
      }
    }
    const id = setInterval(tick, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Pro tier (and Pro-trial) gets a monthlyGrant > 0 and the gauge.
  // Lower tiers have no grant and no balance; rendering "0 of 1"
  // implies a locked-out state that misrepresents what they get.
  // Hide the badge entirely in that case. Users with a firmPool
  // also always see the gauge (firm-side surface).
  const hasMeaningfulGrant = snap.monthlyGrant > 0 || snap.firmPool !== null || snap.combined > 0;
  const grant = Math.max(snap.monthlyGrant, 1);
  const pct = Math.min(100, Math.max(0, (snap.combined / grant) * 100));

  if (!hasMeaningfulGrant) return null;
  const tone =
    pct < 10
      ? 'ring-rose-300 dark:ring-rose-700/40 bg-rose-50/60 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200'
      : pct < 30
        ? 'ring-amber-300 dark:ring-amber-700/40 bg-amber-50/60 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200'
        : 'ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-900/40 text-ink-700 dark:text-cream-100/85';
  const fillTone =
    pct < 10
      ? 'bg-rose-500'
      : pct < 30
        ? 'bg-amber-500'
        : 'bg-emerald-500';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-hide-on-ios
        className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-md ring-1 transition-colors ${tone}`}
        title={`${snap.combined.toLocaleString()} Bella tokens left of ${grant.toLocaleString()} this period`}
      >
        <span aria-hidden className="relative inline-flex h-1.5 w-12 rounded-full bg-ink-200/60 dark:bg-forest-800/60 overflow-hidden">
          <span
            className={`absolute left-0 top-0 bottom-0 ${fillTone} transition-all`}
            style={{ width: `${pct}%` }}
          />
        </span>
        <span className="text-[11.5px] font-mono tabular-nums">
          {formatTokens(snap.combined)}
        </span>
      </button>
      {open && (
        <TopUpModal
          onClose={() => setOpen(false)}
          firmPool={snap.firmPool !== null}
        />
      )}
    </>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toString();
}
