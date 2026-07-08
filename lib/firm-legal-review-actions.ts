'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser, createServerSupabase } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { aiConfigured } from './timeline-ai';
import { resolveTimelineAccess } from './timeline-entitlement';
import { generateLegalReviewDraft, type LegalReviewFacts } from './legal-review-ai';
import { loadCaseEvidenceDigest } from './case-evidence-digest';
import { verifyCases, type CitationCandidate } from './courtlistener';
import { AI_UNAVAILABLE_MESSAGE } from './ai-errors';

/**
 * Firm legal-review actions ("prove-the-case" layer). The firm surface that
 * surfaces the laws / claims implicated by the matter, each with recommended
 * actions, statutes, and CourtListener-VERIFIED case citations.
 *
 * Firm members are not case members of a firm matter, so every read/write goes
 * through the ADMIN client gated on firm membership + case.firm_id, mirroring
 * lib/firm-timeline-actions.ts and lib/case-evidence-actions.ts.
 *
 * SAFETY: the model only DRAFTS candidate cases. Every candidate is run through
 * lib/courtlistener.ts here; only citations confirmed to exist in CourtListener
 * are kept (with the real courtlistener.com link). Everything else is dropped
 * before anything is persisted or shown.
 */

// ── Public shapes ─────────────────────────────────────────────────────────

export type VerifiedCase = {
  caseName: string;
  citation: string | null;
  court: string | null;
  dateFiled: string | null;
  /** Full https courtlistener.com link to the opinion. */
  url: string;
  relevance: string;
};

export type LegalReviewClaim = {
  title: string;
  legalBasis: string;
  elements: string[];
  recommendedActions: string[];
  statutes: { label: string; citation: string; note: string | null }[];
  /** ONLY CourtListener-verified case citations. */
  cases: VerifiedCase[];
  /** How many candidate cases were dropped as unverified (transparency). */
  droppedCaseCount: number;
};

export type LegalReview = {
  overview: string;
  state: string | null;
  claims: LegalReviewClaim[];
  verifiedCitationCount: number;
  droppedCitationCount: number;
  generatedAt: string;
};

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

// ── Load the persisted review (admin, firm-scoped) ────────────────────────
export async function getFirmLegalReview(
  firmId: string,
  caseId: string,
): Promise<{ ok: boolean; error?: string; review?: LegalReview | null }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const { data } = await admin
    .from('case_legal_reviews')
    .select('generated, state, updated_at')
    .eq('case_id', caseId)
    .maybeSingle();
  if (!data) return { ok: true, review: null };
  const row = data as { generated: Record<string, unknown> | null; state: string | null; updated_at: string };
  const g = row.generated ?? {};
  const review: LegalReview = {
    overview: String((g as { overview?: unknown }).overview ?? ''),
    state: row.state,
    claims: Array.isArray((g as { claims?: unknown }).claims)
      ? ((g as { claims: LegalReviewClaim[] }).claims)
      : [],
    verifiedCitationCount: Number((g as { verifiedCitationCount?: unknown }).verifiedCitationCount ?? 0),
    droppedCitationCount: Number((g as { droppedCitationCount?: unknown }).droppedCitationCount ?? 0),
    generatedAt: row.updated_at,
  };
  return { ok: true, review };
}

// ── Generate: draft (AI) -> verify citations (CourtListener) -> persist ───
export async function generateFirmLegalReviewAction(
  firmId: string,
  caseId: string,
): Promise<{ ok: boolean; error?: string; review?: LegalReview }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  // AI gate: firm-tier + a configured model. When the key is present but out
  // of credits, the draft call below returns the calm friendly message.
  if (!aiConfigured() || (await resolveTimelineAccess()) !== 'firm') {
    return { ok: false, error: AI_UNAVAILABLE_MESSAGE };
  }

  const { data: caseRow } = await admin
    .from('cases')
    .select('title, subject_name, case_type, posture, jurisdiction_state, jurisdiction_country, description')
    .eq('id', caseId)
    .maybeSingle();
  if (!caseRow) return { ok: false, error: 'That matter is not in this firm.' };
  const cr = caseRow as {
    title: string;
    subject_name: string | null;
    case_type: string | null;
    posture: string | null;
    jurisdiction_state: string | null;
    jurisdiction_country: string | null;
    description: string | null;
  };
  const facts: LegalReviewFacts = {
    title: cr.title,
    subjectName: cr.subject_name,
    caseType: cr.case_type,
    posture: cr.posture,
    jurisdictionState: cr.jurisdiction_state,
    jurisdictionCountry: cr.jurisdiction_country,
    description: cr.description,
  };

  const evidence = await loadCaseEvidenceDigest(admin, caseId);
  const draft = await generateLegalReviewDraft({ facts, evidence });
  if ('error' in draft) return { ok: false, error: draft.error };

  // ── Verify every candidate citation against CourtListener. Only confirmed
  //    cases survive; the rest are dropped and counted (never fabricated). ──
  let verifiedCitationCount = 0;
  let droppedCitationCount = 0;
  const claims: LegalReviewClaim[] = [];
  for (const claim of draft.claims) {
    const candidates: CitationCandidate[] = claim.cases.map((c) => ({
      caseName: c.caseName,
      citation: c.citation,
      court: c.court,
      year: c.year,
    }));
    const verifications = await verifyCases(candidates);
    const cases: VerifiedCase[] = [];
    verifications.forEach((v, i) => {
      if (v.verified && v.match) {
        verifiedCitationCount += 1;
        cases.push({
          caseName: v.match.caseName || claim.cases[i].caseName,
          citation: v.match.citation,
          court: v.match.court,
          dateFiled: v.match.dateFiled,
          url: v.match.url,
          relevance: claim.cases[i].relevance,
        });
      } else {
        droppedCitationCount += 1;
      }
    });
    claims.push({
      title: claim.title,
      legalBasis: claim.legalBasis,
      elements: claim.elements,
      recommendedActions: claim.recommendedActions,
      statutes: claim.statutes,
      cases,
      droppedCaseCount: claim.cases.length - cases.length,
    });
  }

  const state = (cr.jurisdiction_state ?? '').trim() || (cr.jurisdiction_country ?? '').trim() || null;
  const now = new Date().toISOString();
  const generated = {
    overview: draft.overview,
    state,
    claims,
    verifiedCitationCount,
    droppedCitationCount,
  };

  const { error } = await admin
    .from('case_legal_reviews')
    .upsert(
      {
        case_id: caseId,
        state,
        generated,
        created_by: gate.userId,
        updated_at: now,
      },
      { onConflict: 'case_id' },
    );
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/counsel/cases/${caseId}`);
  return {
    ok: true,
    review: { overview: draft.overview, state, claims, verifiedCitationCount, droppedCitationCount, generatedAt: now },
  };
}
