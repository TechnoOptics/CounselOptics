import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatOccurred, type OccurredPrecision } from './timeline-types';
import type { EvidenceDigestItem } from './legal-review-ai';

/**
 * Build a compact, model-ready digest of a matter's evidence (timeline events)
 * for the firm analytical surfaces (legal review, approach builder). Admin read
 * only, so the caller must already have gated on firm membership + case.firm_id.
 * Keeps just what the model needs to reason and cite: the stable exhibit number,
 * when it occurred, the kind, the title, and the neutral summary.
 */
export async function loadCaseEvidenceDigest(
  admin: SupabaseClient,
  caseId: string,
  limit = 2000,
): Promise<EvidenceDigestItem[]> {
  const { data } = await admin
    .from('case_timeline_events')
    .select('title, ai_summary, kind, occurred_at, occurred_precision, ai_extracted')
    .eq('case_id', caseId)
    .limit(limit);
  const rows = (data ?? []) as Array<{
    title: string | null;
    ai_summary: string | null;
    kind: string;
    occurred_at: string | null;
    occurred_precision: OccurredPrecision | null;
    ai_extracted: { exhibit_no?: number; relevance_score?: number } | null;
  }>;
  // Order by relevance (highest first, unscored last) so that any downstream cap
  // keeps the MOST relevant items rather than an arbitrary slice. `limit` is set
  // high enough to cover an entire matter, so nothing is silently dropped here.
  return rows
    .map((r) => ({
      r,
      score:
        typeof r.ai_extracted?.relevance_score === 'number' &&
        Number.isFinite(r.ai_extracted.relevance_score)
          ? r.ai_extracted.relevance_score
          : -1,
    }))
    .sort((a, b) => b.score - a.score)
    .map(({ r }) => {
      const no = r.ai_extracted?.exhibit_no;
      return {
        exhibit: typeof no === 'number' ? `EX-${String(no).padStart(4, '0')}` : null,
        when: r.occurred_at ? formatOccurred(r.occurred_at, r.occurred_precision ?? 'day') : null,
        kind: r.kind,
        title: r.title || '(untitled)',
        summary: r.ai_summary,
      };
    });
}
