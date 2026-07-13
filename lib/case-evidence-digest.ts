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
type ExtractedForDigest = {
  exhibit_no?: number;
  relevance_score?: number;
  relevance_reason?: string;
  ocr_text?: unknown;
  email?: unknown;
  message_thread?: unknown;
};

/** Assemble an item's full extracted text (OCR / email / message thread + the
 *  AI's relevance reasoning), bounded to `perItemChars`. */
function itemFullText(ex: ExtractedForDigest | null, perItemChars: number): string | null {
  if (!ex) return null;
  const asText = (v: unknown): string =>
    typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
  const parts: string[] = [];
  const ocr = asText(ex.ocr_text).trim();
  if (ocr) parts.push(ocr);
  const email = asText(ex.email).trim();
  if (email && email !== 'null') parts.push(`[email] ${email}`);
  const thread = asText(ex.message_thread).trim();
  if (thread && thread !== 'null') parts.push(`[messages] ${thread}`);
  const reason = (ex.relevance_reason ?? '').trim();
  if (reason) parts.push(`[why relevant] ${reason}`);
  let text = parts.join('\n').trim();
  if (!text) return null;
  if (text.length > perItemChars) text = `${text.slice(0, perItemChars)}…`;
  return text;
}

export async function loadCaseEvidenceDigest(
  admin: SupabaseClient,
  caseId: string,
  opts: { limit?: number; fullTextTopN?: number; perItemChars?: number } = {},
): Promise<EvidenceDigestItem[]> {
  const { limit = 2000, fullTextTopN = 0, perItemChars = 2500 } = opts;
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
    ai_extracted: ExtractedForDigest | null;
  }>;
  // Order by relevance (highest first, unscored last) so that any downstream cap
  // keeps the MOST relevant items rather than an arbitrary slice, and so the
  // full-text budget is spent on the items that matter most.
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
    .map(({ r }, i) => {
      const no = r.ai_extracted?.exhibit_no;
      return {
        exhibit: typeof no === 'number' ? `EX-${String(no).padStart(4, '0')}` : null,
        when: r.occurred_at ? formatOccurred(r.occurred_at, r.occurred_precision ?? 'day') : null,
        kind: r.kind,
        title: r.title || '(untitled)',
        summary: r.ai_summary,
        fullText: i < fullTextTopN ? itemFullText(r.ai_extracted, perItemChars) : null,
      };
    });
}
