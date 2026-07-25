import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SmartAssistForm } from './smart-assist';
import {
  getEffectiveTrialState,
  getCurrentSubscription,
} from '@/lib/storage';
import {
  getCurrentUser,
  isSupabaseConfigured,
} from '@/lib/supabase/server';
import { countItemsForUser, calculateOverage } from '@/lib/item-limits';
import type { TierSlug } from '@/lib/token-packages';
import {
  TIER_ITEM_LIMITS,
  ITEM_OVERAGE_TOKENS_PER_MONTH,
} from '@/lib/token-packages';

export const dynamic = 'force-dynamic';

export default async function NewCasePage() {
  // Post-trial paywall: free trial ended without a subscription. Bounce
  // to /billing before they fill out the wizard. Active subscribers,
  // Stripe-trialing users, and free-trial users (first 7 days from
  // signup_history.first_signup_at) all see the form normally.
  let overage: ReturnType<typeof calculateOverage> | null = null;
  let effectiveTier: TierSlug = 'free';
  if (isSupabaseConfigured()) {
    const state = await getEffectiveTrialState().catch(() => null);
    if (state?.mode === 'expired') {
      redirect('/billing?gate=trial-ended');
    }
    // Item-cap awareness. Show a soft banner when the user is
    // approaching or past the cap so they aren't surprised by the
    // overage debit at month-end. Best-effort; failures degrade to
    // 'no banner' silently.
    try {
      const user = await getCurrentUser();
      if (user) {
        const sub = await getCurrentSubscription().catch(() => null);
        const isActive = sub?.status === 'active' || sub?.status === 'trialing';
        effectiveTier = (isActive && sub?.tier
          ? (sub.tier as TierSlug)
          : 'free') as TierSlug;
        const count = await countItemsForUser(user.id);
        overage = calculateOverage(count.total, effectiveTier);
      }
    } catch {
      /* swallow - the banner is informational, not required */
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-up">
      <div>
        <div className="mb-4">
          <Link
            href="/cases"
            className="inline-block text-sm text-ink-500 hover:text-ink-700 dark:hover:text-cream-100"
          >
            &larr; Back to cases
          </Link>
        </div>
        <p className="eyebrow mb-2">Smart assist</p>
        <h1 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Let&apos;s set up your case file.
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1.5 leading-relaxed">
          One question at a time. Skip anything optional. You can change everything later.
        </p>
      </div>

      {/* Cap-awareness banner. Three states:
          - Free hit: hard nudge to upgrade (no overage path)
          - Over: amber message about token debit + Upgrade/Boost CTAs
          - Approaching (>=80%): heads-up so the user knows what's next
          Banner is rendered ONLY when relevant; the wizard renders
          without prompt for everyone else. */}
      {overage && overage.itemLimit !== null && (
        <ItemCapBanner
          tier={effectiveTier}
          itemsUsed={overage.itemsUsed}
          itemLimit={overage.itemLimit}
          overage={overage.overage}
          monthlyOverageTokens={overage.monthlyOverageTokens}
          isOver={overage.isOver}
          isApproaching={overage.isApproaching}
        />
      )}

      <SmartAssistForm />
    </div>
  );
}

function ItemCapBanner({
  tier,
  itemsUsed,
  itemLimit,
  overage,
  monthlyOverageTokens,
  isOver,
  isApproaching,
}: {
  tier: TierSlug;
  itemsUsed: number;
  itemLimit: number;
  overage: number;
  monthlyOverageTokens: number;
  isOver: boolean;
  isApproaching: boolean;
}) {
  // Free users can't overage; the only path is to upgrade.
  if (tier === 'free' && itemsUsed >= itemLimit) {
    return (
      <div className="rounded-lg ring-1 ring-rose-200 dark:ring-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-[13px] text-rose-900 dark:text-rose-100 leading-relaxed">
        <strong>You&rsquo;re on Free with {itemLimit} item.</strong> Creating
        another item requires a paid tier<span data-hide-on-ios> - the Pro plan ($19/mo) gives you 20
        items + 500K Bella tokens</span>.{' '}
        <Link href="/pricing" data-hide-on-ios className="underline font-semibold">
          Compare tiers &rarr;
        </Link>
      </div>
    );
  }
  if (isOver) {
    return (
      <div className="rounded-lg ring-1 ring-amber-300 dark:ring-amber-700/40 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-[13px] text-amber-900 dark:text-amber-100 leading-relaxed">
        <strong>
          You&rsquo;re {overage} item{overage === 1 ? '' : 's'} past your{' '}
          {itemLimit}-item plan.
        </strong>{' '}
        This case will add ~
        {(monthlyOverageTokens + (ITEM_OVERAGE_TOKENS_PER_MONTH[tier] ?? 0)).toLocaleString()}{' '}
        tokens to next month&rsquo;s overage debit (it&rsquo;s small, but it
        adds up).{' '}
        <Link href="/pricing" data-hide-on-ios className="underline font-semibold">
          See if upgrading saves you money &rarr;
        </Link>
      </div>
    );
  }
  if (isApproaching) {
    return (
      <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50 dark:bg-forest-900/40 px-4 py-3 text-[12.5px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
        Heads up: you&rsquo;re at{' '}
        <strong>
          {itemsUsed} of {itemLimit}
        </strong>{' '}
        items on your plan. Items past the cap start consuming Bella tokens at{' '}
        {(ITEM_OVERAGE_TOKENS_PER_MONTH[tier] ?? 0).toLocaleString()} tokens /
        item / month.{' '}
        <Link
          href="/pricing"
          data-hide-on-ios
          className="underline hover:text-forest-900 dark:hover:text-cream-100"
        >
          Tier comparison
        </Link>
      </div>
    );
  }
  return null;
}
