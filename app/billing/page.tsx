import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getCurrentSubscription } from '@/lib/storage';
import { isStripeConfigured } from '@/lib/stripe';
import { BillingActions } from './billing-actions';

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

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <p className="eyebrow mb-2">Billing</p>
        <h1 className="text-3xl font-semibold tracking-tight text-forest-900">Subscription</h1>
        <p className="text-sm text-ink-600 mt-1">
          One simple plan: <strong>$100 / month</strong>. Full access to case files, AI review,
          defense planning, exhibit plans, PDF exports, and Bella.
        </p>
      </div>

      {searchParams?.success === '1' && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Subscription confirmed. Welcome aboard. It can take a moment for the status to refresh
          here while Stripe sends the confirmation event.
        </p>
      )}
      {searchParams?.canceled === '1' && (
        <p className="rounded-lg border border-ink-200 bg-ink-50 px-4 py-3 text-sm text-ink-700">
          Checkout canceled. You can subscribe whenever you're ready.
        </p>
      )}

      <div className="card p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow mb-1">Status</p>
            <span className={`badge ${STATUS_STYLES[status] || STATUS_STYLES.inactive}`}>
              {STATUS_LABEL[status] || status}
            </span>
          </div>
          {sub?.currentPeriodEnd && (
            <div className="text-right">
              <p className="eyebrow mb-1">
                {sub.cancelAtPeriodEnd ? 'Ends on' : 'Renews on'}
              </p>
              <p className="text-sm font-medium text-ink-900">
                {new Date(sub.currentPeriodEnd).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </p>
            </div>
          )}
        </div>

        {!stripeReady && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium mb-1">Stripe is not connected yet</p>
            <p className="leading-relaxed">
              Add <code className="font-mono">STRIPE_SECRET_KEY</code>,{' '}
              <code className="font-mono">STRIPE_MONTHLY_PRICE_ID</code>, and{' '}
              <code className="font-mono">STRIPE_WEBHOOK_SECRET</code> to your Vercel project to
              enable subscriptions. Step-by-step in{' '}
              <Link href="/setup-stripe" className="underline">
                the Stripe setup guide
              </Link>{' '}
              (or <code className="font-mono">SETUP.md</code> in the repo).
            </p>
          </div>
        )}

        <BillingActions
          stripeReady={stripeReady}
          isActive={isActive}
          hasCustomer={Boolean(sub?.stripeCustomerId)}
        />
      </div>

      <div className="text-xs text-ink-500 leading-relaxed">
        Payments are processed by Stripe. CounselOptics never sees your card data. You can manage
        or cancel your subscription at any time from this page once Stripe is connected.
      </div>
    </div>
  );
}
