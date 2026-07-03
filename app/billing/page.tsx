import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { nativePlatformFromUserAgent } from '@/lib/platform';
import {
  getCurrentSubscription,
  getProfile,
  getTokenBalance,
  listTokenLedger,
  PRO_MONTHLY_TOKEN_GRANT,
  type TokenLedgerReason,
} from '@/lib/storage';
import { isStripeConfigured } from '@/lib/stripe';
import { TIER_FEATURES, TIER_LABEL, type Tier } from '@/lib/types';
import { TierCard } from './tier-card';
import { ManageButton } from './billing-actions';
import { TopUpButtons } from './topup-buttons';
import { RestorePurchases } from '@/components/RestorePurchases';
import { countItemsForUser, calculateOverage } from '@/lib/item-limits';
import { type TierSlug } from '@/lib/token-packages';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Billing',
  description:
    'Manage your Advottic subscription, top up Bella tokens, and review recent usage.',
  alternates: { canonical: '/billing' },
  robots: { index: false, follow: false },
};

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
  searchParams?: { success?: string; canceled?: string; topup?: string; gate?: string };
}) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="max-w-xl mx-auto card p-8 space-y-3">
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">Billing</h1>
        <p className="text-sm text-ink-600">
          Auth is not configured yet. Follow <code>SETUP.md</code>.
        </p>
      </div>
    );
  }

  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/billing');

  // Consent is handled by the layout's popup modal; no redirect needed here.

  const sub = await getCurrentSubscription();
  const stripeReady = isStripeConfigured();
  // Deterministic, server-side "is this the iOS app" signal for the
  // IAP-vs-Stripe branch below - see the note on TierCard's
  // `serverPlatform` prop for why this replaces relying solely on the
  // client-side window.Capacitor bridge check.
  const serverPlatform = nativePlatformFromUserAgent(headers().get('user-agent'));
  const rawStatus = sub?.status ?? 'inactive';
  const currentTier: Tier | null = sub?.tier ?? null;

  // Real-time gate. If the Stripe row still says "trialing" or "active"
  // but the currentPeriodEnd is already in the past, treat the
  // subscription as expired so the page never shows "trial in progress"
  // a week after the period actually ended. Stripe's webhook for
  // subscription.deleted / customer.subscription.updated sometimes lags
  // or fails; the local clock is the source of truth for the user.
  const periodEnd = sub?.currentPeriodEnd ? Date.parse(sub.currentPeriodEnd) : null;
  const isPeriodPast = periodEnd !== null && periodEnd < Date.now();
  const status =
    (rawStatus === 'trialing' || rawStatus === 'active') && isPeriodPast
      ? 'inactive'
      : rawStatus;
  const isActive = status === 'active' || status === 'trialing';

  // Pro tier: pull token balance + recent ledger so we can render the
  // gauge + history below the plan cards.
  const isPro = currentTier === 'pro' && isActive;
  const tokens = isPro ? await getTokenBalance() : null;
  const ledger = isPro ? await listTokenLedger({ limit: 10 }) : [];

  // Items-used gauge data. Renders for every signed-in user, with a
  // tier-aware cap. Legacy Tier values (basic/standard/pro) map 1:1
  // onto TierSlug; Free users get the 1-item floor. The overage state
  // tells the gauge how to color the bar (green / amber approaching /
  // rose over).
  const itemCount = await countItemsForUser(user.id);
  const effectiveTierSlug: TierSlug = isActive && currentTier
    ? (currentTier as TierSlug)
    : 'free';
  const overage = calculateOverage(itemCount.total, effectiveTierSlug);

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-fade-up">
      <div>
        <p className="eyebrow mb-2">Billing</p>
        <h1 className="font-display text-[40px] sm:text-[48px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          {status === 'active'
            ? `You're on ${currentTier ? TIER_LABEL[currentTier] : 'an Advottic'} plan`
            : status === 'trialing'
              ? `${currentTier ? TIER_LABEL[currentTier] : 'Your'} trial is in progress`
              : 'Choose your tier'}
        </h1>
        <p className="text-sm text-ink-600 mt-1 max-w-2xl">
          {status === 'active'
            ? 'Manage your billing, top up tokens, or switch tiers from the customer portal.'
            : 'Three tiers, monthly billing, 7-day free trial for first-time subscribers. Cancel any time.'}
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
      {searchParams?.topup === 'success' && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Top-up confirmed. Your tokens will appear on the gauge below within a few seconds.
        </p>
      )}
      {searchParams?.topup === 'canceled' && (
        <p className="rounded-lg border border-ink-200 bg-ink-50 px-4 py-3 text-sm text-ink-700">
          Top-up canceled. No charge has been made.
        </p>
      )}
      {/* Auto-surface a "trial ended" notice when the Stripe row still
          reads trialing/active but the local clock says the period is
          past. Avoid double-rendering when ?gate=trial-ended is already
          present in the URL. */}
      {isPeriodPast &&
        rawStatus !== 'active' &&
        rawStatus !== 'inactive' &&
        searchParams?.gate !== 'trial-ended' && (
          <p className="rounded-lg border border-gold-300/50 bg-cream-50 px-4 py-3 text-sm text-forest-900">
            <strong>Your trial has ended.</strong> Subscribe below to keep creating cases and
            using Bella + Advottic Review. You can still view your existing cases and look up
            counsel without a subscription.
          </p>
        )}
      {/* The ?gate=file-exhibits and ?gate=public-defender URL params
          are kept for backward compatibility with old bookmarks - we
          render a friendly redirect notice rather than a paywall, since
          both directories are now free across every tier. */}
      {searchParams?.gate === 'trial-ended' && (
        <p className="rounded-lg border border-gold-300/50 bg-cream-50 px-4 py-3 text-sm text-forest-900 leading-relaxed">
          <strong>Your trial has ended.</strong> Subscribe below to keep creating cases and
          using Bella + Advottic Review. You can still view your existing cases and look up
          counsel without a subscription.
        </p>
      )}
      {(searchParams?.gate === 'file-exhibits' ||
        searchParams?.gate === 'public-defender') && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 leading-relaxed">
          Good news: the{' '}
          <strong className="inline font-semibold">
            {searchParams.gate === 'file-exhibits'
              ? 'Court e-filing directory'
              : 'Public defender directory'}
          </strong>{' '}
          is now free for everyone, no subscription required.{' '}
          <Link
            href={searchParams.gate === 'file-exhibits' ? '/file-exhibits' : '/public-defender'}
            className="underline font-medium"
          >
            Open the directory &rarr;
          </Link>
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
              {isPeriodPast
                ? 'Expired on'
                : sub.cancelAtPeriodEnd
                  ? 'Ends on'
                  : 'Renews on'}{' '}
              {new Date(sub.currentPeriodEnd).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </p>
          )}
        </div>
        {isActive && (
          // The Stripe customer portal is irrelevant to an Apple IAP
          // subscriber (they manage in Settings -> Apple ID), so hide it
          // inside the iOS app; the Restore card below covers iOS.
          <span data-hide-on-ios>
            <ManageButton
              stripeReady={stripeReady}
              hasCustomer={Boolean(sub?.stripeCustomerId)}
            />
          </span>
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

      {/* Audit CR-49: previously the Top-up section lived deep in the
          page and only rendered for Pro users. Free-tier users had no
          discoverable path to top-up - they had to upgrade first to
          even see the affordance. This row surfaces it near the top:
          Pro users jump to the top-up panel via #topup; free-tier
          users see an upgrade nudge that explains what top-ups are
          for. The Pro path lives inside the section below; this is
          just navigation. */}
      <div data-hide-on-ios className="flex flex-wrap items-baseline justify-between gap-3 rounded-2xl border border-gold-300/40 bg-gradient-to-br from-cream-50 to-white dark:from-forest-900 dark:to-forest-950 p-4 sm:p-5 ring-1 ring-gold-400/20">
        <div className="min-w-0">
          <p className="eyebrow mb-1 text-gold-700 dark:text-gold-300">
            Tokens
          </p>
          <p className="text-[13px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
            Bella runs on tokens. Active subscribers get a monthly grant; you can
            add more any time with a one-off top-up.
          </p>
        </div>
        {isPro ? (
          <a
            href="#topup"
            className="btn-primary text-[13px] px-3.5 py-2 whitespace-nowrap"
          >
            Top up tokens →
          </a>
        ) : (
          <a
            href="#tiers"
            className="btn-secondary text-[13px] px-3.5 py-2 whitespace-nowrap"
          >
            Upgrade to enable top-ups
          </a>
        )}
      </div>

      {/* Three tier cards */}
      <div id="tiers" className="grid gap-4 md:grid-cols-3 items-stretch stagger scroll-mt-20">
        {TIER_ORDER.map((t) => (
          <TierCard
            key={t}
            tier={t}
            currentTier={currentTier}
            isActive={isActive}
            stripeReady={stripeReady}
            serverPlatform={serverPlatform}
          />
        ))}
      </div>

      {/* iOS-only: Apple-required Restore Purchases + a note that the
          subscription is billed/managed through the Apple ID. Renders
          null on web/Android (those use the Stripe portal above). */}
      <RestorePurchases userId={user.id} serverPlatform={serverPlatform} />

      {/* Items-used gauge. Shows for every signed-in user; surfaces
          how close the account is to the tier cap and (when over) how
          many tokens the next monthly cycle will debit as overage. */}
      <ItemsGauge
        count={itemCount}
        itemLimit={overage.itemLimit}
        overage={overage.overage}
        monthlyOverageTokens={overage.monthlyOverageTokens}
        isApproaching={overage.isApproaching}
        isOver={overage.isOver}
      />

      {/* Pro-only token gauge + top-up + ledger. Renders only when the
          user is on an active Pro subscription, since lower tiers do
          not meter and visitors of higher tiers should never see the
          empty version of this card. */}
      {isPro && tokens && (
        <section id="topup" className="space-y-5 scroll-mt-20">
          <TokenGauge balance={tokens.balance} />
          <TopUpButtons />
          {ledger.length > 0 && (
            <TokenLedgerCard rows={ledger} />
          )}
        </section>
      )}

      <div className="text-xs text-ink-500 leading-relaxed">
        {/* The Stripe line is accurate on web/Android but false and
            disallowed inside the iOS app (Apple IAP, no external
            processor references - Guideline 3.1.1), so it is hidden on
            iOS. The Terms of Use (EULA) + Privacy Policy links stay
            visible everywhere so the iOS paywall meets 3.1.2. */}
        <span data-hide-on-ios>
          Payments are processed by Stripe. Advottic never sees your card data.{' '}
        </span>
        <Link className="underline" href="/privacy">
          Privacy Policy
        </Link>{' '}
        ·{' '}
        <Link className="underline" href="/terms">
          Terms of Use (EULA)
        </Link>
      </div>
    </div>
  );
}

