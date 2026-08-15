// NOT `'use server'`. Every export of a 'use server' module is a public HTTP
// endpoint, and every function here takes the identity it acts on from its own
// arguments and writes through the service-role client with no caller
// authentication: applyTopupPurchase credits a paid token pack, debitTokens can
// empty any user's balance or any firm's pool. This module has only server-side
// importers (the Stripe webhook, the IAP entitlement helper, the token-balance
// route and Bella's metering hook) and was never meant to be an action
// boundary. `server-only` both removes the endpoints and turns any future
// client import into a build error instead of a silent exposure.
// Guarded by tests/token-economy-not-an-action.test.ts.
import 'server-only';

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
// Credit-write verification
// ===========================================================================

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabase>>;

/**
 * Classify a balance write that a token_ledger row is about to assert.
 *
 * PostgREST answers a statement that matched no row with an empty row set and
 * no error, and supabase-js resolves with `{ error }` rather than throwing on a
 * real failure. An unread result therefore cannot tell a credit apart from a
 * dropped one, which is why every paid credit below asks for `.select('id')`
 * and passes the result through here.
 *
 * `landed` is true only when a row came back. `provablyAbsent` separates the
 * statement that ran and matched nothing, where nothing was written and a retry
 * is definitely safe, from an error, where the write may or may not have been
 * applied and only the caller knows whether a retry could double-credit.
 */
function classifyCreditWrite(res: { data: unknown[] | null; error: unknown }): {
  landed: boolean;
  provablyAbsent: boolean;
} {
  if (!res.error && res.data && res.data.length > 0) {
    return { landed: true, provablyAbsent: false };
  }
  return { landed: false, provablyAbsent: !res.error };
}

/**
 * Delete an insert-first idempotency claim whose credit did not land, so the
 * next delivery can try again instead of taking the duplicate-key branch and
 * reporting success for tokens that were never issued. Callers must have
 * established that re-running the credit cannot double-credit.
 *
 * A failed release puts us back in the state this whole guard exists to
 * prevent, so it is reported rather than swallowed.
 */
