'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser, createServerSupabase } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { aiConfigured } from './timeline-ai';
import { resolveTimelineAccess } from './timeline-entitlement';
import { loadCaseEvidenceDigest } from './case-evidence-digest';
import { generateApproachArgument, type ApproachArgument, type ApproachFacts } from './approach-ai';
import { AI_UNAVAILABLE_MESSAGE } from './ai-errors';
import { getFirmCaseTimeline } from './case-evidence-actions';
import { guestCanReadCase } from './counsel-guest';
import { exhibitLabel, fuzzyTitleMatch, type TimelineEvent } from './timeline-types';

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
  /** Who is connected — parties, witnesses, roles — and how. */
  connections: string;
  generated: ApproachArgument | null;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  id: string;
  case_id: string;
  title: string;
  prompt: string;
  connections: string | null;
  generated: ApproachArgument | null;
  created_at: string;
  updated_at: string;
};
/** A stored `generated` blob from before normalize() guaranteed arrays (or a
 *  partially written row) may miss exhibits/timeline/gaps. Backfill them so
 *  every consumer can read `.length`/`.map` without a render-time crash. */
const normalizeGenerated = (g: ApproachArgument | null): ApproachArgument | null =>
  g == null
    ? null
    : {
        thesis: g.thesis ?? '',
        argument: g.argument ?? '',
        exhibits: Array.isArray(g.exhibits) ? g.exhibits : [],
        timeline: Array.isArray(g.timeline) ? g.timeline : [],
        gaps: Array.isArray(g.gaps) ? g.gaps : [],
      };

const toApproach = (r: Row): Approach => ({
  id: r.id,
  caseId: r.case_id,
  title: r.title,
  prompt: r.prompt,
  connections: r.connections ?? '',
  generated: normalizeGenerated(r.generated ?? null),
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
  if (member) {
    const { data: kase } = await supabase
      .from('cases')
      .select('id')
      .eq('id', caseId)
      .eq('firm_id', firmId)
      .maybeSingle();
    if (!kase) return { ok: false, error: 'That matter is not in this firm.' };
    return { ok: true, userId: user.id };
  }
  // Co-counsel GUEST scoped to this matter. A counsel guest (case_collaborators
  // role 'attorney', not a firm member) may use the case tools - approaches
  // included - but ONLY on the matter they're assigned to. guestCanReadCase
  // verifies both the case grant AND that the case belongs to `firmId`, so a
  // guest can never reach another matter or firm through this path.
  if (await guestCanReadCase(caseId, firmId)) return { ok: true, userId: user.id };
  return { ok: false, error: 'You do not have access to this matter.' };
}

const SELECT = 'id, case_id, title, prompt, connections, generated, created_at, updated_at';

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
  connections?: string,
): Promise<{ generated?: ApproachArgument; error?: string }> {
  // AI must be configured, and the matter's firm must be AI-entitled. A firm
  // member reflects that via their own 'firm' access; a scoped co-counsel guest
  // (already gated to THIS matter by assertFirmCase upstream) is allowed to run
  // the matter's analysis too, so the case tools actually work for them.
  if (!aiConfigured()) return { error: AI_UNAVAILABLE_MESSAGE };
  const firmAccess = (await resolveTimelineAccess()) === 'firm';
  if (!firmAccess && !(await guestCanReadCase(caseId))) {
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
  // Full extracted text for the most-relevant items (so the argument reasons
  // over the actual content, not just summaries), with one-line summaries for
  // the rest so the whole matter is still in view.
  const evidence = await loadCaseEvidenceDigest(admin, caseId, {
    fullTextTopN: 150,
    perItemChars: 2500,
  });
  const res = await generateApproachArgument({
    facts,
    approach: prompt,
    connections: (connections ?? '').trim() || undefined,
    evidence,
  });
  if ('error' in res) return { error: res.error };
  return { generated: res };
}

// ── Create: save the approach, then attempt generation (graceful) ─────────
export async function createFirmApproach(
  firmId: string,
  caseId: string,
  input: { title: string; prompt: string; connections?: string },
): Promise<{ ok: boolean; error?: string; approach?: Approach; generateError?: string }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const prompt = (input.prompt ?? '').trim();
  if (!prompt) return { ok: false, error: 'Write what you are trying to prove.' };
  const connections = (input.connections ?? '').trim();

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
  const gen = await runGeneration(admin, caseId, prompt, connections);
  const { data, error } = await admin
    .from('case_approaches')
    .insert({
      case_id: caseId,
      firm_id: firmId,
      title: title.slice(0, 200),
      prompt,
      connections,
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
  patch: { title?: string; prompt?: string; connections?: string },
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
  if (patch.connections !== undefined) {
    row.connections = patch.connections.trim();
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

  // Resolve the prompt + connections to run against. Always read the stored
  // connections (they aren't passed on a re-run), plus the passed-in theory
  // edit if any, else the stored theory.
  const { data: cur } = await admin
    .from('case_approaches')
    .select('prompt, connections')
    .eq('id', approachId)
    .eq('case_id', caseId)
    .maybeSingle();
  const stored = cur as { prompt: string; connections: string | null } | null;
  const theory = (prompt ?? '').trim() || (stored?.prompt ?? '').trim();
  if (!theory) return { ok: false, error: 'The approach cannot be empty.' };
  const connections = (stored?.connections ?? '').trim();

  const gen = await runGeneration(admin, caseId, theory, connections);
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

/**
 * The actual evidence items an approach marshals — the real uploads Advottic
 * cited when it assembled the argument (by exhibit label, with a title fallback
 * for label-less citations). Powers the in-app "Relevant uploads" gallery on
 * the approach card, so the firm sees only the evidence that bears on that
 * theory. Empty until the approach is assembled.
 */
export async function getApproachEvidence(
  firmId: string,
  caseId: string,
  approachId: string,
): Promise<{ ok: boolean; error?: string; events?: TimelineEvent[] }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const { data: appRow } = await admin
    .from('case_approaches')
    .select('generated')
    .eq('id', approachId)
    .eq('case_id', caseId)
    .maybeSingle();
  const g = normalizeGenerated((appRow as { generated: ApproachArgument | null } | null)?.generated ?? null);
  if (!g || g.exhibits.length === 0) return { ok: true, events: [] };

  const citedLabels = new Set(
    g.exhibits.map((e) => (e.exhibit ?? '').trim().toUpperCase()).filter(Boolean),
  );
  // Titles cited WITHOUT an exhibit label - matched fuzzily against the uploads
  // so a slightly-reworded citation still resolves to its real item.
  const citedTitles = g.exhibits
    .filter((e) => !e.exhibit)
    .map((e) => (e.title ?? '').trim())
    .filter(Boolean);

  const tl = await getFirmCaseTimeline(firmId, caseId);
  if (!tl.ok || !tl.events) return { ok: true, events: [] };
  const events = tl.events.filter((e) => {
    const label = exhibitLabel(e.aiExtracted?.exhibit_no);
    if (label && citedLabels.has(label.toUpperCase())) return true;
    const title = e.title ?? '';
    return citedTitles.some((ct) => fuzzyTitleMatch(ct, title));
  });
  return { ok: true, events };
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
