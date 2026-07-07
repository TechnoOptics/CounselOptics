'use client';

import { useState } from 'react';
import { useIsNativeApp } from '@/components/useIsNativeApp';
import type { NativePlatform } from '@/lib/platform';
import type { PersonalTier, PersonalTierKey } from '@/lib/personal-tiers';

/**
 * One card in the 5-rung consumer ladder. Shows the case cap plus a feature
 * matrix where locked, more-"revolutionary" features carry a padlock — so a
 * lower tier can see exactly what an upgrade unlocks. iOS uses the reader
 * model (no in-app buy button; a note points to advottic.com).
 */

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function Lock() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" fill="currentColor" opacity="0.5" />
      <path d="M8 11V8a4 4 0 018 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

type FeatureRow = { label: string; on: boolean };

function featureRows(t: PersonalTier): FeatureRow[] {
  return [
    { label: `${t.caseLimit} case${t.caseLimit === 1 ? '' : 's'}`, on: true },
    { label: 'PDF export', on: true },
    { label: 'Bella AI assistant', on: t.bella },
    { label: 'Advottic Review', on: t.aiReview },
    { label: 'Invite your law firm', on: t.collaborators },
    { label: 'Case timeline', on: t.timeline },
    { label: 'Group / community cases', on: t.groupCases },
  ];
}

export function PersonalTierCard({
  tier,
  currentKey,
  isActive,
  stripeReady,
  priceConfigured,
  serverPlatform,
  highlighted,
}: {
  tier: PersonalTier;
  currentKey: PersonalTierKey | null;
  isActive: boolean;
  stripeReady: boolean;
  priceConfigured: boolean;
  serverPlatform: NativePlatform | null;
  highlighted: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ready, platform } = useIsNativeApp();
  const isIOS = serverPlatform === 'ios' || (ready && platform === 'ios');

  const isCurrent = isActive && currentKey === tier.key;
  const isPaid = tier.priceUsd > 0;
  const rows = featureRows(tier);

  async function startCheckout() {
    if (!stripeReady || !isPaid) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: tier.key }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not start checkout.');
      window.location.assign(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout.');
      setPending(false);
    }
  }

  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-5 transition-all duration-300 ${
        highlighted
          ? 'border-gold-500 bg-cream-50/50 shadow-card-hover dark:bg-forest-900/60'
          : 'border-ink-200 bg-white shadow-card hover:border-gold-500/50 dark:border-forest-700/40 dark:bg-forest-900/40'
      }`}
    >
      {highlighted && (
        <span className="absolute -top-2.5 left-5 badge bg-gold-metal text-forest-950 font-semibold tracking-wide shadow-sm">
          Bella unlocks here
        </span>
      )}
      <div className="mb-4">
        <p className="eyebrow mb-1">{tier.name}</p>
        <p className="text-[13px] text-ink-500 dark:text-cream-100/60">{tier.tagline}</p>
        <p className="mt-2 flex items-baseline gap-1">
          <span className="text-3xl font-bold tabular-nums text-ink-950 dark:text-cream-50">${tier.priceUsd}</span>
          <span className="text-sm text-ink-500 dark:text-cream-100/55">/ mo</span>
        </p>
      </div>

      <ul className="mb-5 flex-1 space-y-2 text-sm">
        {rows.map((r) => (
          <li key={r.label} className={`flex items-center gap-2 ${r.on ? 'text-ink-800 dark:text-cream-100/90' : 'text-ink-400 dark:text-cream-100/35'}`}>
            <span
              className={`grid h-4 w-4 flex-none place-items-center rounded-full ${
                r.on ? 'bg-forest-900 text-cream-200 dark:bg-gold-metal dark:text-forest-950' : 'text-ink-400 dark:text-cream-100/35'
              }`}
              aria-hidden
            >
              {r.on ? <Check /> : <Lock />}
            </span>
            <span className={r.on ? '' : 'line-through decoration-ink-300/60'}>{r.label}</span>
          </li>
        ))}
      </ul>

      {isCurrent ? (
        <span className="rounded-lg bg-forest-900/5 px-4 py-2 text-center text-sm font-medium text-forest-900 dark:bg-cream-50/10 dark:text-cream-100">
          Current plan
        </span>
      ) : !isPaid ? (
        <span className="rounded-lg px-4 py-2 text-center text-sm text-ink-400 dark:text-cream-100/40">
          Free forever
        </span>
      ) : isIOS ? (
        <p className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-center text-[12px] leading-snug text-ink-600 dark:border-forest-700/40 dark:bg-forest-950/40 dark:text-cream-100/70">
          Subscribe on the web at <span className="font-semibold">advottic.com</span>
        </p>
      ) : !priceConfigured ? (
        <span className="rounded-lg border border-dashed border-ink-300 px-4 py-2 text-center text-sm text-ink-400 dark:border-forest-700/50 dark:text-cream-100/40">
          Coming soon
        </span>
      ) : (
        <button
          type="button"
          onClick={startCheckout}
          disabled={pending || !stripeReady}
          className="btn-primary w-full justify-center disabled:opacity-50"
        >
          {pending ? 'Starting…' : `Choose ${tier.name}`}
        </button>
      )}
      {error && <p className="mt-2 text-center text-[12px] text-rose-600">{error}</p>}
    </div>
  );
}
