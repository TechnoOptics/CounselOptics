import { NextResponse, type NextRequest } from 'next/server';
import { getStripe, isStripeConfigured } from '@/lib/stripe';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import {
  GIFT_TIERS,
  GIFT_DURATIONS,
  giftAmountCents,
  generateRedemptionToken,
  type GiftTierSlug,
  type GiftDuration,
} from '@/lib/gift';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/gift/checkout
 *
 * Creates a Stripe Checkout Session in 'payment' mode (one-time
 * charge, not a subscription) for a gifter buying Advottic for
 * someone else. The recipient does NOT have to have an Advottic
 * account at purchase time - we collect their name/email/phone and
 * send a redemption email once Stripe confirms payment via webhook.
 *
 * Auth: signed in or guest. If signed in, gifter_user_id is set so
 * the gifter can later look up gift status from their /gifts page.
 *
 * Stripe uses inline `price_data` (no pre-configured Price ID
 * required) so a new tier or duration combination is purely a
 * code/DB change; no Stripe-dashboard click for each new gift SKU.
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'Server is not configured.' },
      { status: 503 },
    );
  }
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: 'Stripe is not configured on the server.' },
      { status: 503 },
    );
  }

  // Body
  let body: {
    tier?: string;
    duration?: number;
    recipient_name?: string;
    recipient_email?: string;
    recipient_phone?: string;
    personal_note?: string;
    gifter_name?: string;
    gifter_email?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  // Validate tier + duration against the known lists. We narrow
  // both to non-optional before any downstream use.
  const tierRaw = body.tier;
  const tierSpec = GIFT_TIERS.find((t) => t.slug === tierRaw);
  if (!tierSpec) {
    return NextResponse.json({ error: 'Unknown tier.' }, { status: 400 });
  }
  const tier: GiftTierSlug = tierSpec.slug;
  const durationRaw = body.duration;
  const durationSpec = GIFT_DURATIONS.find((d) => d.months === durationRaw);
  if (!durationSpec) {
    return NextResponse.json({ error: 'Unsupported duration.' }, { status: 400 });
  }
  const duration: GiftDuration = durationSpec.months;

  // Required recipient fields.
  const recipientName = String(body.recipient_name ?? '').trim().slice(0, 120);
  if (recipientName.length === 0) {
    return NextResponse.json(
      { error: "Recipient's name is required." },
      { status: 400 },
    );
  }
  const recipientEmailRaw = String(body.recipient_email ?? '')
    .trim()
    .toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipientEmailRaw)) {
    return NextResponse.json(
      { error: "Enter a valid recipient email." },
      { status: 400 },
    );
  }
  const recipientEmail = recipientEmailRaw.slice(0, 254);
  const recipientPhoneRaw = String(body.recipient_phone ?? '').trim();
  const recipientPhone =
    recipientPhoneRaw.length > 0 &&
    /^\+[1-9]\d{1,14}$/.test(recipientPhoneRaw)
      ? recipientPhoneRaw
      : null;
  const personalNote = String(body.personal_note ?? '').trim().slice(0, 600) ||
    null;

  // Gifter context: prefer the signed-in user; fall back to guest
  // form fields. Either way we want at least an email so we can
  // confirm the purchase + provide a record for the gifter.
  const currentUser = await getCurrentUser().catch(() => null);
  const gifterUserId = currentUser?.id ?? null;
  const gifterEmail = (currentUser?.email ?? body.gifter_email ?? '')
    .toString()
    .trim()
    .toLowerCase()
    .slice(0, 254) || null;
  const gifterName = String(body.gifter_name ?? '').trim().slice(0, 120) ||
    (currentUser?.user_metadata?.full_name as string | undefined) ||
    null;
  if (!gifterUserId && !gifterEmail) {
    return NextResponse.json(
      { error: "Enter your email so we can confirm the purchase." },
      { status: 400 },
    );
  }

  const amountCents = giftAmountCents(tier, duration);
  const redemptionToken = generateRedemptionToken();

  // Insert the gift_subscriptions row first - if Stripe call fails
  // we still have an audit trail. status='pending_payment' so the
  // claim page rejects any premature redemption attempts.
  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: 'Server misconfigured.' },
      { status: 500 },
    );
  }
  const { data: row, error: insertErr } = await admin
    .from('gift_subscriptions')
    .insert({
      gifter_user_id: gifterUserId,
      gifter_email: gifterEmail,
      gifter_name: gifterName,
      recipient_name: recipientName,
      recipient_email: recipientEmail,
      recipient_phone: recipientPhone,
      personal_note: personalNote,
      tier_slug: tier,
      duration_months: duration,
      amount_cents: amountCents,
      currency: 'usd',
      status: 'pending_payment',
      redemption_token: redemptionToken,
    })
    .select('id')
    .single();
  if (insertErr || !row) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'Could not start gift.' },
      { status: 500 },
    );
  }
  const giftId = (row as { id: string }).id;

  // Stripe Checkout Session, payment mode, single line item with
  // inline price_data so we don't need a pre-configured Stripe
  // Price ID per (tier × duration) combo.
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: 'Stripe SDK unavailable.' },
      { status: 503 },
    );
  }
  const origin =
    req.headers.get('origin') ||
    `https://${req.headers.get('host')}` ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    'https://advottic.com';
  const productName = `Advottic gift - ${tierSpec.name}, ${duration} ${duration === 1 ? 'month' : 'months'}`;
  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: amountCents,
            product_data: {
              name: productName,
              description: `Gift for ${recipientName} (${recipientEmail}). Redeems for ${duration} ${duration === 1 ? 'month' : 'months'} of ${tierSpec.name}.`,
            },
          },
          quantity: 1,
        },
      ],
      // Collect the gifter's email at Stripe checkout if we don't
      // already have it; ensures we always have a way to contact
      // them about refunds, support, etc.
      customer_email: gifterEmail ?? undefined,
      success_url: `${origin}/gift/sent?id=${giftId}`,
      cancel_url: `${origin}/gift?canceled=1`,
      allow_promotion_codes: true,
      metadata: {
        product: 'gift_subscription',
        gift_id: giftId,
        tier_slug: tier,
        duration_months: String(duration),
        recipient_email: recipientEmail,
      },
    });
  } catch (e) {
    // Roll back the DB row so we don't leave orphaned pending_payment
    // rows on Stripe failures (rate limit, bad API key, etc.).
    await admin.from('gift_subscriptions').delete().eq('id', giftId);
    const msg = e instanceof Error ? e.message : 'Stripe error.';
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // Persist the Stripe session id so the webhook can match it back.
  await admin
    .from('gift_subscriptions')
    .update({ stripe_session_id: session.id })
    .eq('id', giftId);

  return NextResponse.json({ url: session.url, gift_id: giftId });
}
