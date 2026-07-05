import { createServerSupabase } from './supabase/server';

/**
 * Read-only helpers + types for trust accounting. Server actions
 * that mutate the ledger live in lib/trust-accounting.ts (which has
 * the `'use server'` directive). This file is plain server-side
 * library code so we can export types, constants, and sync helpers.
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

export async function listTrustTransactions(
  firmId: string,
  filter?: { caseId?: string; clientUserId?: string; accountId?: string },
  // Display list only - bounded so a long-lived account's full history
  // (which grows without limit) can't be pulled into the page render. The
  // balances/totals come from the DB-aggregated reconcile helpers below,
  // NOT from this list, so bounding it never affects the math.
  limit = 500,
): Promise<TrustTransaction[]> {
  const supabase = createServerSupabase();
  let q = supabase
    .from('firm_trust_transactions')
    .select('*')
    .eq('firm_id', firmId)
    .order('created_at', { ascending: false });
  if (filter?.accountId) q = q.eq('account_id', filter.accountId);
  if (filter?.caseId) q = q.eq('case_id', filter.caseId);
  if (filter?.clientUserId) q = q.eq('client_user_id', filter.clientUserId);
  q = q.limit(limit);
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
  // Aggregate in Postgres via the get_trust_reconciliation_summary RPC
  // instead of pulling the whole ledger into Node: it grows without bound,
  // so a long-lived IOLTA account would eventually OOM the render. The RPC
  // also buckets perClient by client IDENTITY (user id when present, else
  // the normalized label) - the SAME key post_trust_transaction's balance
  // guard uses - so the reconciliation report and the guard always agree
  // (previously this bucketed by raw free-text client_label and could split
  // or merge clients differently from the guard).
  const supabase = createServerSupabase();
  const { data } = await supabase.rpc('get_trust_reconciliation_summary', {
    p_firm_id: firmId,
    p_account_id: accountId,
  });
  const d = (data ?? {}) as {
    bookBalanceCents?: number;
    reconciledBalanceCents?: number;
    unreconciledCount?: number;
    perClient?: Array<{ clientLabel: string; balanceCents: number }>;
  };
  return {
    bookBalanceCents: d.bookBalanceCents ?? 0,
    reconciledBalanceCents: d.reconciledBalanceCents ?? 0,
    perClient: d.perClient ?? [],
    unreconciledCount: d.unreconciledCount ?? 0,
  };
}

export type UnreconciledEntry = {
  id: string;
  kind: TrustTxKind;
  clientLabel: string;
  /** Signed cents: positive increases the trust balance, negative decreases. */
  signedCents: number;
  description: string | null;
  createdAt: string;
};

/**
 * Data for the reconciliation form: the not-yet-cleared transactions
 * (each with its signed amount, so the client can total the ones the
 * operator checks off) plus the balance already cleared in prior
 * reconciliations (the base the newly-checked items add to).
 */
export async function getReconciliationWorkspace(
  firmId: string,
  accountId: string,
): Promise<{
  reconciledBaseCents: number;
  unreconciled: UnreconciledEntry[];
}> {
  const supabase = createServerSupabase();
  // Reconciled base = sum of already-cleared entries. Take it from the DB
  // aggregate so the (unboundedly growing) reconciled HISTORY never lands
  // in Node - only the unreconciled working set below does.
  const { data: summary } = await supabase.rpc('get_trust_reconciliation_summary', {
    p_firm_id: firmId,
    p_account_id: accountId,
  });
  const reconciledBaseCents =
    ((summary ?? {}) as { reconciledBalanceCents?: number }).reconciledBalanceCents ?? 0;

  // Only the not-yet-cleared transactions - the rows the operator actually
  // checks off. This is the real working set (an account with thousands of
  // *unreconciled* entries is itself the problem to surface, not to hide).
  const { data } = await supabase
    .from('firm_trust_transactions')
    .select('id, client_label, kind, amount_cents, description, created_at')
    .eq('firm_id', firmId)
    .eq('account_id', accountId)
    .is('reconciled_at', null)
    .order('created_at', { ascending: true });
  const rows = (data ?? []) as Array<{
    id: string;
    client_label: string;
    kind: TrustTxKind;
    amount_cents: number;
    description: string | null;
    created_at: string;
  }>;
  const unreconciled: UnreconciledEntry[] = rows.map((r) => {
    const sign = POSITIVE_KINDS.has(r.kind) && r.kind !== 'correction' ? 1 : -1;
    return {
      id: r.id,
      kind: r.kind,
      clientLabel: r.client_label,
      signedCents: sign * r.amount_cents,
      description: r.description,
      createdAt: r.created_at,
    };
  });
  return { reconciledBaseCents, unreconciled };
}

export type TrustReconciliation = {
  id: string;
  statementDate: string;
  bankBalanceCents: number;
  bookBalanceCents: number;
  reconciledBalanceCents: number;
  differenceCents: number;
  status: 'balanced' | 'unbalanced';
  note: string | null;
  createdAt: string;
};

/** Past reconciliations for an account, newest statement first. */
export async function listTrustReconciliations(
  firmId: string,
  accountId: string,
): Promise<TrustReconciliation[]> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firm_trust_reconciliations')
    .select('*')
    .eq('firm_id', firmId)
    .eq('account_id', accountId)
    .order('statement_date', { ascending: false })
    .limit(24);
  return ((data ?? []) as Array<{
    id: string;
    statement_date: string;
    bank_balance_cents: number;
    book_balance_cents: number;
    reconciled_balance_cents: number;
    difference_cents: number;
    status: 'balanced' | 'unbalanced';
    note: string | null;
    created_at: string;
  }>).map((r) => ({
    id: r.id,
    statementDate: r.statement_date,
    bankBalanceCents: r.bank_balance_cents,
    bookBalanceCents: r.book_balance_cents,
    reconciledBalanceCents: r.reconciled_balance_cents,
    differenceCents: r.difference_cents,
    status: r.status,
    note: r.note,
    createdAt: r.created_at,
  }));
}
