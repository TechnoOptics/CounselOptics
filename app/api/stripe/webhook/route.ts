import { NextResponse, type NextRequest } from 'next/server';
import type Stripe from 'stripe';
import {
  getStripe,
  getWebhookSecret,
  tierFromPriceId,
  tierSlugFromPriceId,
} from '@/lib/stripe';
import {
  upsertSubscriptionFromStripe,
  userIdForStripeCustomer,
  grantProMonthlyTokens,
  adjustTokens,
  type TokenLedgerReason,
} from '@/lib/storage';
import { grantTierMonthlyTokens } from '@/lib/token-economy';
import { applyMonthlyOverageDebit } from '@/lib/item-limits';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email';
import type { SubscriptionStatus, Tier } from '@/lib/types';

/**
 * Best-effort admin notification: pings contact@advottic.com (or
 * whatever ADMIN_NOTIFY_TO points at) when a real revenue event lands.
 * Failures are swallowed - this should never block a webhook 2xx.
 */
async function notifyAdminOfRevenue(input: {
  kind: 'subscription_created' | 'subscription_canceled' | 'topup_purchased';
  email: string | null;
  tierOrSize: string;
  amountCents: number | null;
  customerId: string | null;
  subscriptionId?: string | null;
  sessionId?: string | null;
}) {
  const to = process.env.ADMIN_NOTIFY_TO?.trim() || 'contact@advottic.com';
  const dollars = input.amountCents != null ? `$${(input.amountCents / 100).toFixed(2)}` : '?';
  const labelByKind: Record<typeof input.kind, string> = {
    subscription_created: '🎉 New subscription',
    subscription_canceled: '😟 Subscription canceled',
    topup_purchased: '💰 Token top-up purchased',
  };
  const subject = `[Advottic] ${labelByKind[input.kind]} - ${input.tierOrSize} (${dollars})`;
  const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif;padding:18px;color:#0f2d24;">
<h2 style="margin:0 0 8px;font-size:17px;">${labelByKind[input.kind]}</h2>
<p style="margin:0 0 14px;font-size:14px;color:#3f3f46;">Customer ${input.email ?? '(unknown email)'} · ${input.tierOrSize} · ${dollars}.</p>
<table style="font-size:12px;color:#52525b;border-collapse:collapse;">
  ${input.customerId ? `<tr><td style="padding:2px 8px 2px 0;">Stripe customer:</td><td style="font-family:monospace;">${input.customerId}</td></tr>` : ''}
  ${input.subscriptionId ? `<tr><td style="padding:2px 8px 2px 0;">Subscription:</td><td style="font-family:monospace;">${input.subscriptionId}</td></tr>` : ''}
  ${input.sessionId ? `<tr><td style="padding:2px 8px 2px 0;">Checkout session:</td><td style="font-family:monospace;">${input.sessionId}</td></tr>` : ''}
</table>
<p style="margin:14px 0 0;font-size:11px;color:#a1a1aa;">Auto-generated. View in Stripe: <a href="https://dashboard.stripe.com">dashboard.stripe.com</a></p>
</body></html>`;
  try {
    await sendEmail({ to, subject, html });
  } catch {
    // never block the webhook on a notification failure
  }
}

/**
 * Map a Stripe price ID → token top-up size. Reads the env vars set
 * by ops; returns null if the price isn't a recognized top-up.
 */
function topupForPriceId(priceId: string | null): {
  amount: number;
  reason: TokenLedgerReason;
} | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_TOPUP_SMALL?.trim()) {
    return { amount: 200_000, reason: 'topup_small' };
  }
  if (priceId === process.env.STRIPE_PRICE_TOPUP_MEDIUM?.trim()) {
    return { amount: 600_000, reason: 'topup_medium' };
  }
  if (priceId === process.env.STRIPE_PRICE_TOPUP_LARGE?.trim()) {
    return { amount: 1_500_000, reason: 'topup_large' };
  }
  return null;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** `current_period_end` lives on Subscription in older Stripe API versions and on
 * SubscriptionItem in newer ones. Read from whichever has it. */
function periodEndFromSub(sub: Stripe.Subscription): string | null {
  const onSub = (sub as unknown as { current_period_end?: number }).current_period_end;
  if (typeof onSub === 'number') return new Date(onSub * 1000).toISOString();
  const onItem = (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)
    ?.current_period_end;
  if (typeof onItem === 'number') return new Date(onItem * 1000).toISOString();
  return null;
}

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const secret = getWebhookSecret();
  if (!stripe || !secret) {
    return NextResponse.json({ error: 'Stripe not configured.' }, { status: 503 });
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header.' }, { status: 400 });
  }

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid signature.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId =
          (session.metadata?.supabase_user_id as string | undefined) ??
          (session.client_reference_id as string | undefined);
        const customerId =
          typeof session.customer === 'string' ? session.customer : session.customer?.id;
        const subscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;

        // Token top-up flow: a one-time payment (mode='payment').
        //
        // New path (preferred): /api/billing/topup-checkout sets
        //   metadata.product = 'token_topup'
        //   metadata.package_id = boost|boost_plus|power|mega
        //   metadata.user_id  = the buying user
        //   metadata.firm_id  = (optional) firm-pool target
        // We resolve the package + tokens from token-packages.ts so
        // a price-id swap can never grant the wrong amount, and we
        // credit the firm pool when firm_id is set.
        //
        // Legacy path: older topup-* SKUs without our metadata fall
        // through to the price-id map below for backwards compat.
        const sessionMeta = session.metadata ?? {};

        // Gift subscription path: a gifter paid for someone else.
        // metadata.product === 'gift_subscription' and metadata.gift_id
        // points to a pending_payment row we created in /api/gift/checkout.
        // We flip the row to paid_pending_claim, set paid_at +
        // payment_intent_id, then send the recipient their redemption
        // email so they can claim. The subscription itself does NOT
        // get attached to the gifter's account - it sits idle until
        // the recipient hits /gift/claim/[token].
        if (
          session.mode === 'payment' &&
          sessionMeta.product === 'gift_subscription' &&
          typeof sessionMeta.gift_id === 'string'
        ) {
          const { applyGiftPaid } = await import('@/lib/gift-server');
          await applyGiftPaid({
            giftId: sessionMeta.gift_id,
            paymentIntentId:
              typeof session.payment_intent === 'string'
                ? session.payment_intent
                : session.payment_intent?.id ?? null,
            stripeSessionId: session.id,
            amountCents: session.amount_total ?? null,
          });
          await notifyAdminOfRevenue({
            kind: 'subscription_created',
            email:
              session.customer_details?.email ?? session.customer_email ?? null,
            tierOrSize: `gift · ${sessionMeta.tier_slug ?? '?'} · ${sessionMeta.duration_months ?? '?'} mo`,
            amountCents: session.amount_total ?? null,
            customerId: customerId ?? null,
            sessionId: session.id,
          });
          break;
        }

        if (
          session.mode === 'payment' &&
          sessionMeta.product === 'token_topup' &&
          typeof sessionMeta.package_id === 'string'
        ) {
          const paymentIntentId =
            typeof session.payment_intent === 'string'
              ? session.payment_intent
              : session.payment_intent?.id ?? session.id;
          const { applyTopupPurchase } = await import('@/lib/token-economy');
          const result = await applyTopupPurchase({
            paymentIntentId,
            packageId: sessionMeta.package_id,
            userId: (sessionMeta.user_id as string | undefined) ?? userId ?? null,
            firmId: (sessionMeta.firm_id as string | undefined) ?? null,
            amountCents: session.amount_total ?? 0,
            currency: (session.currency ?? 'USD').toUpperCase(),
          });
          if (result.ok) {
            await notifyAdminOfRevenue({
              kind: 'topup_purchased',
              email:
                session.customer_details?.email ?? session.customer_email ?? null,
              tierOrSize: `${sessionMeta.package_id} (${(result.tokens / 1_000).toLocaleString()}k tokens${
                sessionMeta.firm_id ? ' - firm pool' : ''
              })`,
              amountCents: session.amount_total ?? null,
              customerId: customerId ?? null,
              sessionId: session.id,
            });
          }
          break;
        }

        if (userId && session.mode === 'payment') {
          const lineItems = await stripe.checkout.sessions.listLineItems(
            session.id,
            { limit: 1 },
          );
          const priceId = lineItems.data[0]?.price?.id ?? null;
          const topup = topupForPriceId(priceId);
          if (topup) {
            // Idempotency: Stripe is at-least-once and retries on any
            // non-2xx, so a redelivered checkout.session.completed for the
            // same purchase must not credit twice. This legacy path used
            // raw adjustTokens (a non-transactional read-add-write) with
            // no dedup. Claim the purchase by INSERTing a receipt row
            // first, keyed on the payment intent under the same UNIQUE
            // constraint the modern applyTopupPurchase path relies on; a
            // duplicate delivery 23505s and skips the credit.
            const admin = createAdminSupabase();
            const intentKey = String(
              (session.payment_intent as string | null) ?? session.id,
            );
            let alreadyApplied = false;
            if (admin) {
              const { error: claimErr } = await admin
                .from('token_topup_purchases')
                .insert({
                  stripe_payment_intent_id: intentKey,
                  package_id: `legacy:${priceId ?? 'unknown'}`,
                  tokens_granted: topup.amount,
                  amount_cents: session.amount_total ?? 0,
                  currency: (session.currency ?? 'usd').toUpperCase(),
                  user_id: userId,
                  firm_id: null,
                  status: 'succeeded',
                  succeeded_at: new Date().toISOString(),
                });
              if (claimErr) {
                if ((claimErr as { code?: string }).code === '23505') {
                  alreadyApplied = true; // duplicate delivery - do not re-credit
                } else {
                  // A real claim failure: rethrow so Stripe retries rather
                  // than silently crediting without a receipt.
                  throw claimErr;
                }
              }
            }
            if (!alreadyApplied) {
              await adjustTokens({
                userId,
                delta: topup.amount,
                reason: topup.reason,
                metadata: {
                  stripe_session_id: session.id,
                  price_id: priceId,
                },
              });
            }
            await notifyAdminOfRevenue({
              kind: 'topup_purchased',
              email: session.customer_details?.email ?? session.customer_email ?? null,
              tierOrSize: `${(topup.amount / 1000).toLocaleString()}k tokens`,
              amountCents: session.amount_total ?? null,
              customerId: customerId ?? null,
              sessionId: session.id,
            });
          }
          break;
        }

        if (userId && customerId) {
          let priceId: string | null = null;
          let status: SubscriptionStatus = 'active';
          let currentPeriodEnd: string | null = null;
          let cancelAtPeriodEnd = false;
          if (subscriptionId) {
            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            priceId = sub.items.data[0]?.price.id ?? null;
            status = (sub.status as SubscriptionStatus) ?? 'active';
            currentPeriodEnd = periodEndFromSub(sub);
            cancelAtPeriodEnd = sub.cancel_at_period_end;
          }
          await upsertSubscriptionFromStripe({
            userId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId ?? null,
            status,
            priceId,
            tier: tierFromPriceId(priceId),
            currentPeriodEnd,
            cancelAtPeriodEnd,
          });
          // Initial purchase: grant the first month of tokens. Resolve
          // the TierSlug (Personal Pro=500K, Plus=1.5M, Solo=2.5M) via the
          // tier-aware helper - mirroring the renewal path below - and fall
          // back to the legacy flat 1.5M grant ONLY for old subscriptions
          // whose price doesn't map to a new STRIPE_PRICE_* env. The old
          // code called grantProMonthlyTokens (1.5M) for anything mapping to
          // the coarse 'pro' Tier enum, which over-granted every new Personal
          // Pro signup 3x (1.5M instead of 500K); the correct 500K renewal
          // grant then skipped on matching period_end, so the 3x stuck.
          if (currentPeriodEnd) {
            const initialSlug = tierSlugFromPriceId(priceId);
            if (initialSlug && initialSlug !== 'free') {
              await grantTierMonthlyTokens({
                userId,
                tier: initialSlug,
                periodEnd: currentPeriodEnd,
              });
            } else if (tierFromPriceId(priceId) === 'pro') {
              await grantProMonthlyTokens({ userId, periodEnd: currentPeriodEnd });
            }
          }
          // Notify admin of the new subscription. Use the price's
          // unit amount when we have it, otherwise the session total
          // (which is 0 during a free trial - we still want the email
          // for visibility, with the trial flag in the subject).
          const tierLabel: Record<Tier, string> = {
            basic: 'Basic ($9/mo)',
            standard: 'Standard ($19/mo)',
            pro: 'Pro ($50/mo)',
          };
          const tier = tierFromPriceId(priceId) as Tier | null;
          await notifyAdminOfRevenue({
            kind: 'subscription_created',
            email: session.customer_details?.email ?? session.customer_email ?? null,
            tierOrSize: tier ? `${tierLabel[tier]}${status === 'trialing' ? ' · trial' : ''}` : 'unknown tier',
            amountCents: session.amount_total ?? null,
            customerId: customerId ?? null,
            subscriptionId: subscriptionId ?? null,
            sessionId: session.id,
          });
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId =
          typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        const userId =
          (sub.metadata?.supabase_user_id as string | undefined) ??
          (await userIdForStripeCustomer(customerId));
        if (userId) {
          const priceId = sub.items.data[0]?.price.id ?? null;
          const periodEnd = periodEndFromSub(sub);
          await upsertSubscriptionFromStripe({
            userId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: sub.id,
            status: sub.status as SubscriptionStatus,
            priceId,
            tier: tierFromPriceId(priceId),
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
          });
        }
        break;
      }
      // Renewals come in as invoice.payment_succeeded with billing_reason
      // = 'subscription_cycle'. Use this to:
      //   1. Debit any outstanding item-overage tokens from the previous
      //      period BEFORE applying the new grant (so the user feels the
      //      overage and either upgrades or buys a Boost pack).
      //   2. Apply the monthly token grant for the resolved tier.
      // Both helpers are idempotent per (userId, periodEnd); Stripe
      // retries on the same period are no-ops.
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const reason = (invoice as { billing_reason?: string }).billing_reason;
        if (reason !== 'subscription_cycle' && reason !== 'subscription_create') break;
        const subscriptionId = (invoice as { subscription?: string }).subscription;
        if (!subscriptionId) break;
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = sub.items.data[0]?.price.id ?? null;
        const customerId =
          typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        const userId =
          (sub.metadata?.supabase_user_id as string | undefined) ??
          (await userIdForStripeCustomer(customerId));
        if (!userId) break;
        const periodEnd = periodEndFromSub(sub);
        if (!periodEnd) break;

        // Resolve the TierSlug (broader than the legacy Tier enum).
        // Falls back to the legacy 'pro' grant if the new mapping
        // doesn't recognize the price (older subscriptions).
        const tierSlug = tierSlugFromPriceId(priceId);

        // Step 1: debit overage tokens (BEFORE the new grant). Order
        // matters: a user with 25 items on a 20-item plan owes the
        // overage on this period's renewal; applying the new grant
        // first would let them dodge by depleting it on Bella.
        if (tierSlug) {
          await applyMonthlyOverageDebit({ userId, tier: tierSlug, periodEnd });
        }

        // Step 2: apply the tier's monthly grant. The new tier-aware
        // helper covers every paid tier; legacy grantProMonthlyTokens
        // still runs for backward-compat on the 'pro' Tier value so
        // existing per-tenant code that watches that helper keeps
        // working until migrated.
        if (tierSlug && tierSlug !== 'free') {
          await grantTierMonthlyTokens({ userId, tier: tierSlug, periodEnd });
        } else if (tierFromPriceId(priceId) === 'pro') {
          // Legacy fallback: older subscriptions that don't match any
          // of the new STRIPE_PRICE_* env vars still get their grant.
          await grantProMonthlyTokens({ userId, periodEnd });
        }
        break;
      }
      default:
        // Ignore other events.
        break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unhandled webhook error.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
