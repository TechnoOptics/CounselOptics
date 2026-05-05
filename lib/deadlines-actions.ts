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
  const { error } = await supabase
    .from('case_deadlines')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', deadlineId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
