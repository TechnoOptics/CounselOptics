'use server';

import { revalidatePath } from 'next/cache';
import { waitUntil } from '@vercel/functions';
import { getCurrentUser, createServerSupabase } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { aiConfigured } from './timeline-ai';
import { resolveTimelineAccess } from './timeline-entitlement';
import { loadCaseEvidenceDigest } from './case-evidence-digest';
import { generateApproachArgument, type ApproachArgument, type ApproachFacts } from './approach-ai';
import { AI_UNAVAILABLE_MESSAGE } from './ai-errors';
import { toNormRules, normalizeDeep } from './text-normalize';
import { getFirmCaseTimeline } from './case-evidence-actions';
import { guestCanReadCase } from './counsel-guest';
import { exhibitLabel, fuzzyTitleMatch, mediaCategory, type TimelineEvent } from './timeline-types';

/**
 * An item is worth showing as a "relevant upload" thumbnail only if it can
 * actually be displayed. Images, PDFs, docs, video, and audio all render a
 * meaningful tile. An EMAIL only renders if it has extracted content (subject /
 * sender / body); an encrypted or undecodable .eml has none, so it would show
 * an empty "(no subject)" card. Drop those rather than surface a broken tile.
 */
function evidenceIsDisplayable(e: TimelineEvent): boolean {
  if (mediaCategory(e.media?.[0], e.kind) !== 'email') return true;
  const em = e.aiExtracted?.email ?? {};
  const body = (e.aiExtracted?.ocr_text ?? '').trim();
  return Boolean(
    em.subject || em.from || (em.to && em.to.length) || (e.title ?? '').trim() || body,
  );
}

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

/** Background generation lifecycle for an approach's argument. */
export type ApproachGenStatus = 'idle' | 'running' | 'done' | 'error';

export type Approach = {
  id: string;
  caseId: string;
  title: string;
  prompt: string;
  /** Who is connected (parties, witnesses, roles) and how. */
  connections: string;
  generated: ApproachArgument | null;
  /** 'running' while the (multi-minute) assembly is in flight; 'error' with a
   *  calm genError when it could not complete. Drives the client's live state. */
  genStatus: ApproachGenStatus;
  genError: string | null;
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
  gen_status: ApproachGenStatus | null;
  gen_error: string | null;
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
  genStatus: r.gen_status ?? (r.generated ? 'done' : 'idle'),
  genError: r.gen_error ?? null,
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

const SELECT =
  'id, case_id, title, prompt, connections, generated, gen_status, gen_error, created_at, updated_at';

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
    .select('title, subject_name, case_type, posture, jurisdiction_state, jurisdiction_country, description, text_normalizations')
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
    text_normalizations: unknown;
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
  // the rest so the whole matter is STILL entirely in view. Every item is
  // present; the budget only decides how many get full text vs a summary.
  //
  // Bounded deliberately: a 600k-char / ~240k-token prompt made the model spend
  // 3+ minutes generating, which blew even a raised serverless ceiling and
  // returned nothing ("Could not re-run."). 300k chars (~75k tokens) keeps the
  // ~120 most-relevant items at full text while every remaining item stays in
  // as a one-line summary, and brings the call back to a reliable, completable
  // duration.
  const evidence = await loadCaseEvidenceDigest(admin, caseId, {
    fullTextTopN: 2000, // consider every item, relevance-ordered
    perItemChars: 2200,
    totalCharBudget: 300_000, // ~75k tokens; tail of a huge matter degrades to summaries
  });
  const res = await generateApproachArgument({
    facts,
    approach: prompt,
    connections: (connections ?? '').trim() || undefined,
    evidence,
  });
  if ('error' in res) return { error: res.error };
  // Apply the matter's naming conventions (e.g. SH -> STH) permanently, so a
  // re-run can never reintroduce the wrong form.
  return { generated: normalizeDeep(res, toNormRules(cr.text_normalizations)) };
}

// The AI gate on its own, so create / re-run can fail FAST (before marking a
// job 'running') when analysis is unavailable, and show the calm message
// immediately instead of leaving the user polling a job that can never run.
async function canGenerate(caseId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!aiConfigured()) return { ok: false, error: AI_UNAVAILABLE_MESSAGE };
  const firmAccess = (await resolveTimelineAccess()) === 'firm';
  if (!firmAccess && !(await guestCanReadCase(caseId))) {
    return { ok: false, error: AI_UNAVAILABLE_MESSAGE };
  }
  return { ok: true };
}

