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