async function releaseClaim(
  admin: AdminClient,
  table: string,
  match: Record<string, string>,
  context: string,
): Promise<void> {
  const { error } = await admin.from(table).delete().match(match);
  if (error) {
    console.error(
      `[tokens] ${context}: could not release the ${table} claim (${
        (error as { message?: string }).message ?? 'unknown error'
      }); this delivery stays blocked until the row is removed by hand`,
    );
  }
}

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

  // Fast path / migration guard. If this period was already granted (tracked
  // on the profile, incl. grants made before the claim table existed), skip
  // without re-granting. This is NOT the concurrency guard - two concurrent
  // deliveries for a NEW period both read the old period here and both fall
  // through. The claim insert below is what makes only one of them credit.
  if (existing.token_quota_period_end === input.periodEnd) {
    return { granted: false, balance: existing.token_balance ?? 0 };
  }

  // Concurrency gate: CLAIM this (user, period) by INSERTing the grant receipt
  // first. UNIQUE(user_id, period_end) means a duplicate/concurrent delivery
  // loses with 23505 and becomes an idempotent no-op, so only the FIRST
  // delivery reaches the credit below. Mirrors token_topup_purchases' insert-
  // first-claim, which replaced the same class of check-then-write double-grant.
  const { error: claimErr } = await admin.from('token_monthly_grants').insert({
    user_id: input.userId,
    period_end: input.periodEnd,
    tier: input.tier,
    tokens: grant,
  });
  if (claimErr) {
    if ((claimErr as { code?: string }).code === '23505') {
      // Lost the race: another delivery already granted this exact period.
      return { granted: false, balance: existing.token_balance ?? 0 };
    }
    // A real failure (not a duplicate). Best-effort by contract: report
    // not-granted so the next webhook/sync retries; never credit on error.
    return { granted: false, balance: existing.token_balance ?? 0 };
  }

  // Won the claim -> credit exactly once. Roll-over with a hard cap prevents a
  // dormant subscription accumulating a year of grants to dump in one session.
  const cap = grant * ROLLOVER_MULTIPLIER;
  const carryOver = Math.min(existing.token_balance ?? 0, cap - grant);
  const newBalance = Math.max(grant, grant + carryOver);

  const credit = classifyCreditWrite(
    await admin
      .from('profiles')
      .update({
        token_balance: newBalance,
        token_quota_period_end: input.periodEnd,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.userId)
      .select('id'),
  );

  // The credit is the whole point of winning the claim. If it did not land,
  // leaving the claim row behind makes the loss permanent: the next delivery of
  // this same period 23505s on the claim and returns without crediting, so the
  // customer has paid, the receipt says granted, and no tokens exist. Release
  // the claim so the grant stays retryable.
  //
  // Releasing it cannot double-credit, and that does NOT depend on knowing
  // whether the write landed. The same UPDATE that credits also stamps
  // token_quota_period_end, and the fast path at the top of this function
  // short-circuits on that stamp. So if the write did land and only the
  // response was lost, the retry returns granted:false at the stamp; if it did
  // not land, the retry credits exactly once. Exactly-once is carried by the
  // claim row AND the period stamp together, which is why the claim alone is
  // safe to drop here.
  if (!credit.landed) {
    await releaseClaim(
      admin,
      'token_monthly_grants',
      { user_id: input.userId, period_end: input.periodEnd },
      `monthly grant for ${input.userId}`,
    );
    // No ledger row. It would assert a balance_after nobody holds, and the
    // ledger is the record read back when a charge is disputed. No throw
    // either: the caller is a Stripe webhook, where a rejection buys a retry
    // loop rather than a correction (same call the legacy helpers in
    // lib/storage.ts made).
    console.error(
      `[tokens] monthly grant credit for ${input.userId} did not land (tier ${input.tier}, period ${input.periodEnd}); claim released, ledger entry skipped`,
    );
    return { granted: false, balance: existing.token_balance ?? 0 };
  }

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

  // created_by comes along because token_ledger.user_id is NOT NULL and a
  // pool grant has no acting user of its own. The firm's creator is the
  // right attribution: their subscription is what funds the pool (see
  // firmFundedBySubscriber in lib/firm-billing.ts).
  const { data: row } = await admin
    .from('firms')
    .select('token_pool_balance, token_pool_period_end, created_by')
    .eq('id', input.firmId)
    .maybeSingle();
  const existing = (row as {
    token_pool_balance?: number;
    token_pool_period_end?: string;
    created_by?: string | null;
  } | null) ?? { token_pool_balance: 0 };

  // Fast path / migration guard (see grantTierMonthlyTokens). Skips a period
  // already granted, incl. pre-claim-table grants; NOT the concurrency guard.
  if (existing.token_pool_period_end === input.periodEnd) {
    return { granted: false, balance: existing.token_pool_balance ?? 0 };
  }

  const newGrant = perSeat * input.seats;

  // Concurrency gate: CLAIM this (firm, period) via a UNIQUE(firm_id, period_end)
  // insert first, so a duplicate/concurrent delivery loses with 23505 and only
  // the first delivery credits the shared pool.
  const { error: claimErr } = await admin.from('token_firm_pool_grants').insert({
    firm_id: input.firmId,
    period_end: input.periodEnd,
    tier: input.tier,
    seats: input.seats,
    tokens: newGrant,
  });
  if (claimErr) {
    // 23505 = lost the race (already granted); any other error is a real
    // failure. Either way, never credit: report the current pool balance and
    // let the next delivery retry.
    return { granted: false, balance: existing.token_pool_balance ?? 0 };
  }

  const cap = newGrant * 3;
  const carryOver = Math.min(existing.token_pool_balance ?? 0, cap - newGrant);
  const newBalance = Math.max(newGrant, newGrant + carryOver);

  const credit = classifyCreditWrite(
    await admin
      .from('firms')
      .update({
        token_pool_balance: newBalance,
        token_pool_period_end: input.periodEnd,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.firmId)
      .select('id'),
  );

  // Same reasoning as grantTierMonthlyTokens: the claim alone is not what makes
  // this exactly-once. token_pool_period_end is stamped by the same UPDATE and
  // the fast path above short-circuits on it, so releasing a claim whose credit
  // is unconfirmed leaves the grant retryable without any chance of a second
  // credit. Keeping it would strand a paid firm pool at zero for the period.
  if (!credit.landed) {
    await releaseClaim(
      admin,
      'token_firm_pool_grants',
      { firm_id: input.firmId, period_end: input.periodEnd },
      `firm pool grant for ${input.firmId}`,
    );
    console.error(
      `[tokens] firm pool grant credit for ${input.firmId} did not land (tier ${input.tier}, period ${input.periodEnd}); claim released, ledger entry skipped`,
    );
    return { granted: false, balance: existing.token_pool_balance ?? 0 };
  }

  // token_ledger.user_id is NOT NULL, so a row without one is rejected by
  // the database, not merely unattributed. Skipping the insert when the
  // creator is gone keeps the failure honest: the alternative fires a write
  // that can only ever 23502, which reads as a broken ledger rather than a
  // firm with no owner to attribute the grant to.
  if (existing.created_by) {
    const { error: ledgerErr } = await admin.from('token_ledger').insert({
      user_id: existing.created_by,
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
    if (ledgerErr) {
      // Best effort by design: the pool credit already landed, and throwing
      // here would tell a Stripe webhook to retry a grant that succeeded. What
      // it costs is a gap in the ledger the counsel pool page reads back, so it
      // is said out loud rather than swallowed.
      console.error(
        `[tokens] firm pool ledger row for ${input.firmId} did not land (${
          (ledgerErr as { message?: string }).message ?? 'unknown error'
        }); the pool was credited but the audit trail is short one movement`,
      );
    }
  } else {
    console.error(
      `[tokens] firm ${input.firmId} has no created_by to attribute the pool grant to; the pool was credited but no ledger row was written`,
    );
  }

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
  // The RPCs return the resulting balance as a number. Anything else means the
  // credit did not run, so there is no balance to assert and the ledger row is
  // skipped rather than written with a null balance_after next to a positive
  // delta, which would read as a refund that happened.
  if (ctx.firmId && toFirm > 0) {
    const { data } = await admin.rpc('credit_firm_token_pool', {
      p_firm_id: ctx.firmId,
      p_amount: toFirm,
    });
    firmAfter = typeof data === 'number' ? data : null;
    if (firmAfter === null) {
      console.error(
        `[tokens] refund of ${toFirm} to firm pool ${ctx.firmId} did not land (${reason}); ledger entry skipped`,
      );
    } else {
      await admin.from('token_ledger').insert({
        user_id: ctx.userId,
        firm_id: ctx.firmId,
        delta: toFirm,
        reason,
        balance_after: firmAfter,
        metadata: { ...(ctx.metadata ?? {}), source: 'firm_pool', refund: true },
      });
    }
  }
  if (toUser > 0) {
    const { data } = await admin.rpc('credit_user_token_balance', {
      p_user_id: ctx.userId,
      p_amount: toUser,
    });
    userAfter = typeof data === 'number' ? data : null;
    if (userAfter === null) {
      console.error(
        `[tokens] refund of ${toUser} to ${ctx.userId} did not land (${reason}); ledger entry skipped`,
      );
    } else {
      await admin.from('token_ledger').insert({
        user_id: ctx.userId,
        firm_id: ctx.firmId ?? null,
        delta: toUser,
        reason,
        balance_after: userAfter,
        metadata: { ...(ctx.metadata ?? {}), source: 'user_balance', refund: true },
      });
    }
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
/**
 * Decide what to do with a top-up receipt whose credit did not land, and
 * report it in the log line.
 *
 * Unlike the two grant paths, a top-up credit is a relative increment with no
 * stamp on the balance row saying which payment produced it, so the receipt row
 * is the ONLY thing making this exactly-once. Release it only when the write is
 * provably absent, which is what the empty row set means. When the write merely
 * errored we cannot tell a lost response from a lost write, and releasing the
 * receipt would turn a possible single credit into a possible double credit, so
 * the receipt stays and the row is named for reconciliation by hand. That
 * direction is deliberate: the customer keeps a claim on tokens they paid for
 * and a human can settle it, where the other direction spends money we cannot
 * get back.
 */
async function releaseTopupClaim(
  admin: AdminClient,
  paymentIntentId: string,
  credit: { provablyAbsent: boolean },
): Promise<string> {
  if (!credit.provablyAbsent) {
    return 'receipt KEPT because the write could not be proved absent, reconcile this payment intent by hand';
  }
  await releaseClaim(
    admin,
    'token_topup_purchases',
    { stripe_payment_intent_id: paymentIntentId },
    `top-up ${paymentIntentId}`,
  );
  return 'receipt released so the purchase can be applied again';
}

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
    const credit = classifyCreditWrite(
      await admin
        .from('firms')
        .update({ token_pool_balance: next, updated_at: new Date().toISOString() })
        .eq('id', input.firmId)
        .select('id'),
    );
    if (!credit.landed) {
      const released = await releaseTopupClaim(admin, input.paymentIntentId, credit);
      console.error(
        `[tokens] top-up credit for firm ${input.firmId} did not land (package ${pack.id}, intent ${input.paymentIntentId}); ledger entry skipped; ${released}`,
      );
      return { ok: false, tokens: 0, error: 'token pool credit did not land' };
    }
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
    const credit = classifyCreditWrite(
      await admin
        .from('profiles')
        .update({
          token_balance: next,
          updated_at: new Date().toISOString(),
        })
        .eq('id', input.userId)
        .select('id'),
    );
    if (!credit.landed) {
      const released = await releaseTopupClaim(admin, input.paymentIntentId, credit);
      console.error(
        `[tokens] top-up credit for ${input.userId} did not land (package ${pack.id}, intent ${input.paymentIntentId}); ledger entry skipped; ${released}`,
      );
      return { ok: false, tokens: 0, error: 'token balance credit did not land' };
    }
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
