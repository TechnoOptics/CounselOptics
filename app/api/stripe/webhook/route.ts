import { NextResponse, type NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { getStripe, getWebhookSecret, tierFromPriceId } from '@/lib/stripe';
import {
  upsertSubscriptionFromStripe,
  userIdForStripeCustomer,
} from '@/lib/storage';
import type { SubscriptionStatus } from '@/lib/types';

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
          await upsertSubscriptionFromStripe({
            userId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: sub.id,
            status: sub.status as SubscriptionStatus,
            priceId,
            tier: tierFromPriceId(priceId),
            currentPeriodEnd: periodEndFromSub(sub),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
          });
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