/**
 * The background assembly job. Runs AFTER the response is sent (unstable_after),
 * so the multi-minute deep-read + model call never blocks the request. It owns
 * its own admin client (the request's may be torn down) and always lands the
 * row on a terminal status ('done' or 'error') so the client's poll ends.
 */
async function runApproachJob(
  caseId: string,
  approachId: string,
  theory: string,
  connections: string,
): Promise<void> {
  const admin = createAdminSupabase();
  if (!admin) return;
  const now = () => new Date().toISOString();
  try {
    const gen = await runGeneration(admin, caseId, theory, connections);
    if (gen.error) {
      await admin
        .from('case_approaches')
        .update({ gen_status: 'error', gen_error: gen.error, updated_at: now() })
        .eq('id', approachId)
        .eq('case_id', caseId);
      return;
    }
    await admin
      .from('case_approaches')
      .update({ generated: gen.generated, gen_status: 'done', gen_error: null, updated_at: now() })
      .eq('id', approachId)
      .eq('case_id', caseId);
  } catch {
    await admin
      .from('case_approaches')
      .update({
        gen_status: 'error',
        gen_error: 'The analysis did not finish. Please run it again.',
        updated_at: now(),
      })
      .eq('id', approachId)
      .eq('case_id', caseId);
  }
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

  // Save the theory first so it is never lost. Whether we then assemble in the
  // background depends on the AI gate: if analysis is unavailable, save the
  // approach in an 'idle' state with a calm note instead of a stuck 'running'.
  const can = await canGenerate(caseId);
  const willRun = can.ok;
  const { data, error } = await admin
    .from('case_approaches')
    .insert({
      case_id: caseId,
      firm_id: firmId,
      title: title.slice(0, 200),
      prompt,
      connections,
      generated: null,
      gen_status: willRun ? 'running' : 'idle',
      gen_started_at: willRun ? new Date().toISOString() : null,
      created_by: gate.userId,
    })
    .select(SELECT)
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not save the approach.' };

  // Assemble the argument AFTER the response returns (can take a few minutes on
  // a large matter); the client polls case_approaches for the result.
  if (willRun) {
    const approachId = (data as Row).id;
    waitUntil(runApproachJob(caseId, approachId, prompt, connections));
  }
  revalidatePath(`/counsel/cases/${caseId}`);
  return {
    ok: true,
    approach: toApproach(data as Row),
    generateError: can.ok ? undefined : can.error,
  };
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

  // Fail fast (no 'running' state) when analysis is unavailable, so the user
  // sees the calm message now instead of polling a job that can never finish.
  const can = await canGenerate(caseId);
  if (!can.ok) return { ok: false, error: can.error };

  // Mark the job running and return immediately. The assembly runs AFTER the
  // response (it can take a few minutes); the client polls getApproachGenState.
  const { data, error } = await admin
    .from('case_approaches')
    .update({
      prompt: theory,
      gen_status: 'running',
      gen_error: null,
      gen_started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', approachId)
    .eq('case_id', caseId)
    .select(SELECT)
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not start the re-run.' };

  waitUntil(runApproachJob(caseId, approachId, theory, connections));
  return { ok: true, approach: toApproach(data as Row) };
}

/**
 * Poll one approach's live generation state. The client calls this every few
 * seconds while an assembly is 'running' (including after a page reload), and
 * stops when it reaches a terminal status.
 */
export async function getApproachGenState(
  firmId: string,
  caseId: string,
  approachId: string,
): Promise<{ ok: boolean; error?: string; approach?: Approach }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const { data, error } = await admin
    .from('case_approaches')
    .select(SELECT)
    .eq('id', approachId)
    .eq('case_id', caseId)
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? 'Not found.' };
  return { ok: true, approach: toApproach(data as Row) };
}

/**
 * The actual evidence items an approach marshals: the real uploads Advottic
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
  const events = tl.events
    .filter((e) => {
      const label = exhibitLabel(e.aiExtracted?.exhibit_no);
      if (label && citedLabels.has(label.toUpperCase())) return true;
      const title = e.title ?? '';
      return citedTitles.some((ct) => fuzzyTitleMatch(ct, title));
    })
    // Never surface an upload we cannot actually display (e.g. an encrypted /
    // undecodable .eml with no extracted content) as a "relevant upload" tile.
    .filter(evidenceIsDisplayable);
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
