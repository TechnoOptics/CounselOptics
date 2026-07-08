'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser, createServerSupabase } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { aiConfigured } from './timeline-ai';
import { resolveTimelineAccess } from './timeline-entitlement';
import { loadCaseEvidenceDigest } from './case-evidence-digest';
import { generateApproachArgument, type ApproachArgument, type ApproachFacts } from './approach-ai';
import { AI_UNAVAILABLE_MESSAGE } from './ai-errors';

/**
 * Firm approach-builder actions ("prove-the-case" layer). The lawyer writes a
 * theory ("what I'm trying to prove"); Advottic assembles the matter's evidence
 * into a structured argument with cited exhibits + a supporting timeline, saved
 * as "Approach 1/2/3" and editable / re-runnable.
 *
 * Firm members are not case members of a firm matter, so every read/write goes
 * through the ADMIN client gated on firm membership + case.firm_id, mirroring
 * lib/firm-timeline-actions.ts. AI is gated through graceful degradation: the
 * approach is always saved; generation degrades to a calm "add credits" state
 * when analysis is unavailable, and can be re-run later.
 */

export type Approach = {
  id: string;
  caseId: string;
  title: string;
  prompt: string;
  generated: ApproachArgument | null;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  id: string;
  case_id: string;
  title: string;
  prompt: string;
  generated: ApproachArgument | null;
  created_at: string;
  updated_at: string;
};
const toApproach = (r: Row): Approach => ({
  id: r.id,
  caseId: r.case_id,
  title: r.title,
  prompt: r.prompt,
  generated: r.generated ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

async function assertFirmCase(
  firmId: string,
  caseId: string,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();
  const { data: member } = await supabase
    .from('firm_members')
    .select('id')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return { ok: false, error: 'You do not have access to this firm.' };
  const { data: kase } = await supabase
    .from('cases')
    .select('id')
    .eq('id', caseId)
    .eq('firm_id', firmId)
    .maybeSingle();
  if (!kase) return { ok: false, error: 'That matter is not in this firm.' };
  return { ok: true, userId: user.id };
}

const SELECT = 'id, case_id, title, prompt, generated, created_at, updated_at';

// ── List (admin, firm-scoped) ─────────────────────────────────────────────
export async function listFirmApproaches(
  firmId: string,
  caseId: string,
): Promise<{ ok: boolean; error?: string; approaches?: Approach[] }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const { data } = await admin
    .from('case_approaches')
    .select(SELECT)
    .eq('case_id', caseId)
    .order('created_at', { ascending: true });
  return { ok: true, approaches: ((data ?? []) as Row[]).map(toApproach) };
}

/** Load facts + evidence and run the model for one approach. Graceful. */
async function runGeneration(
  admin: NonNullable<ReturnType<typeof createAdminSupabase>>,
  caseId: string,
  prompt: string,
): Promise<{ generated?: ApproachArgument; error?: string }> {
  if (!aiConfigured() || (await resolveTimelineAccess()) !== 'firm') {
    return { error: AI_UNAVAILABLE_MESSAGE };
  }
  const { data: caseRow } = await admin
    .from('cases')
    .select('title, subject_name, case_type, posture, jurisdiction_state, jurisdiction_country, description')
    .eq('id', caseId)
    .maybeSingle();
  if (!caseRow) return { error: 'That matter is not in this firm.' };
  const cr = caseRow as {
    title: string;
    subject_name: string | null;
    case_type: string | null;
    posture: string | null;
    jurisdiction_state: string | null;
    jurisdiction_country: string | null;
    description: string | null;
  };
  const jurisdiction =
    [cr.jurisdiction_state, cr.jurisdiction_country].map((s) => (s ?? '').trim()).filter(Boolean).join(', ') || null;
  const facts: ApproachFacts = {
    title: cr.title,
    subjectName: cr.subject_name,
    caseType: cr.case_type,
    posture: cr.posture,
    jurisdiction,
    description: cr.description,
  };
  const evidence = await loadCaseEvidenceDigest(admin, caseId);
  const res = await generateApproachArgument({ facts, approach: prompt, evidence });
  if ('error' in res) return { error: res.error };
  return { generated: res };
}

// ── Create: save the approach, then attempt generation (graceful) ─────────
export async function createFirmApproach(
  firmId: string,
  caseId: string,
  input: { title: string; prompt: string },
): Promise<{ ok: boolean; error?: string; approach?: Approach; generateError?: string }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const prompt = (input.prompt ?? '').trim();
  if (!prompt) return { ok: false, error: 'Write what you are trying to prove.' };

  // Auto-number the title ("Approach 1/2/3") when none is given.
  let title = (input.title ?? '').trim();
  if (!title) {
    const { count } = await admin
      .from('case_approaches')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', caseId);
    title = `Approach ${(count ?? 0) + 1}`;
  }

  // Save first so the lawyer's theory is never lost, even if analysis is down.
  const gen = await runGeneration(admin, caseId, prompt);
  const { data, error } = await admin
    .from('case_approaches')
    .insert({
      case_id: caseId,
      firm_id: firmId,
      title: title.slice(0, 200),
      prompt,
      generated: gen.generated ?? null,
      created_by: gate.userId,
    })
    .select(SELECT)
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not save the approach.' };
  revalidatePath(`/counsel/cases/${caseId}`);
  return { ok: true, approach: toApproach(data as Row), generateError: gen.error };
}

