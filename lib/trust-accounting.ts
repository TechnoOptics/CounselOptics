'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser } from './supabase/server';
import type { TrustTxKind } from './trust-accounting-queries';
import {
  friendlyTrustError,
  MAX_TRUST_AMOUNT_CENTS,
  TRUST_AMOUNT_RANGE_MESSAGE,
  TRUST_GENERIC_MESSAGE,
  TRUST_SESSION_MESSAGE,
} from './trust-errors';
import { US_STATE_CODES } from './trust-amount';
import { surfaceRefusal } from './firm-surface-guard';

/**
 * Server actions that mutate the firm's trust ledger. Read-only
 * helpers (listTrustTransactions, reconcileTrustAccount, the
 * signedAmount sign helper, and the TrustTransaction type) live in
 * lib/trust-accounting-queries.ts so this file can carry the
 * `'use server'` directive without violating the "every export must
 * be async" rule.
 *
 * EVERY write goes through here, on the server, using the cookie-backed
 * client from createServerSupabase. A browser client built with
 * `createClient(url, anonKey)` keeps its session in localStorage, which
 * this app does not use - the session lives in cookies - so such a
 * client reaches PostgREST unauthenticated, auth.uid() is null, and the
 * RLS WITH CHECK on firm_trust_accounts can never pass. That is exactly
 * why the trust ledger held zero rows in production.
 */

/** Trim to null so empty strings never land in the ledger as "". */
function clean(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  return s === '' ? null : s;
}

/**
 * Create a trust account for the firm.
 *
 * Writes through the cookie session so RLS resolves auth.uid() to the
 * signed-in member; the firm_trust_accounts policy then admits the write
 * only for an owner, admin, or attorney of that firm. Returns the new id
 * so the caller has positive confirmation that a row actually landed,
 * rather than assuming success from the absence of an error.
 */
export async function createTrustAccountAction(
  firmId: string,
  input: {
    name: string;
    bankName?: string | null;
    /** Last four digits only. Never send or store a full account number. */
    accountLast4?: string | null;
    state: string;
    isIolta?: boolean;
  },
): Promise<{ ok: boolean; error?: string; accountId?: string }> {
  // Time, billing and trust are one surface. When a workspace does not have
  // it - because of its type or because its owner switched it off - this write
  // is refused here and not merely absent from the rail: the export stays a
  // public HTTP endpoint whatever the sidebar renders. Reads are deliberately
  // left open, so a firm that switches type keeps every row it had.
  {
    const refused = await surfaceRefusal(firmId, 'timeBilling');
    if (refused) return refused;
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: TRUST_SESSION_MESSAGE };

  const name = clean(input.name);
  const state = clean(input.state)?.toUpperCase() ?? null;
  if (!name) return { ok: false, error: 'Enter a label for this account.' };
  // Checked against the real list, not just a two-letter shape: the state
  // determines which bar's trust-accounting rules govern the account, so a
  // typo like "ZZ" must not be storable.
  if (!state || !(US_STATE_CODES as readonly string[]).includes(state)) {
    return { ok: false, error: 'Choose the state whose bar rules govern this account.' };
  }

  // Only the last four digits are ever accepted, and they are masked here on
  // the server so a full account number cannot be stored even if the client
  // sends one.
  const digits = (clean(input.accountLast4) ?? '').replace(/\D/g, '');
  if (digits && digits.length > 4) {
    return { ok: false, error: 'Enter only the last four digits of the account number.' };
  }
  const masked = digits ? `****${digits}` : null;

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('firm_trust_accounts')
    .insert({
      firm_id: firmId,
      name,
      bank_name: clean(input.bankName),
      account_number_masked: masked,
      state,
      is_iolta: input.isIolta ?? true,
    })
    // Read the row back so success is confirmed by the database, not inferred
    // from a missing error. Safe because firm_trust_accounts_member is a
    // single cmd=ALL policy: anything the WITH CHECK admits, the USING clause
    // admits too, so a write that lands is always readable back by its author.
    .select('id')
    .single();

  if (error) {
    return { ok: false, error: friendlyTrustError(error, 'create-account') };
  }
  // No error but no row means nothing was written; never report success.
  const accountId = (data as { id?: string } | null)?.id;
  if (!accountId) return { ok: false, error: TRUST_GENERIC_MESSAGE };

  revalidatePath('/counsel/trust');
  return { ok: true, accountId };
}
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
  // Time, billing and trust are one surface. When a workspace does not have
  // it - because of its type or because its owner switched it off - this write
  // is refused here and not merely absent from the rail: the export stays a
  // public HTTP endpoint whatever the sidebar renders. Reads are deliberately
  // left open, so a firm that switches type keeps every row it had.
  {
    const refused = await surfaceRefusal(firmId, 'timeBilling');
    if (refused) return refused;
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: TRUST_SESSION_MESSAGE };
  // Reject NaN / Infinity / fractional cents here: `NaN <= 0` is false,
  // so a bare `<= 0` check would let a malformed amount through and get
  // stored as a garbage value.
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return {
      ok: false,
      error: 'Enter an amount greater than zero.',
    };
  }
  // amount_cents is int4. Anything above the ceiling raises a Postgres
  // overflow instead of recording, so reject it here with copy a lawyer
  // can act on rather than letting "integer out of range" reach the screen.
  if (input.amountCents > MAX_TRUST_AMOUNT_CENTS) {
    return { ok: false, error: TRUST_AMOUNT_RANGE_MESSAGE };
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
    return { ok: false, error: friendlyTrustError(error, 'record-transaction') };
  }
  const transactionId = typeof data === 'string' ? data : undefined;
  // The RPC returns the new row's id. No id means no row; never report a
  // trust entry as recorded unless the database handed one back.
  if (!transactionId) return { ok: false, error: TRUST_GENERIC_MESSAGE };
  revalidatePath('/counsel/trust');
  return { ok: true, transactionId };
}

