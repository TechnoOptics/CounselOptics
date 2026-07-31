'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser } from './supabase/server';

export type DeadlineKind =
  | 'statute_of_limitations'
  | 'response_due'
  | 'discovery_due'
  | 'motion_due'
  | 'hearing'
  | 'trial'
  | 'filing_deadline'
  | 'appeal'
  | 'custom';

export async function addDeadlineAction(
  caseId: string,
  input: {
    firmId?: string | null;
    kind: DeadlineKind;
    title: string;
    description?: string | null;
    dueAt: string;
    jurisdiction?: string | null;
    source?: string | null;
  },
): Promise<{ ok: boolean; error?: string; deadlineId?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  if (!input.title.trim()) return { ok: false, error: 'Title is required.' };
  if (!input.dueAt) return { ok: false, error: 'Due date is required.' };
  const supabase = createServerSupabase();
  // Authorization for case_deadlines currently lives only in RLS, and that
  // policy is not in version control (see docs/audit/UX_AUDIT_COUNSEL.md B8),
  // so state it in code as well: the matter has to be one the caller can
  // actually see, and firmId can only be that matter's own firm.
  const { data: kase } = await supabase
    .from('cases')
    .select('id, firm_id')
    .eq('id', caseId)
    .maybeSingle();
  if (!kase) return { ok: false, error: 'You do not have access to that matter.' };
  if (input.firmId && input.firmId !== (kase as { firm_id: string | null }).firm_id) {
    return { ok: false, error: 'That matter is not in this firm.' };
  }
  const { data, error } = await supabase
    .from('case_deadlines')
    .insert({
      case_id: caseId,
      firm_id: input.firmId ?? null,
      user_id: user.id,
      kind: input.kind,
      title: input.title.trim(),
      description: input.description ?? null,
      due_at: input.dueAt,
      jurisdiction: input.jurisdiction ?? null,
      source: input.source ?? null,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed.' };
  revalidatePath(`/counsel/cases/${caseId}`);
  revalidatePath(`/cases/${caseId}`);
  return { ok: true, deadlineId: (data as { id: string }).id };
}

export async function completeDeadlineAction(
  deadlineId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();
  // Same reasoning as addDeadlineAction: confirm the deadline hangs off a
  // matter this caller can see before completing it, rather than trusting an
  // id from the client and an uncommitted policy.
  const { data: row } = await supabase
    .from('case_deadlines')
    .select('id, case_id')
    .eq('id', deadlineId)
    .maybeSingle();
  const deadlineCaseId = (row as { case_id: string } | null)?.case_id;
  if (!deadlineCaseId) return { ok: false, error: 'That deadline could not be found.' };
  const { data: kase } = await supabase
    .from('cases')
    .select('id')
    .eq('id', deadlineCaseId)
    .maybeSingle();
  if (!kase) return { ok: false, error: 'You do not have access to that matter.' };
  const { error } = await supabase
    .from('case_deadlines')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', deadlineId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/counsel/cases/${deadlineCaseId}`);
  return { ok: true };
}
