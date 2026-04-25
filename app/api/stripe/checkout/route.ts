import { NextResponse, type NextRequest } from 'next/server';
import { getStripe, getMonthlyPriceId, isStripeConfigured } from '@/lib/stripe';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getCurrentSubscription, upsertSubscriptionFromStripe } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Auth is not configured.' }, { status: 503 });
  }
  if (!isStripeConfigured()) {
    return NextResponse.json(
      {
        error:
          'Stripe is not configured on the server. Set STRIPE_SECRET_KEY and STRIPE_MONTHLY_PRICE_ID.',
      },
      { status: 503 },
    );
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: 'Stripe SDK unavailable.' }, { status: 503 });

  const priceId = getMonthlyPriceId()!;

  // Get or create a Stripe customer; persist the customer id on the subscription row.
  const existing = await getCurrentSubscription();
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
      status: existing?.status ?? 'inactive',
      priceId: existing?.priceId ?? null,
    });
  }

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    req.headers.get('origin') ||
    `https://${req.headers.get('host')}`;

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/billing?success=1`,
    cancel_url: `${origin}/billing?canceled=1`,
    allow_promotion_codes: true,
    client_reference_id: user.id,
    metadata: { supabase_user_id: user.id },
    subscription_data: {
      metadata: { supabase_user_id: user.id },
    },
  });

  return NextResponse.json({ url: session.url });
}
