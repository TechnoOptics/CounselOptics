'use server';

import { createAdminSupabase } from './supabase/admin';
import {
  MONTHLY_TOKEN_GRANT,
  FIRM_POOL_GRANT,
  ROLLOVER_MULTIPLIER,
  billableTokensFromUsage,
  type TierSlug,
} from './token-packages';

/**
 * Tier-aware Bella token economy. Sits next to the original
 * lib/storage.ts token helpers (which only knew about the legacy Pro
 * tier) and adds:
 *
 *   - Per-tier monthly grants (every paid tier gets one)
 *   - Roll-over with a 2x cap on user balances
 *   - Firm pools for multi-seat tiers (Small Firm, Growing,
 *     Enterprise) so a heavy partner doesn't get blocked while
 *     paralegals have unused tokens
 *   - Firm-aware debit: when called inside firm context, pull from
 *     the firm pool first, fall back to user balance
 *   - Anthropic-usage -> billable-token conversion via
 *     billableTokensFromUsage()
 *
 * The legacy helpers in lib/storage.ts stay in place so the existing
 * Stripe webhook + Bella integration keep working until we migrate
 * them to call into here. New code should prefer this module.
 */

// ===========================================================================
// Grants (subscription + firm pool)
// ===========================================================================

/**
 * Idempotent monthly grant. Call from the Stripe webhook on
 * `customer.subscription.created` and `invoice.payment_succeeded`
 * with the user's resolved tier slug + the new period_end.
 *
 * Same period_end + same user => no duplicate grant.
 */
