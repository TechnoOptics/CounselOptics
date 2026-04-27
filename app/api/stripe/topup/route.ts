import { NextResponse, type NextRequest } from 'next/server';
import { getStripe, isStripeConfigured } from '@/lib/stripe';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getCurrentSubscription, upsertSubscriptionFromStripe } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Pro-only one-time token top-up checkout. Body: { size: 'small'|'medium'|'large' }.
 * Returns a Stripe Checkout URL the client redirects to. The
 * checkout.session.completed webhook recognizes the price and credits
 * the user's token_balance.
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured() || !isStripeConfigured()) {
    return NextResponse.json({ error: 'Billing is not configured.' }, { status: 503 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: 'Stripe SDK unavailable.' }, { status: 503 });

  let body: { size?: string } = {};
  try {
    body = (await req.json()) as { size?: string };
  } catch {
    body = {};
  }
  const sizeMap: Record<string, string | undefined> = {
    small: process.env.STRIPE_PRICE_TOPUP_SMALL?.trim(),
    medium: process.env.STRIPE_PRICE_TOPUP_MEDIUM?.trim(),
    large: process.env.STRIPE_PRICE_TOPUP_LARGE?.trim(),
  };
  const priceId = body.size ? sizeMap[body.size] : undefined;
  if (!priceId) {
    return NextResponse.json(
      { error: 'Unknown top-up size. Expected small, medium, or large.' },
      { status: 400 },
    );
  }

  // Pro-only feature. Subscriptions table has the canonical tier.
  const existing = await getCurrentSubscription();
  if (existing?.tier !== 'pro') {
    return NextResponse.json(
      { error: 'Token top-ups are a Pro feature. Upgrade your subscription first.' },
      { status: 403 },
    );
  }

  // Reuse the Stripe customer if one exists; create otherwise.
  let customerId = existing?.stripeCustomerId ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    await upsertSubscriptionFromStripe({
      userId: user.id,
      stripeCustomerId: customerId,
      status: existing?.status ?? 'active',
      priceId: existing?.priceId ?? null,
    });
  }

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    req.headers.get('origin') ||
    `https://${req.headers.get('host')}`;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/billing?topup=success`,
    cancel_url: `${origin}/billing?topup=canceled`,
    client_reference_id: user.id,
    metadata: {
      supabase_user_id: user.id,
      topup_size: body.size ?? '',
    },
    payment_intent_data: {
      metadata: {
        supabase_user_id: user.id,
        topup_size: body.size ?? '',
      },
    },
  });

  return NextResponse.json({ url: session.url });
}