/**
 * Record a bank-statement reconciliation: mark the checked-off
 * transactions as cleared and store the three figures (bank ending
 * balance, book balance, reconciled balance). Runs through the
 * create_trust_reconciliation RPC, which re-verifies membership/role,
 * locks the account, and stamps the cleared transactions atomically.
 */
export async function createTrustReconciliationAction(
  firmId: string,
  accountId: string,
  input: {
    statementDate: string;
    bankBalanceCents: number;
    transactionIds: string[];
    note?: string | null;
  },
): Promise<{ ok: boolean; error?: string; reconciliationId?: string }> {
  // Time, billing and trust are one surface. When a workspace does not have
  // it - because of its type or because its owner switched it off - this write
  // is refused here and not merely absent from the rail: the export stays a
  // public HTTP endpoint whatever the sidebar renders. Reads are deliberately
  // left open, so a firm that switches type keeps every row it had.
  {
    const refused = await surfaceRefusal(firmId, 'timeBilling');
    if (refused) return refused;
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: TRUST_SESSION_MESSAGE };
  if (!input.statementDate || Number.isNaN(Date.parse(input.statementDate))) {
    return { ok: false, error: 'Enter the date on your bank statement.' };
  }
  // bank_balance_cents is bigint, so the int4 ceiling does not apply, but a
  // value past MAX_SAFE_INTEGER would already have lost precision in JS before
  // it ever reached Postgres. Reject rather than store an approximation.
  if (
    !Number.isInteger(input.bankBalanceCents) ||
    !Number.isSafeInteger(input.bankBalanceCents)
  ) {
    return {
      ok: false,
      error: 'Enter the statement ending balance as an amount, for example 12500.00.',
    };
  }

  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc('create_trust_reconciliation', {
    p_firm_id: firmId,
    p_account_id: accountId,
    p_statement_date: input.statementDate,
    p_bank_balance_cents: input.bankBalanceCents,
    p_transaction_ids: input.transactionIds ?? [],
    p_note: input.note ?? null,
  });
  if (error) {
    return { ok: false, error: friendlyTrustError(error, 'reconcile') };
  }
  const reconciliationId = typeof data === 'string' ? data : undefined;
  if (!reconciliationId) return { ok: false, error: TRUST_GENERIC_MESSAGE };
  revalidatePath('/counsel/trust');
  return { ok: true, reconciliationId };
}