// ── Edit title/prompt (does not re-run; call regenerate for that) ─────────
export async function updateFirmApproach(
  firmId: string,
  caseId: string,
  approachId: string,
  patch: { title?: string; prompt?: string },
): Promise<{ ok: boolean; error?: string }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (!t) return { ok: false, error: 'Give the approach a title.' };
    row.title = t.slice(0, 200);
  }
  if (patch.prompt !== undefined) {
    const p = patch.prompt.trim();
    if (!p) return { ok: false, error: 'The approach cannot be empty.' };
    row.prompt = p;
  }
  const { error } = await admin
    .from('case_approaches')
    .update(row)
    .eq('id', approachId)
    .eq('case_id', caseId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/counsel/cases/${caseId}`);
  return { ok: true };
}

// ── Re-run generation on the saved prompt (optionally an edited one) ──────
export async function regenerateFirmApproach(
  firmId: string,
  caseId: string,
  approachId: string,
  prompt?: string,
): Promise<{ ok: boolean; error?: string; approach?: Approach }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  // Resolve the prompt to run: the passed-in edit, else the stored one.
  let theory = (prompt ?? '').trim();
  if (!theory) {
    const { data: cur } = await admin
      .from('case_approaches')
      .select('prompt')
      .eq('id', approachId)
      .eq('case_id', caseId)
      .maybeSingle();
    theory = ((cur as { prompt: string } | null)?.prompt ?? '').trim();
  }
  if (!theory) return { ok: false, error: 'The approach cannot be empty.' };

  const gen = await runGeneration(admin, caseId, theory);
  if (gen.error) return { ok: false, error: gen.error };

  const { data, error } = await admin
    .from('case_approaches')
    .update({ prompt: theory, generated: gen.generated, updated_at: new Date().toISOString() })
    .eq('id', approachId)
    .eq('case_id', caseId)
    .select(SELECT)
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not save the argument.' };
  revalidatePath(`/counsel/cases/${caseId}`);
  return { ok: true, approach: toApproach(data as Row) };
}

// ── Delete ────────────────────────────────────────────────────────────────
export async function deleteFirmApproach(
  firmId: string,
  caseId: string,
  approachId: string,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const { error } = await admin
    .from('case_approaches')
    .delete()
    .eq('id', approachId)
    .eq('case_id', caseId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/counsel/cases/${caseId}`);
  return { ok: true };
}