export async function grantTierMonthlyTokens(input: {
  userId: string;
  tier: TierSlug;
  periodEnd: string;
}): Promise<{ granted: boolean; balance: number }> {
  const admin = createAdminSupabase();
  if (!admin) return { granted: false, balance: 0 };

  const grant = MONTHLY_TOKEN_GRANT[input.tier] ?? 0;
  if (grant <= 0) {
    return { granted: false, balance: 0 };
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('token_balance, token_quota_period_end')
    .eq('id', input.userId)
    .maybeSingle();
  const existing = (profile as {
    token_balance?: number;
    token_quota_period_end?: string;
  } | null) ?? { token_balance: 0 };

  if (existing.token_quota_period_end === input.periodEnd) {
    return { granted: false, balance: existing.token_balance ?? 0 };
  }

  // Roll-over with a hard cap. Prevents a dormant subscription
  // accumulating a year of grants the user can dump on a single
  // heavy session.
  const cap = grant * ROLLOVER_MULTIPLIER;
  const carryOver = Math.min(existing.token_balance ?? 0, cap - grant);
  const newBalance = Math.max(grant, grant + carryOver);

  await admin
    .from('profiles')
    .update({
      token_balance: newBalance,
      token_quota_period_end: input.periodEnd,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.userId);

  await admin.from('token_ledger').insert({
    user_id: input.userId,
    delta: grant,
    reason: 'pro_monthly_grant',
    balance_after: newBalance,
    metadata: { tier: input.tier, period_end: input.periodEnd },
  });

  return { granted: true, balance: newBalance };
}

/**
 * Idempotent firm-pool grant. Multi-seat tiers credit the firm
 * pool with seats * FIRM_POOL_GRANT[tier] on every renewal.
 *
 * Roll-over on the pool is more generous (3x cap) because firms
 * have lumpy usage - litigation weeks vs slow weeks - and pool
 * smoothing is the whole point.
 */
export async function grantFirmPoolTokens(input: {
  firmId: string;
  tier: TierSlug;
  seats: number;
  periodEnd: string;
}): Promise<{ granted: boolean; balance: number }> {
  const admin = createAdminSupabase();
  if (!admin) return { granted: false, balance: 0 };

  const perSeat = FIRM_POOL_GRANT[input.tier] ?? 0;
  if (perSeat <= 0 || input.seats <= 0) {
    return { granted: false, balance: 0 };
  }

  const { data: row } = await admin
    .from('firms')
    .select('token_pool_balance, token_pool_period_end')
    .eq('id', input.firmId)
    .maybeSingle();
  const existing = (row as {
    token_pool_balance?: number;
    token_pool_period_end?: string;
  } | null) ?? { token_pool_balance: 0 };

  if (existing.token_pool_period_end === input.periodEnd) {
    return { granted: false, balance: existing.token_pool_balance ?? 0 };
  }

  const newGrant = perSeat * input.seats;
  const cap = newGrant * 3;
  const carryOver = Math.min(existing.token_pool_balance ?? 0, cap - newGrant);
  const newBalance = Math.max(newGrant, newGrant + carryOver);

  await admin
    .from('firms')
    .update({
      token_pool_balance: newBalance,
      token_pool_period_end: input.periodEnd,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.firmId);

  await admin.from('token_ledger').insert({
    firm_id: input.firmId,
    delta: newGrant,
    reason: 'pro_monthly_grant',
    balance_after: newBalance,
    metadata: {
      tier: input.tier,
      seats: input.seats,
      per_seat_grant: perSeat,
      period_end: input.periodEnd,
    },
  });

  return { granted: true, balance: newBalance };
}

// ===========================================================================
// Debit (consumption)
// ===========================================================================

export type DebitContext = {
  userId: string;
  /** Optional firm context. When set, the firm pool is debited first. */
  firmId?: string | null;
  reason: 'bella' | 'legal_eye';
  metadata?: Record<string, unknown>;
};

/**
 * Debit `amount` Bella tokens against the user (or firm pool, if
 * the user is acting in firm context). Returns the new balances on
 * the channel that absorbed the debit.
 *
 * Strategy: when `firmId` is set, debit the firm pool down to zero
 * first; any remainder hits the personal balance. This keeps a
 * heavy-using attorney inside a small firm productive even after
 * their nominal share of the pool is gone.
 *
 * Each step calls a single atomic Postgres function (debit_firm_token_pool
 * / debit_user_token_balance, see supabase/fixes/2026-07-03-atomic-token-debits.sql)
 * that reads-under-lock, floors at 0, and writes in one statement - a
 * previous version did a separate SELECT then an unconditional UPDATE
 * from application code, which let two concurrent debits against the
 * same row both read the same starting balance and both "succeed".
 *
 * Floors at 0 on both sides - we never let a balance go negative.
 * Callers should check `getCombinedTokenBalance()` BEFORE the
 * Anthropic call and refuse the request if the combined balance is
 * below the expected cost.
 */
export async function debitTokens(
  ctx: DebitContext,
  amount: number,
): Promise<{
  ok: boolean;
  firmPoolBalance: number | null;
  userBalance: number;
  insufficient?: boolean;
}> {
  if (amount <= 0) {
    return { ok: true, firmPoolBalance: null, userBalance: 0 };
  }
  const admin = createAdminSupabase();
  if (!admin) {
    return { ok: false, firmPoolBalance: null, userBalance: 0 };
  }

  let remaining = Math.round(amount);
  let firmAfter: number | null = null;
  // Track what we actually took from each source so an insufficient
  // turn can be made all-or-nothing (refund the partial take below).
  let debitedFromFirm = 0;
  let debitedFromUser = 0;

  // Step 1: hit the firm pool first when applicable.
  if (ctx.firmId) {
    const { data: firmResult, error: firmErr } = await admin
      .rpc('debit_firm_token_pool', { p_firm_id: ctx.firmId, p_amount: remaining })
      .single();
    const { new_balance: newFirm, amount_debited: fromFirm } =
      (firmResult as { new_balance: number; amount_debited: number } | null) ?? {
        new_balance: 0,
        amount_debited: 0,
      };
    firmAfter = newFirm;
    if (!firmErr && fromFirm > 0) {
      remaining -= fromFirm;
      debitedFromFirm = fromFirm;
      await admin.from('token_ledger').insert({
        user_id: ctx.userId,
        firm_id: ctx.firmId,
        delta: -fromFirm,
        reason: ctx.reason,
        balance_after: newFirm,
        metadata: { ...(ctx.metadata ?? {}), source: 'firm_pool' },
      });
    }
  }

  // Step 2: hit the user balance for whatever is left. Skip the call
  // entirely (rather than pass p_amount=0) when the firm pool already
  // covered it - a no-op debit would still touch profiles.updated_at.
  let userAfter = 0;
  if (remaining > 0) {
    const { data: userResult, error: userErr } = await admin
      .rpc('debit_user_token_balance', { p_user_id: ctx.userId, p_amount: remaining })
      .single();
    const { new_balance, amount_debited: fromUser } =
      (userResult as { new_balance: number; amount_debited: number } | null) ?? {
        new_balance: 0,
        amount_debited: 0,
      };
    userAfter = new_balance;
    if (!userErr && fromUser > 0) {
      remaining -= fromUser;
      debitedFromUser = fromUser;
      await admin.from('token_ledger').insert({
        user_id: ctx.userId,
        firm_id: ctx.firmId ?? null,
        delta: -fromUser,
        reason: ctx.reason,
        balance_after: userAfter,
        metadata: { ...(ctx.metadata ?? {}), source: 'user_balance' },
      });
    }
  } else {
    const { data: profileRow } = await admin
      .from('profiles')
      .select('token_balance')
      .eq('id', ctx.userId)
      .maybeSingle();
    userAfter = (profileRow as { token_balance?: number } | null)?.token_balance ?? 0;
  }

  const insufficient = remaining > 0;

  // All-or-nothing: if the combined balance couldn't cover the turn but
  // we already took a partial amount (e.g. drained the firm pool, then
  // came up short on the personal balance under concurrency), put it
  // back. Otherwise the user is charged for a turn the app then refuses.
  if (insufficient && (debitedFromFirm > 0 || debitedFromUser > 0)) {
    const restored = await creditBack(
      admin,
      ctx,
      debitedFromFirm,
      debitedFromUser,
      `${ctx.reason}_refund_insufficient`,
    );
    if (restored.firmAfter !== null) firmAfter = restored.firmAfter;
    if (restored.userAfter !== null) userAfter = restored.userAfter;
  }

  return {
    ok: !insufficient,
    firmPoolBalance: firmAfter,
    userBalance: userAfter,
    insufficient,
  };
}

/**
 * Put tokens back into the firm pool and/or the user's balance, with a
 * matching positive `token_ledger` entry so the trail nets out. Uses
 * the atomic credit_* RPCs (FOR UPDATE), the mirror of the debit path.
 * Crediting a missing row is a no-op.
 */
async function creditBack(
  admin: NonNullable<ReturnType<typeof createAdminSupabase>>,
  ctx: DebitContext,
  toFirm: number,
  toUser: number,
  reason: string,
): Promise<{ firmAfter: number | null; userAfter: number | null }> {
  let firmAfter: number | null = null;
  let userAfter: number | null = null;
  if (ctx.firmId && toFirm > 0) {
    const { data } = await admin.rpc('credit_firm_token_pool', {
      p_firm_id: ctx.firmId,
      p_amount: toFirm,
    });
    firmAfter = typeof data === 'number' ? data : null;
    await admin.from('token_ledger').insert({
      user_id: ctx.userId,
      firm_id: ctx.firmId,
      delta: toFirm,
      reason,
      balance_after: firmAfter,
      metadata: { ...(ctx.metadata ?? {}), source: 'firm_pool', refund: true },
    });
  }
  if (toUser > 0) {
    const { data } = await admin.rpc('credit_user_token_balance', {
      p_user_id: ctx.userId,
      p_amount: toUser,
    });
    userAfter = typeof data === 'number' ? data : null;
    await admin.from('token_ledger').insert({
      user_id: ctx.userId,
      firm_id: ctx.firmId ?? null,
      delta: toUser,
      reason,
      balance_after: userAfter,
      metadata: { ...(ctx.metadata ?? {}), source: 'user_balance', refund: true },
    });
  }
  return { firmAfter, userAfter };
}

/**
 * Refund a previously-debited amount for a turn that failed AFTER the
 * debit (e.g. the Anthropic/Bella call threw or timed out). Refunds to
 * the firm pool first, then the user - the same precedence the debit
 * took, so tokens return roughly where they came from. `amount` is the
 * total to put back; callers that know the exact split can pass it.
 */
export async function refundTokens(
  ctx: DebitContext,
  amount: number,
  split?: { toFirm?: number; toUser?: number },
): Promise<{ firmPoolBalance: number | null; userBalance: number | null }> {
  const admin = createAdminSupabase();
  if (!admin || amount <= 0) {
    return { firmPoolBalance: null, userBalance: null };
  }
  const total = Math.round(amount);
  const toFirm = split?.toFirm != null ? Math.round(split.toFirm) : ctx.firmId ? total : 0;
  const toUser =
    split?.toUser != null ? Math.round(split.toUser) : Math.max(0, total - toFirm);
  const { firmAfter, userAfter } = await creditBack(
    admin,
    ctx,
    toFirm,
    toUser,
    `${ctx.reason}_refund`,
  );
  return { firmPoolBalance: firmAfter, userBalance: userAfter };
}

/**
 * Cheap pre-call probe. Returns the combined balance available to
 * the user (firm pool + personal). Bella should call this before
 * each turn and refuse + offer top-up if the balance is below the
 * expected cost.
 */
export async function getCombinedTokenBalance(input: {
  userId: string;
  firmId?: string | null;
}): Promise<{
  combined: number;
  firmPool: number | null;
  personal: number;
}> {
  const admin = createAdminSupabase();
  if (!admin) return { combined: 0, firmPool: null, personal: 0 };
  const [{ data: profile }, { data: firm }] = await Promise.all([
    admin
      .from('profiles')
      .select('token_balance')
      .eq('id', input.userId)
      .maybeSingle(),
    input.firmId
      ? admin
          .from('firms')
          .select('token_pool_balance')
          .eq('id', input.firmId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const personal =
    (profile as { token_balance?: number } | null)?.token_balance ?? 0;
  const firmPool = input.firmId
    ? (firm as { token_pool_balance?: number } | null)?.token_pool_balance ?? 0
    : null;
  return {
    combined: personal + (firmPool ?? 0),
    firmPool,
    personal,
  };
}

/**
 * Convenience: convert Anthropic usage to billable tokens, then
 * call debitTokens. Use this from Bella's post-turn metering hook.
 */
export async function debitFromAnthropicUsage(
  ctx: DebitContext,
  usage: {
    inputTokens: number;
    cachedInputTokens?: number;
    outputTokens: number;
  },
) {
  const billable = billableTokensFromUsage(usage);
  return await debitTokens(ctx, billable);
}

// ===========================================================================
// Top-up purchases
// ===========================================================================

/**
 * Stripe webhook hits this on `payment_intent.succeeded` for one of
 * our token-pack products. Idempotent on the payment intent id.
 *
 * The Stripe checkout session's metadata MUST carry `package_id`
 * (one of TOKEN_PACKAGES.id) plus either `user_id` or `firm_id`.
 * The handler reads the package definition out of token-packages.ts
 * to determine the credit amount, so we can never accidentally
 * grant more tokens than the user paid for.
 */
export async function applyTopupPurchase(input: {
  paymentIntentId: string;
  packageId: string;
  userId?: string | null;
  firmId?: string | null;
  amountCents: number;
  currency?: string;
}): Promise<{ ok: boolean; tokens: number; error?: string }> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, tokens: 0, error: 'admin client missing' };

  const { TOKEN_PACKAGES } = await import('./token-packages');
  const pack = TOKEN_PACKAGES.find((p) => p.id === input.packageId);
  if (!pack) return { ok: false, tokens: 0, error: `unknown package ${input.packageId}` };

  // Idempotency: CLAIM this payment intent by INSERTing the receipt row
  // first. UNIQUE(stripe_payment_intent_id) means a duplicate webhook
  // delivery (Stripe is at-least-once and retries on any non-2xx) loses
  // the race with a 23505 unique-violation, so only the FIRST delivery
  // falls through to credit the balance. This replaces a check-then-
  // upsert where two concurrent deliveries could both pass the SELECT
  // (neither seeing 'succeeded' yet) and double-credit the purchase.
  const { error: claimErr } = await admin.from('token_topup_purchases').insert({
    stripe_payment_intent_id: input.paymentIntentId,
    package_id: pack.id,
    tokens_granted: pack.tokens,
    amount_cents: input.amountCents,
    currency: input.currency ?? 'USD',
    user_id: input.userId ?? null,
    firm_id: input.firmId ?? null,
    status: 'succeeded',
    succeeded_at: new Date().toISOString(),
  });
  if (claimErr) {
    // Unique violation => this payment was already applied: idempotent
    // success, do NOT credit again. Any other error is a real failure.
    if ((claimErr as { code?: string }).code === '23505') {
      return { ok: true, tokens: pack.tokens };
    }
    return { ok: false, tokens: 0, error: claimErr.message };
  }

  // Credit the right pool. Firm > user when both are set. Only the first
  // (winning) delivery reaches here.
  if (input.firmId) {
    const { data: row } = await admin
      .from('firms')
      .select('token_pool_balance')
      .eq('id', input.firmId)
      .maybeSingle();
    const current =
      (row as { token_pool_balance?: number } | null)?.token_pool_balance ?? 0;
    const next = current + pack.tokens;
    await admin
      .from('firms')
      .update({ token_pool_balance: next, updated_at: new Date().toISOString() })
      .eq('id', input.firmId);
    await admin.from('token_ledger').insert({
      firm_id: input.firmId,
      user_id: input.userId ?? null,
      delta: pack.tokens,
      reason: `topup_${pack.id === 'boost_plus' ? 'medium' : pack.id === 'mega' || pack.id === 'power' ? 'large' : 'small'}`,
      balance_after: next,
      metadata: { package: pack.id, payment_intent: input.paymentIntentId },
    });
  } else if (input.userId) {
    const { data: row } = await admin
      .from('profiles')
      .select('token_balance')
      .eq('id', input.userId)
      .maybeSingle();
    const current =
      (row as { token_balance?: number } | null)?.token_balance ?? 0;
    const next = current + pack.tokens;
    await admin
      .from('profiles')
      .update({
        token_balance: next,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.userId);
    await admin.from('token_ledger').insert({
      user_id: input.userId,
      delta: pack.tokens,
      reason: `topup_${pack.id === 'boost_plus' ? 'medium' : pack.id === 'mega' || pack.id === 'power' ? 'large' : 'small'}`,
      balance_after: next,
      metadata: { package: pack.id, payment_intent: input.paymentIntentId },
    });
  } else {
    return { ok: false, tokens: 0, error: 'top-up has neither user_id nor firm_id' };
  }

  return { ok: true, tokens: pack.tokens };
}