const REASON_LABEL: Record<TokenLedgerReason, string> = {
  pro_monthly_grant: 'Monthly Pro grant',
  topup_small: 'Top-up · 200k',
  topup_medium: 'Top-up · 600k',
  topup_large: 'Top-up · 1.5M',
  bella: 'Bella conversation',
  legal_eye: 'Advottic Review',
  admin_adjust: 'Admin adjustment',
  item_overage_debit: 'Items past plan cap',
};

/**
 * Items-used gauge. Renders for every signed-in user on /billing.
 * Communicates three states:
 *   - Under cap (green): you're within your plan
 *   - Approaching (amber): >= 80% used; heads-up to think about upgrade
 *   - Over cap (rose): each extra item debits tokens monthly
 *
 * Uncapped Enterprise customers see a simple "Items used" total with
 * no bar (no cap to fill against).
 */
function ItemsGauge({
  count,
  itemLimit,
  overage,
  monthlyOverageTokens,
  isApproaching,
  isOver,
}: {
  count: { cases: number; contracts: number; total: number };
  itemLimit: number | null;
  overage: number;
  monthlyOverageTokens: number;
  isApproaching: boolean;
  isOver: boolean;
}) {
  const pct = itemLimit && itemLimit > 0
    ? Math.min(100, (count.total / itemLimit) * 100)
    : 0;
  const barTone = isOver
    ? 'bg-gradient-to-r from-rose-500 via-rose-600 to-rose-700'
    : isApproaching
      ? 'bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700'
      : 'bg-gradient-to-r from-emerald-500 via-emerald-600 to-forest-700';
  return (
    <section className="card p-6 sm:p-7 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="eyebrow">Items used</p>
          <h2 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 mt-1">
            {count.total.toLocaleString()}
            {itemLimit !== null && (
              <span className="text-base text-ink-500 dark:text-cream-100/55 font-sans font-normal">
                {' '}of {itemLimit.toLocaleString()}{' '}
                items
              </span>
            )}
            {itemLimit === null && (
              <span className="text-base text-ink-500 dark:text-cream-100/55 font-sans font-normal">
                {' '}items (uncapped)
              </span>
            )}
          </h2>
        </div>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55">
          {count.cases} case{count.cases === 1 ? '' : 's'} ·{' '}
          {count.contracts} contract{count.contracts === 1 ? '' : 's'}
        </p>
      </div>
      {itemLimit !== null && (
        <div
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Items used out of plan limit"
          className="relative h-3 w-full rounded-full bg-ink-100 dark:bg-forest-800/60 overflow-hidden"
        >
          <span
            className={`absolute inset-y-0 left-0 ${barTone}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {isOver && (
        <div className="space-y-2">
          <p className="text-[12.5px] text-rose-800 dark:text-rose-200 leading-relaxed">
            You&rsquo;re <strong>{overage}</strong> item
            {overage === 1 ? '' : 's'} past your plan limit. The next billing
            cycle will deduct about{' '}
            <strong>{monthlyOverageTokens.toLocaleString()}</strong> tokens
            from your monthly grant.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href="#topup"
              className="inline-flex items-center gap-1 rounded-md bg-gold-metal text-forest-950 px-3 py-1.5 text-[12px] font-semibold hover:brightness-110"
            >
              Buy a Boost pack &rarr;
            </a>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-900/40 px-3 py-1.5 text-[12px] font-medium text-forest-900 dark:text-cream-100 hover:bg-cream-50 dark:hover:bg-forest-800/60"
            >
              Compare tiers
            </Link>
          </div>
        </div>
      )}
      {isApproaching && !isOver && (
        <p className="text-[12.5px] text-amber-900 dark:text-amber-200 leading-relaxed">
          Heads up &mdash; you&rsquo;re close to your plan&rsquo;s item limit.
          Items past the cap will start charging from your Bella token balance
          at month-end. Consider upgrading if you&rsquo;ll keep growing.
        </p>
      )}
      {!isOver && !isApproaching && itemLimit !== null && (
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
          One item = one case, one contract, or one vault folder. Past the cap,
          extras are metered against your monthly Bella tokens.
        </p>
      )}
    </section>
  );
}

function TokenGauge({ balance }: { balance: number }) {
  const monthly = PRO_MONTHLY_TOKEN_GRANT;
  // Cap the visual fill at the monthly grant. Top-ups can push the
  // balance above 100% which we render as a gold "extra" sliver.
  const monthlyPct = Math.min(100, (Math.min(balance, monthly) / monthly) * 100);
  const extra = Math.max(0, balance - monthly);
  return (
    <div className="card p-6 sm:p-7 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="eyebrow">Pro tokens</p>
          <h2 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 mt-1">
            {balance.toLocaleString()} <span className="text-base text-ink-500 dark:text-cream-100/55 font-sans font-normal">tokens left this period</span>
          </h2>
        </div>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55">
          Monthly grant: {monthly.toLocaleString()}
        </p>
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(monthlyPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Pro monthly token usage"
        className="relative h-3 w-full rounded-full bg-ink-100 dark:bg-forest-800/60 overflow-hidden"
      >
        <span
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-forest-700 via-forest-800 to-forest-900"
          style={{ width: `${monthlyPct}%` }}
        />
        {extra > 0 && (
          <span
            aria-hidden
            className="absolute inset-y-0 right-0 bg-gradient-to-l from-gold-400 to-gold-500"
            style={{ width: `${Math.min(100, (extra / monthly) * 50)}%` }}
          />
        )}
      </div>
      <p className="text-[12px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
        Tokens are spent each time Bella replies or Advottic Review runs a review. Heavy users can
        top up below at any time - top-ups don&apos;t expire.
      </p>
    </div>
  );
}

function TokenLedgerCard({
  rows,
}: {
  rows: { id: string; occurredAt: string; delta: number; reason: TokenLedgerReason; balanceAfter: number | null }[];
}) {
  return (
    <div className="card p-5 sm:p-6">
      <p className="eyebrow mb-3">Recent activity</p>
      <ul className="divide-y divide-ink-100 dark:divide-forest-700/40">
        {rows.map((r) => (
          <li key={r.id} className="flex items-baseline justify-between py-2 gap-3">
            <div className="min-w-0">
              <p className="text-sm text-ink-900 dark:text-cream-100">
                {REASON_LABEL[r.reason] ?? r.reason}
              </p>
              <p className="text-[11px] text-ink-500 dark:text-cream-100/55">
                {new Date(r.occurredAt).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </p>
            </div>
            <div className="text-right tabular-nums">
              <p
                className={`text-sm font-medium ${
                  r.delta >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-ink-700 dark:text-cream-100/85'
                }`}
              >
                {r.delta >= 0 ? '+' : ''}
                {r.delta.toLocaleString()}
              </p>
              {r.balanceAfter !== null && (
                <p className="text-[11px] text-ink-500 dark:text-cream-100/55">
                  bal. {r.balanceAfter.toLocaleString()}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
