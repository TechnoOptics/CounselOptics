'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser } from './supabase/server';
import type { TrustTxKind } from './trust-accounting-queries';

/**
 * Server actions that mutate the firm's trust ledger. Read-only
 * helpers (listTrustTransactions, reconcileTrustAccount, the
 * signedAmount sign helper, and the TrustTransaction type) live in
 * lib/trust-accounting-queries.ts so this file can carry the
 * `'use server'` directive without violating the "every export must
 * be async" rule.
 */
export async function recordTrustTransactionAction(
  firmId: string,
  accountId: string,
  input: {
    caseId?: string | null;
    clientUserId?: string | null;
    clientLabel: string;
    kind: TrustTxKind;
    amountCents: number;
    description?: string | null;
    reference?: string | null;
  },
): Promise<{ ok: boolean; error?: string; transactionId?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  // Reject NaN / Infinity / fractional cents here: `NaN <= 0` is false,
  // so a bare `<= 0` check would let a malformed amount through and get
  // stored as a garbage value.
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return {
      ok: false,
      error: 'Amount must be a positive whole number of cents.',
    };
  }

  // Post through the atomic RPC: it re-verifies membership + role,
  // takes a per-account lock, and refuses any transaction that would
  // drive the client's trust balance negative. Authorization and the
  // balance guard live together in one serialized transaction so two
  // concurrent disbursements can't both pass a stale balance check.
  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc('post_trust_transaction', {
    p_firm_id: firmId,
    p_account_id: accountId,
    p_case_id: input.caseId ?? null,
    p_client_user_id: input.clientUserId ?? null,
    p_client_label: input.clientLabel,
    p_kind: input.kind,
    p_amount_cents: input.amountCents,
    p_description: input.description ?? null,
    p_reference: input.reference ?? null,
  });
  if (error) {
    // Surface the balance-guard message in plain language; leave other
    // Postgres errors as-is for the operator to see.
    const msg = /insufficient trust balance/i.test(error.message)
      ? "That would overdraw the client's trust balance. Check the ledger before disbursing."
      : error.message;
    return { ok: false, error: msg };
  }
  revalidatePath('/counsel/trust');
  return { ok: true, transactionId: data as string };
}
