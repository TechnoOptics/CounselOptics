import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getCurrentSubscription } from '@/lib/storage';
import { isStripeConfigured } from '@/lib/stripe';
import { TIER_FEATURES, TIER_LABEL, type Tier } from '@/lib/types';
import { TierCard } from './tier-card';
import { ManageButton } from './billing-actions';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  inactive: 'No active subscription',
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Past due',
  canceled: 'Canceled',
  incomplete: 'Incomplete',
  unpaid: 'Unpaid',
};

const STATUS_STYLES: Record<string, string> = {
  inactive: 'bg-ink-100 text-ink-700',
  trialing: 'bg-sky-50 text-sky-800 border border-sky-200',
  active: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
  past_due: 'bg-amber-50 text-amber-900 border border-amber-200',
  canceled: 'bg-ink-100 text-ink-600',
  incomplete: 'bg-rose-50 text-rose-800 border border-rose-200',
  unpaid: 'bg-rose-50 text-rose-800 border border-rose-200',
};

const TIER_ORDER: Tier[] = ['basic', 'standard', 'pro'];

export default async function BillingPage({
  searchParams,
}: {
  searchParams?: { success?: string; canceled?: string };
}) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="max-w-xl mx-auto card p-8 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight text-forest-900">Billing</h1>
        <p className="text-sm text-ink-600">
          Auth is not configured yet. Follow <code>SETUP.md</code>.
        </p>
      </div>
    );
  }

  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/billing');

  const sub = await getCurrentSubscription();
  const stripeReady = isStripeConfigured();
  const status = sub?.status ?? 'inactive';
  const isActive = status === 'active' || status === 'trialing';
  const currentTier: Tier | null = sub?.tier ?? null;

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <p className="eyebrow mb-2">Billing</p>
        <h1 className="text-3xl font-semibold tracking-tight text-forest-900">
          Choose your tier
        </h1>
        <p className="text-sm text-ink-600 mt-1 max-w-2xl">
          Three tiers, monthly billing, 7-day free trial for first-time subscribers. Cancel any
          time. Upgrade or downgrade from the customer portal.
        </p>
      </div>

      {searchParams?.success === '1' && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Subscription confirmed. It can take a moment for the status to refresh while Stripe
          sends the confirmation event.
        </p>
      )}
      {searchParams?.canceled === '1' && (
        <p className="rounded-lg border border-ink-200 bg-ink-50 px-4 py-3 text-sm text-ink-700">
          Checkout canceled. You can subscribe whenever you're ready.
        </p>
      )}

      {/* Current status */}
      <div className="card p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="eyebrow mb-1">Current plan</p>
          <div className="flex items-center gap-2">
            <span className={`badge ${STATUS_STYLES[status] || STATUS_STYLES.inactive}`}>
              {STATUS_LABEL[status] || status}
            </span>
            {currentTier && (
              <span className="badge bg-forest-900 text-cream-200">
                {TIER_LABEL[currentTier]}
              </span>
            )}
          </div>
          {sub?.currentPeriodEnd && (
            <p className="text-xs text-ink-500 mt-2">
              {sub.cancelAtPeriodEnd ? 'Ends on' : 'Renews on'}{' '}
              {new Date(sub.currentPeriodEnd).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </p>
          )}
        </div>
        {isActive && (
          <ManageButton
            stripeReady={stripeReady}
            hasCustomer={Boolean(sub?.stripeCustomerId)}
          />
        )}
      </div>

      {!stripeReady && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium mb-1">Stripe is not connected</p>
          <p className="leading-relaxed">
            Add <code className="font-mono">STRIPE_SECRET_KEY</code>,{' '}
            <code className="font-mono">STRIPE_PRICE_BASIC</code>,{' '}
            <code className="font-mono">STRIPE_PRICE_STANDARD</code>,{' '}
            <code className="font-mono">STRIPE_PRICE_PRO</code>, and{' '}
            <code className="font-mono">STRIPE_WEBHOOK_SECRET</code> in Vercel to enable
            checkout. Subscribe buttons below are disabled until then.
          </p>
        </div>
      )}

      {/* Three tier cards */}
      <div className="grid gap-4 md:grid-cols-3 items-stretch">
        {TIER_ORDER.map((t) => (
          <TierCard
            key={t}
            tier={t}
            currentTier={currentTier}
            isActive={isActive}
            stripeReady={stripeReady}
          />
        ))}
      </div>

      <div className="text-xs text-ink-500 leading-relaxed">
        Payments are processed by Stripe. Advottic never sees your card data.{' '}
        <Link className="underline" href="/privacy">
          Privacy
        </Link>{' '}
        ·{' '}
        <Link className="underline" href="/terms">
          Terms
        </Link>
      </div>
    </div>
  );
}
