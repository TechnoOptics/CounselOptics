'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { expiryFromNow, type GiftDuration } from '@/lib/gift';

/**
 * Activate a gift on the signed-in user's account.
 *
 * Idempotent-ish: a second activation by the same user returns ok
 * (the row is already claimed); a different user trying to claim a
 * gift that someone else already activated returns an error.
 *
 * What "activate" means concretely:
 *   1. Bump the gift_subscriptions row to status='claimed' with
 *      claimed_by_user_id + claimed_at + expires_at populated.
 *   2. Upsert a public.subscriptions row giving the recipient the
 *      tier they were gifted. We use 'active' status and set
 *      current_period_end to expires_at so the existing entitlement
 *      checks elsewhere in the app naturally honor the gift window
 *      without any special-cased gift handling.
 *
 * If the existing subscriptions row already has a paid
 * Stripe subscription, we DON'T overwrite it - instead we extend
 * its expiration by duration_months on top of whatever current_
 * period_end already says. That way someone with an existing Pro
 * subscription who receives an additional 3-month gift gets 3
 * extra months on top.
 */
export async function claimGiftAction(
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) {
    return { ok: false, error: 'Invalid redemption link.' };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: 'Sign in to claim this gift.' };
  }
  const admin = createAdminSupabase();
  if (!admin) {
    return { ok: false, error: 'Server misconfigured.' };
  }

  const { data: row, error: lookupErr } = await admin
    .from('gift_subscriptions')
    .select('id, status, tier_slug, duration_months, claimed_by_user_id')
    .eq('redemption_token', token)
    .maybeSingle();
  if (lookupErr || !row) {
    return { ok: false, error: 'This gift does not exist or has been removed.' };
  }
  const gift = row as {
    id: string;
    status: string;
    tier_slug: string;
    duration_months: GiftDuration;
    claimed_by_user_id: string | null;
  };

  if (gift.status === 'claimed') {
    // Already claimed - either by this same user (idempotent re-
    // click) or by someone else (collision). We accept the no-op for
    // the same user; reject for a different one.
    if (gift.claimed_by_user_id === user.id) return { ok: true };
    return {
      ok: false,
      error: 'This gift was already claimed by another account.',
    };
  }
  if (gift.status === 'refunded') {
    return { ok: false, error: 'This gift was refunded.' };
  }
  if (gift.status === 'expired') {
    return { ok: false, error: 'This gift has expired.' };
  }
  if (gift.status !== 'paid_pending_claim') {
    return {
      ok: false,
      error:
        'This gift is not ready to claim yet. Try again in a minute, or contact support.',
    };
  }

  // Compute the new expiry. If the user already has an active
  // subscription with a future current_period_end, stack the gift
  // duration on top of that. Otherwise it's duration_months from
  // now.
  const now = new Date();
  const { data: existingSub } = await admin
    .from('subscriptions')
    .select('current_period_end, stripe_customer_id, stripe_subscription_id, price_id, status')
    .eq('user_id', user.id)
    .maybeSingle();
  const existingEndRaw = (existingSub as { current_period_end: string | null } | null)
    ?.current_period_end;
  const baseDate =
    existingEndRaw && new Date(existingEndRaw) > now
      ? new Date(existingEndRaw)
      : now;
  const newExpiry = new Date(baseDate);
  newExpiry.setMonth(newExpiry.getMonth() + gift.duration_months);

  // Upsert the subscription. We map gift's richer tier_slug to the
  // legacy Tier value the existing storage helpers expect. The
  // 'pro' value entitles all paid features in the current
  // entitlement check.
  const tierLegacy = 'pro';
  const existing = existingSub as {
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    price_id: string | null;
    status: string | null;
  } | null;
  const { error: subErr } = await admin
    .from('subscriptions')
    .upsert(
      {
        user_id: user.id,
        status: 'active',
        tier: tierLegacy,
        current_period_end: newExpiry.toISOString(),
        cancel_at_period_end: true,
        // Preserve any existing Stripe linkage so if they later
        // start a paid sub the customer record is reused.
        stripe_customer_id: existing?.stripe_customer_id ?? null,
        stripe_subscription_id: existing?.stripe_subscription_id ?? null,
        price_id: existing?.price_id ?? null,
        updated_at: now.toISOString(),
      },
      { onConflict: 'user_id' },
    );
  if (subErr) {
    return { ok: false, error: subErr.message };
  }

  // Mark the gift row claimed. Best-effort: even if this update
  // fails the subscription is already live; we'll log + ignore.
  await admin
    .from('gift_subscriptions')
    .update({
      status: 'claimed',
      claimed_at: now.toISOString(),
      claimed_by_user_id: user.id,
      expires_at: newExpiry.toISOString(),
    })
    .eq('id', gift.id);

  revalidatePath(`/gift/claim/${token}`);
  revalidatePath('/billing');
  revalidatePath('/cases');
  return { ok: true };
}
