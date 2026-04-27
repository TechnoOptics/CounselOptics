import { NextResponse, type NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { getStripe, getWebhookSecret, tierFromPriceId } from '@/lib/stripe';
import {
  upsertSubscriptionFromStripe,
  userIdForStripeCustomer,
  grantProMonthlyTokens,
  adjustTokens,
  type TokenLedgerReason,
} from '@/lib/storage';
import type { SubscriptionStatus } from '@/lib/types';

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

        // Token top-up flow: a one-time payment (mode='payment') with no
        // subscription. We pull the price ID from line items and credit
        // the user's token balance. Top-ups also pass `topup_size` in
        // metadata as a belt-and-suspenders signal in case the price map
        // gets out of sync with env vars.
        if (userId && session.mode === 'payment') {
          const lineItems = await stripe.checkout.sessions.listLineItems(
            session.id,
            { limit: 1 },
          );
          const priceId = lineItems.data[0]?.price?.id ?? null;
          const topup = topupForPriceId(priceId);
          if (topup) {
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
          // Pro initial purchase: grant the first month of tokens.
          if (tierFromPriceId(priceId) === 'pro' && currentPeriodEnd) {
            await grantProMonthlyTokens({ userId, periodEnd: currentPeriodEnd });
          }
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
      // = 'subscription_cycle'. Use this to re-grant Pro tokens once
      // per billing period; the grant helper is idempotent per period.
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const reason = (invoice as { billing_reason?: string }).billing_reason;
        if (reason !== 'subscription_cycle' && reason !== 'subscription_create') break;
        const subscriptionId = (invoice as { subscription?: string }).subscription;
        if (!subscriptionId) break;
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = sub.items.data[0]?.price.id ?? null;
        if (tierFromPriceId(priceId) !== 'pro') break;
        const customerId =
          typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        const userId =
          (sub.metadata?.supabase_user_id as string | undefined) ??
          (await userIdForStripeCustomer(customerId));
        if (!userId) break;
        const periodEnd = periodEndFromSub(sub);
        if (periodEnd) {
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
