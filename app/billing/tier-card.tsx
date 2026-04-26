'use client';

import { useState } from 'react';
import { TIER_FEATURES, TIER_LABEL, type Tier } from '@/lib/types';

const TIER_TAGLINE: Record<Tier, string> = {
  basic: 'Get organized.',
  standard: 'Add Legal Eye.',
  pro: 'Go unlimited with collaboration.',
};

type Bullet = { label: string; included: boolean };

function bulletsForTier(tier: Tier): Bullet[] {
  const f = TIER_FEATURES[tier];
  return [
    {
      label:
        f.caseLimit === null ? 'Unlimited cases' : `Up to ${f.caseLimit} case${f.caseLimit === 1 ? '' : 's'}`,
      included: true,
    },
    {
      label: 'Exhibits with category, source, incident date',
      included: true,
    },
    { label: 'PDF case packet export', included: f.pdfExport },
    { label: 'Legal Eye case review', included: f.aiReview },
    { label: 'Bella, your on-demand assistant', included: f.bella },
    { label: 'Invite collaborators (attorney sharing)', included: f.collaborators },
    { label: '7-day free trial', included: true },
  ];
}

export function TierCard({
  tier,
  currentTier,
  isActive,
  stripeReady,
}: {
  tier: Tier;
  currentTier: Tier | null;
  isActive: boolean;
  stripeReady: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const f = TIER_FEATURES[tier];
  const bullets = bulletsForTier(tier);
  const isCurrent = isActive && currentTier === tier;
  const isHighlighted = tier === 'standard';

  async function startCheckout() {
    if (!stripeReady) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
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
      className={`relative rounded-2xl border p-6 flex flex-col transition-all duration-300 hover:-translate-y-0.5 ${
        isHighlighted
          ? 'border-gold-500 shadow-card-hover bg-cream-50/40 animate-glow'
          : 'border-ink-200 bg-white shadow-card hover:border-gold-500/50 hover:shadow-card-hover'
      }`}
    >
      {isHighlighted && (
        <span className="absolute -top-2.5 left-6 badge bg-gold-metal text-forest-950 font-semibold tracking-wide shadow-sm">
          Most popular
        </span>
      )}
      <div className="mb-5">
        <p className="eyebrow mb-1">{TIER_LABEL[tier]}</p>
        <h3 className="font-display text-[26px] font-medium tracking-[-0.01em] leading-[1.1] text-forest-900">
          {TIER_TAGLINE[tier]}
        </h3>
        <p className="mt-3 flex items-baseline gap-1.5">
          <span className="text-3xl font-bold text-ink-950 tabular-nums">${f.monthlyPriceUsd}</span>
          <span className="text-sm text-ink-500">/ month</span>
        </p>
      </div>

      <ul className="space-y-2 mb-6 text-sm flex-1">
        {bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span
              className={`mt-0.5 h-4 w-4 rounded-full flex-none flex items-center justify-center ${
                b.included ? 'bg-forest-900 text-cream-200' : 'bg-ink-100 text-ink-400'
              }`}
              aria-hidden
            >
              {b.included ? <CheckIcon /> : <DashIcon />}
            </span>
            <span className={b.included ? 'text-ink-800' : 'text-ink-400 line-through'}>
              {b.label}
            </span>
          </li>
        ))}
      </ul>

      {isCurrent ? (
        <button type="button" disabled className="btn-secondary w-full opacity-70">
          Your current plan
        </button>
      ) : (
        <button
          type="button"
          onClick={startCheckout}
          disabled={!stripeReady || pending}
          className={
            isHighlighted
              ? 'btn bg-gold-metal text-forest-950 hover:brightness-110 shadow-gold-glow font-semibold w-full'
              : 'btn-primary w-full'
          }
        >
          {pending
            ? 'Opening Stripe...'
            : isActive
              ? `Switch to ${TIER_LABEL[tier]}`
              : `Start ${TIER_LABEL[tier]}`}
        </button>
      )}
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 mt-2">
          {error}
        </p>
      )}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 13l4 4 10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DashIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12h14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
