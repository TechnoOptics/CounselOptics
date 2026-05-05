'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser } from './supabase/server';

/**
 * IOLTA-style trust accounting. Every state bar requires:
 *   - Funds held for clients (retainers, settlement proceeds, etc.)
 *     stay in a separate trust account, not in operating funds.
 *   - A separate ledger per client / matter.
 *   - Three-way reconciliation: client ledger total + firm trust
 *     journal total + bank statement should all match.
 *   - Monthly statements per client showing every movement.
 *
 * We store every movement as a signed amount (positive = into trust;
 * negative = out of trust). Balances are always derived from the
 * ledger, never cached, so reconciliation can never drift.
 */

const POSITIVE_KINDS = new Set([
  'deposit',
  'refund',
  'interest',
  'correction', // sign of correction is set per-row
]);

export type TrustTxKind =
  | 'deposit'
  | 'earned_fee_transfer'
  | 'disbursement'
  | 'refund'
  | 'bank_fee'
  | 'interest'
  | 'correction';

export type TrustTransaction = {
  id: string;
  firmId: string;
  accountId: string;
  caseId: string | null;
  clientUserId: string | null;
  clientLabel: string;
  kind: TrustTxKind;
  /** Always stored as the absolute value; signed by kind. */
  amountCents: number;
  description: string | null;
  reference: string | null;
  reconciledAt: string | null;
  bankStatementDate: string | null;
  createdAt: string;
};

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
  if (input.amountCents <= 0) {
    return { ok: false, error: 'Amount must be positive (sign is derived from kind).' };
  }
  const supabase = createServerSupabase();
  const { data: member } = await supabase
    .from('firm_members')
    .select('role')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return { ok: false, error: 'You are not a member of that firm.' };
  if (
    !['owner', 'admin', 'attorney', 'paralegal'].includes(
      (member as { role: string }).role,
    )
  ) {
    return { ok: false, error: 'Your role cannot post trust transactions.' };
  }

  const { data, error } = await supabase
    .from('firm_trust_transactions')
    .insert({
      firm_id: firmId,
      account_id: accountId,
      case_id: input.caseId ?? null,
      client_user_id: input.clientUserId ?? null,
      client_label: input.clientLabel,
      kind: input.kind,
      amount_cents: input.amountCents,
      description: input.description ?? null,
      reference: input.reference ?? null,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed.' };
  revalidatePath('/counsel/trust');
  return { ok: true, transactionId: (data as { id: string }).id };
}

export async function listTrustTransactions(
  firmId: string,
  filter?: { caseId?: string; clientUserId?: string },
): Promise<TrustTransaction[]> {
  const supabase = createServerSupabase();
  let q = supabase
    .from('firm_trust_transactions')
    .select('*')
    .eq('firm_id', firmId)
    .order('created_at', { ascending: false });
  if (filter?.caseId) q = q.eq('case_id', filter.caseId);
  if (filter?.clientUserId) q = q.eq('client_user_id', filter.clientUserId);
  const { data } = await q;
  return ((data ?? []) as Array<{
    id: string;
    firm_id: string;
    account_id: string;
    case_id: string | null;
    client_user_id: string | null;
    client_label: string;
    kind: TrustTxKind;
    amount_cents: number;
    description: string | null;
    reference: string | null;
    reconciled_at: string | null;
    bank_statement_date: string | null;
    created_at: string;
  }>).map((r) => ({
    id: r.id,
    firmId: r.firm_id,
    accountId: r.account_id,
    caseId: r.case_id,
    clientUserId: r.client_user_id,
    clientLabel: r.client_label,
    kind: r.kind,
    amountCents: r.amount_cents,
    description: r.description,
    reference: r.reference,
    reconciledAt: r.reconciled_at,
    bankStatementDate: r.bank_statement_date,
    createdAt: r.created_at,
  }));
}

/**
 * Sign a transaction's amount based on its kind. Positive amounts
 * increase the trust balance; negative amounts decrease it.
 * Correction defaults to negative; operators flip the sign in the
 * description / reference if it is a positive correction.
 */
export function signedAmount(t: TrustTransaction): number {
  if (POSITIVE_KINDS.has(t.kind) && t.kind !== 'correction') return t.amountCents;
  return -t.amountCents;
}

/**
 * Three-way reconciliation summary. Returns:
 *   - bookBalance: sum of all signed amounts in the ledger
 *   - perClient: balances bucketed by client_label
 *   - reconciledBalance: balance limited to entries with
 *     reconciled_at set (matches bank statement)
 *
 * Operators feed the bank-statement-end balance from the import
 * and compare to reconciledBalance.
 */
export async function reconcileTrustAccount(
  firmId: string,
  accountId: string,
): Promise<{
  bookBalanceCents: number;
  reconciledBalanceCents: number;
  perClient: Array<{ clientLabel: string; balanceCents: number }>;
  unreconciledCount: number;
}> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firm_trust_transactions')
    .select('client_label, kind, amount_cents, reconciled_at')
    .eq('firm_id', firmId)
    .eq('account_id', accountId);
  const rows = (data ?? []) as Array<{
    client_label: string;
    kind: TrustTxKind;
    amount_cents: number;
    reconciled_at: string | null;
  }>;
  let bookBalance = 0;
  let reconciledBalance = 0;
  let unreconciledCount = 0;
  const perClient = new Map<string, number>();
  for (const r of rows) {
    const sign = POSITIVE_KINDS.has(r.kind) && r.kind !== 'correction' ? 1 : -1;
    const amt = sign * r.amount_cents;
    bookBalance += amt;
    if (r.reconciled_at) reconciledBalance += amt;
    else unreconciledCount += 1;
    perClient.set(
      r.client_label,
      (perClient.get(r.client_label) ?? 0) + amt,
    );
  }
  return {
    bookBalanceCents: bookBalance,
    reconciledBalanceCents: reconciledBalance,
    perClient: Array.from(perClient.entries()).map(([clientLabel, balanceCents]) => ({
      clientLabel,
      balanceCents,
    })),
    unreconciledCount,
  };
}
